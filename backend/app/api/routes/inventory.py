from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import date, timedelta
from app.core.database import get_db
from app.core.config import settings
from app.models.user import User
from app.models.inventory import Inventory
from app.models.batch import Batch
from app.models.medicine import Medicine
from app.models.transfer import Transfer, TransferStatus
from app.models.store import Store
from app.schemas.inventory import (
    BatchCreate, BatchResponse, InventoryResponse,
    TransferCreate, TransferResponse, LowStockAlert, ExpiryAlert
)
from app.api.deps import get_current_user, require_inventory, require_manager
from app.services.replenishment_planner import ReplenishmentPlanner
from app.services.transfer_recommender import TransferRecommender
from app.events import bus, DomainEvent, BATCH_ADDED, TRANSFER_CREATED

router = APIRouter(prefix="/inventory", tags=["Inventory"])



@router.get("", response_model=List[InventoryResponse])
async def get_inventory(
    store_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Inventory).options(selectinload(Inventory.medicine))
    if store_id:
        query = query.where(Inventory.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Inventory.store_id == current_user.store_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/add", response_model=BatchResponse)
async def add_batch(
    payload: BatchCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory),
):
    # Create batch
    batch = Batch(**payload.model_dump())
    db.add(batch)
    await db.flush()

    # Update or create inventory
    result = await db.execute(
        select(Inventory).where(
            and_(
                Inventory.medicine_id == payload.medicine_id,
                Inventory.store_id == payload.store_id,
            )
        )
    )
    inv = result.scalar_one_or_none()
    if inv:
        inv.total_quantity += payload.quantity
    else:
        inv = Inventory(
            medicine_id=payload.medicine_id,
            store_id=payload.store_id,
            total_quantity=payload.quantity,
        )
        db.add(inv)

    await db.commit()
    await db.refresh(batch)

    # Publish audit event
    await bus.publish(DomainEvent(
        event_type=BATCH_ADDED,
        payload={
            "batch_id": batch.id,
            "medicine_id": batch.medicine_id,
            "store_id": batch.store_id,
            "quantity": batch.quantity,
            "batch_number": batch.batch_number,
            "expiry_date": batch.expiry_date.isoformat(),
            "user_id": current_user.id
        },
        source_service="inventory",
        request_id=request.headers.get("x-request-id", "")
    ))

    # Load medicine relationship
    result2 = await db.execute(
        select(Batch).options(selectinload(Batch.medicine)).where(Batch.id == batch.id)
    )
    return result2.scalar_one()


@router.get("/low-stock", response_model=List[LowStockAlert])
async def get_low_stock(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        select(Inventory, Medicine, Store)
        .join(Medicine, Inventory.medicine_id == Medicine.id)
        .join(Store, Inventory.store_id == Store.id)
        .where(Inventory.total_quantity <= settings.LOW_STOCK_THRESHOLD)
    )
    if current_user.store_id:
        query = query.where(Inventory.store_id == current_user.store_id)
    result = await db.execute(query)
    rows = result.all()
    return [
        LowStockAlert(
            medicine_id=inv.medicine_id,
            medicine_name=med.name,
            store_id=inv.store_id,
            store_name=store.name,
            total_quantity=inv.total_quantity,
        )
        for inv, med, store in rows
    ]


@router.get("/expiry-alerts", response_model=List[ExpiryAlert])
async def get_expiry_alerts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    threshold = date.today() + timedelta(days=settings.EXPIRY_ALERT_DAYS)
    query = (
        select(Batch, Medicine)
        .join(Medicine, Batch.medicine_id == Medicine.id)
        .where(Batch.expiry_date <= threshold)
        .where(Batch.quantity > 0)
    )
    if current_user.store_id:
        query = query.where(Batch.store_id == current_user.store_id)
    result = await db.execute(query)
    rows = result.all()
    today = date.today()
    return [
        ExpiryAlert(
            batch_id=batch.id,
            medicine_id=batch.medicine_id,
            medicine_name=med.name,
            store_id=batch.store_id,
            batch_number=batch.batch_number,
            expiry_date=batch.expiry_date,
            quantity=batch.quantity,
            days_to_expiry=(batch.expiry_date - today).days,
        )
        for batch, med in rows
    ]


