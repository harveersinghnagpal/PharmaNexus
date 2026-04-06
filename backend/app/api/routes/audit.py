"""
Audit Trail API routes — paginated log browsing for compliance and debugging.
Access restricted to super_admin and regional_admin roles.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
from app.core.database import get_db
from app.models.user import User
from app.models.audit import AuditLog, AuditAction
from app.api.deps import require_admin

router = APIRouter(prefix="/audit", tags=["Audit Trail"])


class AuditLogResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: Optional[str]
    action: str
    changed_by_user_id: Optional[int]
    store_id: Optional[int]
    old_value: Optional[dict]
    new_value: Optional[dict]
    description: Optional[str]
    ip_address: Optional[str]
    request_id: Optional[str]
    timestamp: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=List[AuditLogResponse])
async def list_audit_logs(
    entity_type: Optional[str] = Query(None, description="Filter by entity type (e.g. Sale, Batch, Transfer)"),
    entity_id: Optional[str] = Query(None, description="Filter by entity ID"),
    action: Optional[AuditAction] = Query(None, description="Filter by action type"),
    user_id: Optional[int] = Query(None, description="Filter by user who made the change"),
    store_id: Optional[int] = Query(None, description="Filter by store"),
    from_date: Optional[datetime] = Query(None, description="Filter from this timestamp"),
    to_date: Optional[datetime] = Query(None, description="Filter to this timestamp"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Paginated audit log viewer. Admin only.
    Supports filtering by entity, action, user, store, and date range.
    """
    query = select(AuditLog).order_by(AuditLog.timestamp.desc())
    query = query.where(AuditLog.action.notin_([AuditAction.AI_DECISION, AuditAction.AI_REVIEWED]))

    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.where(AuditLog.entity_id == entity_id)
    if action:
        query = query.where(AuditLog.action == action)
    if user_id:
        query = query.where(AuditLog.changed_by_user_id == user_id)
    if store_id:
        query = query.where(AuditLog.store_id == store_id)
    if from_date:
        query = query.where(AuditLog.timestamp >= from_date)
    if to_date:
        query = query.where(AuditLog.timestamp <= to_date)

    # Pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/entity/{entity_type}/{entity_id}", response_model=List[AuditLogResponse])
async def get_entity_history(
    entity_type: str,
    entity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Get full change history for a specific entity (e.g. a specific Batch or Sale)."""
    result = await db.execute(
        select(AuditLog)
        .where(and_(AuditLog.entity_type == entity_type, AuditLog.entity_id == entity_id))
        .order_by(AuditLog.timestamp.desc())
        .limit(100)
    )
    return result.scalars().all()


@router.get("/summary")
async def get_audit_summary(
    store_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Summary of recent audit activity by action type."""
    from sqlalchemy import func
    from datetime import timedelta
    since = datetime.utcnow() - timedelta(days=7)

    query = (
        select(AuditLog.action, func.count(AuditLog.id).label("count"))
        .where(AuditLog.timestamp >= since)
        .where(AuditLog.action.notin_([AuditAction.AI_DECISION, AuditAction.AI_REVIEWED]))
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
    )
    if store_id:
        query = query.where(AuditLog.store_id == store_id)

    result = await db.execute(query)
    return {
        "period_days": 7,
        "by_action": [{"action": r.action, "count": r.count} for r in result.all()]
    }
