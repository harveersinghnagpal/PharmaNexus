from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, case
from typing import Optional
from datetime import date, timedelta
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.sales import Sale, SaleItem
from app.models.medicine import Medicine
from app.models.batch import Batch
from app.models.inventory import Inventory
from app.models.store import Store
from app.api.deps import get_current_user, require_manager

router = APIRouter(prefix="/analytics", tags=["Analytics"])


async def _resolve_sales_anchor_date(
    db: AsyncSession,
    current_user: User,
    store_id: Optional[int] = None,
) -> date:
    query = select(func.max(Sale.created_at))
    if store_id:
        query = query.where(Sale.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Sale.store_id == current_user.store_id)

    latest_sale_ts = (await db.execute(query)).scalar_one_or_none()
    if latest_sale_ts is None:
        return date.today()
    return latest_sale_ts.date()


@router.get("/sales")
async def get_sales_trend(
    store_id: Optional[int] = None,
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    anchor_date = await _resolve_sales_anchor_date(db, current_user, store_id)
    since = anchor_date - timedelta(days=days)
    query = (
        select(
            func.date(Sale.created_at).label("sale_date"),
            func.sum(Sale.total_amount).label("revenue"),
            func.count(Sale.id).label("orders"),
        )
        .where(Sale.created_at >= since)
        .group_by(func.date(Sale.created_at))
        .order_by(func.date(Sale.created_at))
    )
    if store_id:
        query = query.where(Sale.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Sale.store_id == current_user.store_id)

    result = await db.execute(query)
    rows = result.all()
    return [
        {"date": str(r.sale_date), "revenue": float(r.revenue), "orders": r.orders}
        for r in rows
    ]


@router.get("/top-products")
async def get_top_products(
    store_id: Optional[int] = None,
    days: int = 30,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    anchor_date = await _resolve_sales_anchor_date(db, current_user, store_id)
    since = anchor_date - timedelta(days=days)
    query = (
        select(
            Medicine.id,
            Medicine.name,
            Medicine.category,
            func.sum(SaleItem.quantity).label("total_qty"),
            func.sum(SaleItem.quantity * SaleItem.price).label("total_revenue"),
        )
        .join(SaleItem, SaleItem.medicine_id == Medicine.id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(Sale.created_at >= since)
        .group_by(Medicine.id, Medicine.name, Medicine.category)
        .order_by(func.sum(SaleItem.quantity * SaleItem.price).desc())
        .limit(limit)
    )
    if store_id:
        query = query.where(Sale.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Sale.store_id == current_user.store_id)

    result = await db.execute(query)
    return [
        {
            "medicine_id": r.id,
            "name": r.name,
            "category": r.category,
            "total_qty": int(r.total_qty),
            "total_revenue": float(r.total_revenue),
        }
        for r in result.all()
    ]


@router.get("/margin")
async def get_margin_tracking(
    store_id: Optional[int] = None,
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    anchor_date = await _resolve_sales_anchor_date(db, current_user, store_id)
    since = anchor_date - timedelta(days=days)
    query = (
        select(
            Medicine.category,
            func.sum(SaleItem.quantity * SaleItem.price).label("revenue"),
            func.sum(SaleItem.quantity * Batch.cost_price).label("cost"),
        )
        .join(SaleItem, SaleItem.medicine_id == Medicine.id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(Batch, Batch.id == SaleItem.batch_id)
        .where(Sale.created_at >= since)
        .group_by(Medicine.category)
        .order_by(func.sum(SaleItem.quantity * SaleItem.price).desc())
    )
    if store_id:
        query = query.where(Sale.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Sale.store_id == current_user.store_id)
    result = await db.execute(query)
    return [
        {
            "category": r.category,
            "revenue": float(r.revenue),
            "cost": float(r.cost),
            "margin": round((float(r.revenue) - float(r.cost)) / float(r.revenue) * 100, 2) if r.revenue else 0,
        }
        for r in result.all()
    ]


@router.get("/expiry-loss")
async def get_expiry_loss(
    store_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    today = date.today()
    query = (
        select(
            Medicine.category,
            func.count(Batch.id).label("expired_batches"),
            func.sum(Batch.quantity * Batch.cost_price).label("estimated_loss"),
        )
        .join(Batch, Batch.medicine_id == Medicine.id)
        .where(Batch.expiry_date < today)
        .where(Batch.quantity > 0)
        .group_by(Medicine.category)
    )
    if store_id:
        query = query.where(Batch.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Batch.store_id == current_user.store_id)
    result = await db.execute(query)
    return [
        {
            "category": r.category,
            "expired_batches": r.expired_batches,
            "estimated_loss": float(r.estimated_loss or 0),
        }
        for r in result.all()
    ]


@router.get("/kpis")
async def get_kpis(
    store_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    anchor_date = await _resolve_sales_anchor_date(db, current_user, store_id)
    month_start = anchor_date.replace(day=1)
    since = anchor_date - timedelta(days=30)
    today = date.today()

    # Monthly revenue
    rev_query = select(func.sum(Sale.total_amount)).where(Sale.created_at >= month_start)
    if store_id:
        rev_query = rev_query.where(Sale.store_id == store_id)
    elif current_user.store_id:
        rev_query = rev_query.where(Sale.store_id == current_user.store_id)
    monthly_revenue = (await db.execute(rev_query)).scalar() or 0

    # Monthly orders
    ord_query = select(func.count(Sale.id)).where(Sale.created_at >= month_start)
    if store_id:
        ord_query = ord_query.where(Sale.store_id == store_id)
    elif current_user.store_id:
        ord_query = ord_query.where(Sale.store_id == current_user.store_id)
    monthly_orders = (await db.execute(ord_query)).scalar() or 0

    avg_order_value = float(monthly_revenue) / int(monthly_orders) if monthly_orders else 0

    compliance_query = (
        select(
            func.sum(SaleItem.quantity * SaleItem.price).label("regulated_revenue"),
            func.count(func.distinct(Sale.id)).label("regulated_orders"),
        )
        .join(SaleItem, SaleItem.sale_id == Sale.id)
        .join(Medicine, Medicine.id == SaleItem.medicine_id)
        .where(Sale.created_at >= since)
        .where(
            (Medicine.is_prescription_required.is_(True))
            | (Medicine.is_controlled_substance.is_(True))
            | (Medicine.requires_approval.is_(True))
        )
    )
    if store_id:
        compliance_query = compliance_query.where(Sale.store_id == store_id)
    elif current_user.store_id:
        compliance_query = compliance_query.where(Sale.store_id == current_user.store_id)
    compliance_row = (await db.execute(compliance_query)).one()

    # Low stock count
    low_stock_query = select(func.count(Inventory.id)).where(Inventory.total_quantity <= settings.LOW_STOCK_THRESHOLD)
    if store_id:
        low_stock_query = low_stock_query.where(Inventory.store_id == store_id)
    elif current_user.store_id:
        low_stock_query = low_stock_query.where(Inventory.store_id == current_user.store_id)
    low_stock_count = (await db.execute(low_stock_query)).scalar() or 0

    # Expiry alerts count
    threshold = today + timedelta(days=30)
    expiry_query = (
        select(func.count(Batch.id))
        .where(Batch.expiry_date <= threshold)
        .where(Batch.quantity > 0)
    )
    if store_id:
        expiry_query = expiry_query.where(Batch.store_id == store_id)
    elif current_user.store_id:
        expiry_query = expiry_query.where(Batch.store_id == current_user.store_id)
    expiry_count = (await db.execute(expiry_query)).scalar() or 0

    return {
        "monthly_revenue": float(monthly_revenue),
        "monthly_orders": int(monthly_orders),
        "avg_order_value": round(avg_order_value, 2),
        "low_stock_alerts": int(low_stock_count),
        "expiry_alerts": int(expiry_count),
        "regulated_revenue": float(compliance_row.regulated_revenue or 0),
        "regulated_orders": int(compliance_row.regulated_orders or 0),
    }


@router.get("/store-performance")
async def get_store_performance(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    anchor_date = await _resolve_sales_anchor_date(db, current_user)
    since = anchor_date - timedelta(days=days)

    sales_query = (
        select(
            Store.id.label("store_id"),
            Store.name.label("store_name"),
            Store.region.label("region"),
            func.coalesce(func.sum(Sale.total_amount), 0).label("revenue"),
            func.count(Sale.id).label("orders"),
            func.coalesce(func.sum(SaleItem.quantity * Batch.cost_price), 0).label("cost"),
        )
        .select_from(Store)
        .join(Sale, Sale.store_id == Store.id, isouter=True)
        .join(SaleItem, SaleItem.sale_id == Sale.id, isouter=True)
        .join(Batch, Batch.id == SaleItem.batch_id, isouter=True)
        .where((Sale.created_at >= since) | (Sale.id.is_(None)))
        .group_by(Store.id, Store.name, Store.region)
        .order_by(func.coalesce(func.sum(Sale.total_amount), 0).desc(), Store.name)
    )
    if current_user.store_id:
        sales_query = sales_query.where(Store.id == current_user.store_id)

    stock_query = (
        select(
            Inventory.store_id,
            func.count(Inventory.id).label("low_stock_count"),
        )
        .where(Inventory.total_quantity <= settings.LOW_STOCK_THRESHOLD)
        .group_by(Inventory.store_id)
    )
    if current_user.store_id:
        stock_query = stock_query.where(Inventory.store_id == current_user.store_id)

    sales_rows = (await db.execute(sales_query)).all()
    stock_rows = (await db.execute(stock_query)).all()
    stock_map = {row.store_id: int(row.low_stock_count) for row in stock_rows}

    return [
        {
            "store_id": row.store_id,
            "store_name": row.store_name,
            "region": row.region,
            "revenue": float(row.revenue or 0),
            "orders": int(row.orders or 0),
            "avg_order_value": round(float(row.revenue or 0) / int(row.orders), 2) if row.orders else 0,
            "margin_percent": round(((float(row.revenue or 0) - float(row.cost or 0)) / float(row.revenue or 0) * 100), 2) if row.revenue else 0,
            "low_stock_count": stock_map.get(row.store_id, 0),
        }
        for row in sales_rows
    ]


@router.get("/category-insights")
async def get_category_insights(
    days: int = 30,
    store_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    anchor_date = await _resolve_sales_anchor_date(db, current_user, store_id)
    since = anchor_date - timedelta(days=days)

    query = (
        select(
            Medicine.category,
            func.sum(SaleItem.quantity).label("units_sold"),
            func.sum(SaleItem.quantity * SaleItem.price).label("revenue"),
            func.sum(SaleItem.quantity * Batch.cost_price).label("cost"),
            func.sum(
                case((Medicine.is_prescription_required.is_(True), SaleItem.quantity), else_=0)
            ).label("rx_units"),
            func.sum(
                case((Medicine.is_controlled_substance.is_(True), SaleItem.quantity), else_=0)
            ).label("controlled_units"),
            func.sum(
                case((Medicine.requires_approval.is_(True), SaleItem.quantity), else_=0)
            ).label("approval_units"),
        )
        .join(SaleItem, SaleItem.medicine_id == Medicine.id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(Batch, Batch.id == SaleItem.batch_id)
        .where(Sale.created_at >= since)
        .group_by(Medicine.category)
        .order_by(func.sum(SaleItem.quantity * SaleItem.price).desc())
    )
    if store_id:
        query = query.where(Sale.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Sale.store_id == current_user.store_id)

    rows = (await db.execute(query)).all()
    return [
        {
            "category": row.category,
            "units_sold": int(row.units_sold or 0),
            "revenue": float(row.revenue or 0),
            "margin_percent": round(((float(row.revenue or 0) - float(row.cost or 0)) / float(row.revenue or 0) * 100), 2) if row.revenue else 0,
            "rx_units": int(row.rx_units or 0),
            "controlled_units": int(row.controlled_units or 0),
            "approval_units": int(row.approval_units or 0),
        }
        for row in rows
    ]
