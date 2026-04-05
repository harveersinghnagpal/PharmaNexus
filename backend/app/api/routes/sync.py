"""
Offline sync endpoint — accepts batches of offline-queued client actions.
Applies them idempotently to prevent duplicate records on re-sync.
Uses server-wins conflict resolution for safety in pharmaceutical context.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import List, Optional, Any, Dict
from datetime import datetime
from pydantic import BaseModel
from app.core.database import get_db
from app.models.user import User, UserRole
from app.api.deps import get_current_user
from loguru import logger

router = APIRouter(prefix="/sync", tags=["Offline Sync"])


class OfflineEvent(BaseModel):
    local_id: str           # client-generated UUID for deduplication
    event_type: str         # "sale_create" | "batch_add" | "transfer_create"
    payload: Dict[str, Any]
    created_at: datetime    # when the event was created offline
    store_id: int


class SyncBatchRequest(BaseModel):
    events: List[OfflineEvent]
    client_timestamp: datetime


class SyncEventResult(BaseModel):
    local_id: str
    status: str             # "applied" | "duplicate" | "conflict" | "error"
    server_id: Optional[int] = None
    message: Optional[str] = None


class SyncBatchResponse(BaseModel):
    applied: int
    duplicates: int
    conflicts: int
    errors: int
    results: List[SyncEventResult]
    server_timestamp: datetime


# In-memory deduplication set (in production: use Redis or DB)
# Tracks local_ids of events already processed
_processed_ids: set = set()


@router.post("/events", response_model=SyncBatchResponse)
async def sync_offline_events(
    payload: SyncBatchRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Accept a batch of offline events and apply them idempotently.
    Events older than 24 hours are flagged as conflicts.
    Already-processed local_ids are returned as duplicates (no re-processing).
    """
    from datetime import timedelta, timezone
    results = []
    applied = duplicates = conflicts = errors = 0

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    for event in payload.events:
        # Deduplication check
        if event.local_id in _processed_ids:
            results.append(SyncEventResult(
                local_id=event.local_id,
                status="duplicate",
                message="Already processed"
            ))
            duplicates += 1
            continue

        # Staleness check (server-wins: reject events older than 24h)
        event_time = event.created_at
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)
        if event_time < cutoff:
            results.append(SyncEventResult(
                local_id=event.local_id,
                status="conflict",
                message="Event is older than 24 hours — server-wins conflict resolution applied"
            ))
            conflicts += 1
            continue

        try:
            server_id = await _apply_event(db, event, current_user)
            _processed_ids.add(event.local_id)
            results.append(SyncEventResult(
                local_id=event.local_id,
                status="applied",
                server_id=server_id,
            ))
            applied += 1
        except Exception as e:
            logger.error(f"Sync: Failed to apply event {event.local_id}: {e}")
            results.append(SyncEventResult(
                local_id=event.local_id,
                status="error",
                message=str(e),
            ))
            errors += 1

    return SyncBatchResponse(
        applied=applied,
        duplicates=duplicates,
        conflicts=conflicts,
        errors=errors,
        results=results,
        server_timestamp=datetime.now(timezone.utc),
    )


async def _apply_event(db: AsyncSession, event: OfflineEvent, user: User) -> Optional[int]:
    """Route an offline event to the appropriate handler."""
    if event.event_type == "sale_create":
        return await _apply_sale_create(db, event, user)
    elif event.event_type == "batch_add":
        return await _apply_batch_add(db, event, user)
    elif event.event_type == "transfer_create":
        return await _apply_transfer_create(db, event, user)
    else:
        raise ValueError(f"Unknown event type: {event.event_type}")


async def _apply_sale_create(db: AsyncSession, event: OfflineEvent, user: User) -> int:
    """Apply an offline sale creation event."""
    from app.models.sales import Sale, SaleItem
    from app.models.batch import Batch
    from app.models.inventory import Inventory
    from decimal import Decimal

    if user.role not in {
        UserRole.SALES_STAFF,
        UserRole.STORE_MANAGER,
        UserRole.REGIONAL_ADMIN,
        UserRole.SUPER_ADMIN,
    }:
        raise ValueError("You do not have permission to sync billing events")
    if user.store_id and user.store_id != event.store_id:
        raise ValueError("Billing event store mismatch for current user")

    p = event.payload
    total = Decimal("0")
    validated_items = []
    discount_amount = Decimal(str(p.get("discount_amount", 0)))

    for item in p.get("items", []):
        result = await db.execute(
            select(Batch).where(
                and_(Batch.id == item["batch_id"], Batch.medicine_id == item["medicine_id"])
            )
        )
        batch = result.scalar_one_or_none()
        if not batch or batch.quantity < item["quantity"]:
            raise ValueError(f"Stock conflict for batch {item['batch_id']}")
        total += Decimal(str(item["price"])) * item["quantity"]
        validated_items.append((item, batch))

    net_total = total - discount_amount
    sale = Sale(
        store_id=event.store_id,
        user_id=user.id,
        total_amount=net_total,
        prescription_number=p.get("prescription_number"),
        prescription_id=p.get("prescription_id"),
        payment_method=p.get("payment_method", "cash"),
        discount_amount=discount_amount,
        notes=((p.get("notes") or "").strip() + f" [OFFLINE SYNC {event.created_at.isoformat()}]").strip(),
    )
    db.add(sale)
    await db.flush()

    for item, batch in validated_items:
        batch.quantity -= item["quantity"]
        inv_result = await db.execute(
            select(Inventory).where(
                and_(
                    Inventory.medicine_id == item["medicine_id"],
                    Inventory.store_id == event.store_id,
                )
            )
        )
        inv = inv_result.scalar_one_or_none()
        if inv:
            inv.total_quantity = max(0, inv.total_quantity - item["quantity"])
        sale_item = SaleItem(
            sale_id=sale.id,
            medicine_id=item["medicine_id"],
            batch_id=item["batch_id"],
            quantity=item["quantity"],
            price=Decimal(str(item["price"])),
        )
        db.add(sale_item)

    await db.commit()
    return sale.id