@router.post("/transfer", response_model=TransferResponse)
async def create_transfer(
    payload: TransferCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    # Validate source has enough stock
    result = await db.execute(
        select(Inventory).where(
            and_(
                Inventory.medicine_id == payload.medicine_id,
                Inventory.store_id == payload.from_store_id,
            )
        )
    )
    src_inv = result.scalar_one_or_none()
    if not src_inv or src_inv.total_quantity < payload.quantity:
        raise HTTPException(status_code=400, detail="Insufficient stock in source store")

    transfer = Transfer(**payload.model_dump(), status=TransferStatus.COMPLETED)
    db.add(transfer)

    # Deduct from source
    src_inv.total_quantity -= payload.quantity

    # Add to destination
    result2 = await db.execute(
        select(Inventory).where(
            and_(
                Inventory.medicine_id == payload.medicine_id,
                Inventory.store_id == payload.to_store_id,
            )
        )
    )
    dst_inv = result2.scalar_one_or_none()
    if dst_inv:
        dst_inv.total_quantity += payload.quantity
    else:
        db.add(Inventory(
            medicine_id=payload.medicine_id,
            store_id=payload.to_store_id,
            total_quantity=payload.quantity,
        ))

    await db.commit()
    await db.refresh(transfer)
    
    # Publish audit event
    await bus.publish(DomainEvent(
        event_type=TRANSFER_CREATED,
        payload={
            "transfer_id": transfer.id,
            "from_store_id": transfer.from_store_id,
            "to_store_id": transfer.to_store_id,
            "medicine_id": transfer.medicine_id,
            "quantity": transfer.quantity,
            "user_id": current_user.id
        },
        source_service="inventory",
        request_id=request.headers.get("x-request-id", "")
    ))
    
    return transfer


@router.get("/medicines")
async def get_medicines(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Medicine).order_by(Medicine.name))
    return result.scalars().all()


@router.get("/stores")
async def get_stores(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Store).order_by(Store.name))
    return result.scalars().all()


@router.get("/batches")
async def get_batches(
    store_id: Optional[int] = None,
    medicine_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Batch).options(selectinload(Batch.medicine))
    if store_id:
        query = query.where(Batch.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Batch.store_id == current_user.store_id)
    if medicine_id:
        query = query.where(Batch.medicine_id == medicine_id)
    query = query.where(Batch.quantity > 0).order_by(Batch.expiry_date)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/transfer-recommendations")
async def get_transfer_recommendations(
    store_id: Optional[int] = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Smart transfer recommendations engine.
    Returns ranked list of suggested inter-store transfers based on:
    - Stock imbalances across stores
    - Expiry risk (batches expiring within 14 days prioritized)
    - Shortage severity at destination stores
    """
    # Scope to user's store if not admin
    filter_store = store_id
    if not filter_store and current_user.store_id:
        filter_store = current_user.store_id

    recommender = TransferRecommender(db)
    recommendations = await recommender.get_recommendations(
        store_id=filter_store,
        limit=limit,
    )

    return {
        "total": len(recommendations),
        "recommendations": [
            {
                "from_store_id": r.from_store_id,
                "from_store_name": r.from_store_name,
                "to_store_id": r.to_store_id,
                "to_store_name": r.to_store_name,
                "medicine_id": r.medicine_id,
                "medicine_name": r.medicine_name,
                "medicine_category": r.medicine_category,
                "recommended_quantity": r.recommended_quantity,
                "reason": r.reason,
                "urgency_score": r.urgency_score,
                "urgency_tag": r.urgency_tag,
                "surplus_at_source": r.surplus_at_source,
                "shortage_at_dest": r.shortage_at_dest,
                "days_to_nearest_expiry": r.days_to_nearest_expiry,
            }
            for r in recommendations
        ]
    }


@router.get("/replenishment-plan")
async def get_replenishment_plan(
    store_id: Optional[int] = None,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Build a branch replenishment plan.
    Splits shortages into transfer-backed actions and procurement-needed actions.
    """
    filter_store = store_id
    if not filter_store and current_user.store_id:
        filter_store = current_user.store_id

    planner = ReplenishmentPlanner(db)
    return await planner.build_plan(store_id=filter_store, limit=limit)
