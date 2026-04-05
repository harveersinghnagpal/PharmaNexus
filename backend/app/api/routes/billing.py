"""
Billing routes — upgraded with compliance validation, audit events,
and prescription linking.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from decimal import Decimal
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.sales import Sale, SaleItem
from app.models.batch import Batch
from app.models.inventory import Inventory
from app.api.deps import get_current_user, require_manager, require_roles
from app.services.compliance_service import ComplianceService
from app.events import bus, DomainEvent, SALE_CREATED

require_billing_access = require_roles(UserRole.SALES_STAFF, UserRole.STORE_MANAGER, UserRole.REGIONAL_ADMIN, UserRole.SUPER_ADMIN)

router = APIRouter(prefix="/billing", tags=["Billing"])


# ─── Schemas (inline for single-file clarity) ────────────────────────────────

class SaleItemCreate(BaseModel):
    medicine_id: int
    batch_id: int
    quantity: int
    price: Decimal


class SaleCreate(BaseModel):
    store_id: int
    prescription_number: Optional[str] = None   # legacy / manual entry
    prescription_id: Optional[int] = None        # formal prescription record
    payment_method: str = "cash"                 # cash | card | upi
    discount_amount: Decimal = Decimal("0")
    notes: Optional[str] = None
    items: List[SaleItemCreate]


class SaleItemResponse(BaseModel):
    id: int
    medicine_id: int
    batch_id: int
    quantity: int
    price: Decimal
    model_config = {"from_attributes": True}


class SaleResponse(BaseModel):
    id: int
    store_id: int
    user_id: int
    total_amount: Decimal
    prescription_number: Optional[str]
    prescription_id: Optional[int]
    payment_method: Optional[str]
    discount_amount: Optional[Decimal]
    notes: Optional[str]
    created_at: datetime
    items: List[SaleItemResponse] = []
    model_config = {"from_attributes": True}


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/create", response_model=SaleResponse)
async def create_sale(
    payload: SaleCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_billing_access),
):
    """
    Create a sale. Validates compliance (Rx requirements), deducts stock,
    emits audit event.
    """
    # ── Phase 1: Compliance validation ────────────────────────────────────────
    compliance = ComplianceService(db)
    item_medicine_ids = [item.medicine_id for item in payload.items]

    # Resolve prescription_id from prescription_number if missing
    px_id = payload.prescription_id
    if not px_id and payload.prescription_number:
        px_num = str(payload.prescription_number)
        # Check if prescription_number looks like an ID or common string prefix
        clean_num = px_num.strip().lower().replace("rx-", "").replace("#", "")
        if clean_num.isdigit():
            px_id = int(clean_num)

    await compliance.validate_sale_compliance(
        item_medicine_ids=item_medicine_ids,
        prescription_id=px_id,
        current_user=current_user,
    )

    # Carry resolved ID forward for record-keeping
    final_prescription_id = px_id

    # ── Phase 2: Stock validation ──────────────────────────────────────────────
    total = Decimal("0")
    validated_items = []

    for item in payload.items:
        result = await db.execute(
            select(Batch).where(
                and_(Batch.id == item.batch_id, Batch.medicine_id == item.medicine_id)
            )
        )
        batch = result.scalar_one_or_none()
        if not batch:
            raise HTTPException(status_code=404, detail=f"Batch {item.batch_id} not found")
        if batch.quantity < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock in batch {batch.batch_number}: available {batch.quantity}",
            )
        total += item.price * item.quantity
        validated_items.append((item, batch))

    # ── Phase 3: Create sale record ────────────────────────────────────────────
    net_total = total - payload.discount_amount
    sale = Sale(
        store_id=payload.store_id,
        user_id=current_user.id,
        total_amount=net_total,
        prescription_number=payload.prescription_number,
        prescription_id=final_prescription_id,
        payment_method=payload.payment_method,
        discount_amount=payload.discount_amount,
        notes=payload.notes,
    )
    db.add(sale)
    await db.flush()

    for item, batch in validated_items:
        batch.quantity -= item.quantity

        inv_result = await db.execute(
            select(Inventory).where(
                and_(
                    Inventory.medicine_id == item.medicine_id,
                    Inventory.store_id == payload.store_id,
                )
            )
        )
        inv = inv_result.scalar_one_or_none()
        if inv:
            inv.total_quantity = max(0, inv.total_quantity - item.quantity)

        sale_item = SaleItem(
            sale_id=sale.id,
            medicine_id=item.medicine_id,
            batch_id=item.batch_id,
            quantity=item.quantity,
            price=item.price,
        )
        db.add(sale_item)

    # Mark prescription as dispensed if linked
    if final_prescription_id:
        from app.models.prescription import Prescription, PrescriptionStatus
        rx_result = await db.execute(select(Prescription).where(Prescription.id == final_prescription_id))
        rx = rx_result.scalar_one_or_none()
        if rx and rx.status == PrescriptionStatus.APPROVED:
            rx.status = PrescriptionStatus.DISPENSED

    await db.commit()

    # ── Phase 4: Emit audit event ──────────────────────────────────────────────
    await bus.publish(DomainEvent(
        event_type=SALE_CREATED,
        payload={
            "sale_id": sale.id,
            "user_id": current_user.id,
            "store_id": sale.store_id,
            "total_amount": str(net_total),
            "item_count": len(validated_items),
            "prescription_id": final_prescription_id,
        },
        source_service="billing_service",
        request_id=request.headers.get("x-request-id", ""),
    ))

    # Return with items loaded
    result = await db.execute(
        select(Sale).options(selectinload(Sale.items)).where(Sale.id == sale.id)
    )
    return result.scalar_one()


@router.get("/{sale_id}", response_model=SaleResponse)
async def get_sale(
    sale_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_billing_access),
):
    result = await db.execute(
        select(Sale).options(selectinload(Sale.items)).where(Sale.id == sale_id)
    )
    sale = result.scalar_one_or_none()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    return sale


@router.get("")
async def list_sales(
    store_id: int = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_billing_access),
):
    query = select(Sale).options(selectinload(Sale.items)).order_by(Sale.created_at.desc()).limit(limit)
    if store_id:
        query = query.where(Sale.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Sale.store_id == current_user.store_id)
    result = await db.execute(query)
    return result.scalars().all()