async def _apply_batch_add(db: AsyncSession, event: OfflineEvent, user: User) -> int:
    """Apply an offline batch addition event."""
    from app.models.batch import Batch
    from app.models.inventory import Inventory
    from datetime import date

    if user.role not in {
        UserRole.INVENTORY_SUPERVISOR,
        UserRole.STORE_MANAGER,
        UserRole.REGIONAL_ADMIN,
        UserRole.SUPER_ADMIN,
    }:
        raise ValueError("You do not have permission to sync inventory events")
    if user.store_id and user.store_id != event.store_id:
        raise ValueError("Batch event store mismatch for current user")

    p = event.payload
    batch = Batch(
        medicine_id=p["medicine_id"],
        store_id=event.store_id,
        batch_number=p["batch_number"],
        quantity=p["quantity"],
        cost_price=p.get("cost_price", 0),
        expiry_date=date.fromisoformat(p["expiry_date"]),
    )
    db.add(batch)
    await db.flush()

    inv_result = await db.execute(
        select(Inventory).where(
            and_(
                Inventory.medicine_id == p["medicine_id"],
                Inventory.store_id == event.store_id,
            )
        )
    )
    inv = inv_result.scalar_one_or_none()
    if inv:
        inv.total_quantity += p["quantity"]
    else:
        db.add(Inventory(medicine_id=p["medicine_id"], store_id=event.store_id, total_quantity=p["quantity"]))

    await db.commit()
    return batch.id


async def _apply_transfer_create(db: AsyncSession, event: OfflineEvent, user: User) -> int:
    """Apply an offline transfer event."""
    from app.models.inventory import Inventory
    from app.models.transfer import Transfer, TransferStatus

    if user.role not in {
        UserRole.STORE_MANAGER,
        UserRole.REGIONAL_ADMIN,
        UserRole.SUPER_ADMIN,
    }:
        raise ValueError("You do not have permission to sync transfer events")

    p = event.payload
    from_store_id = int(p["from_store_id"])
    to_store_id = int(p["to_store_id"])
    medicine_id = int(p["medicine_id"])
    quantity = int(p["quantity"])

    if user.store_id and user.store_id != from_store_id:
        raise ValueError("Transfer source store mismatch for current user")
    if from_store_id == to_store_id:
        raise ValueError("Source and destination stores must differ")

    result = await db.execute(
        select(Inventory).where(
            and_(
                Inventory.medicine_id == medicine_id,
                Inventory.store_id == from_store_id,
            )
        )
    )
    src_inv = result.scalar_one_or_none()
    if not src_inv or src_inv.total_quantity < quantity:
        raise ValueError("Insufficient stock in source store")

    transfer = Transfer(
        from_store_id=from_store_id,
        to_store_id=to_store_id,
        medicine_id=medicine_id,
        quantity=quantity,
        status=TransferStatus.COMPLETED,
    )
    db.add(transfer)

    src_inv.total_quantity -= quantity

    result2 = await db.execute(
        select(Inventory).where(
            and_(
                Inventory.medicine_id == medicine_id,
                Inventory.store_id == to_store_id,
            )
        )
    )
    dst_inv = result2.scalar_one_or_none()
    if dst_inv:
        dst_inv.total_quantity += quantity
    else:
        db.add(Inventory(
            medicine_id=medicine_id,
            store_id=to_store_id,
            total_quantity=quantity,
        ))

    await db.commit()
    await db.refresh(transfer)
    return transfer.id


@router.get("/status")
async def sync_status(current_user: User = Depends(get_current_user)):
    """Returns server timestamp for client clock sync."""
    from datetime import timezone
    return {
        "server_timestamp": datetime.now(timezone.utc).isoformat(),
        "status": "online",
    }
