"""
Audit service — subscribes to domain events and writes AuditLog records.
This is the central audit listener that captures every significant system change.
"""
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.audit import AuditLog, AuditAction
from app.events import bus, DomainEvent, SALE_CREATED, BATCH_ADDED, TRANSFER_CREATED
from app.events import PRESCRIPTION_CREATED, PRESCRIPTION_APPROVED, PRESCRIPTION_DISPENSED, USER_LOGIN
from loguru import logger


async def write_audit_log(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
    action: AuditAction,
    user_id: int = None,
    store_id: int = None,
    old_value: dict = None,
    new_value: dict = None,
    description: str = None,
    ip_address: str = None,
    request_id: str = None,
):
    """Write a single audit log entry. Can be called directly or via event bus."""
    log = AuditLog(
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id else None,
        action=action,
        changed_by_user_id=user_id,
        store_id=store_id,
        old_value=old_value,
        new_value=new_value,
        description=description,
        ip_address=ip_address,
        request_id=request_id,
    )
    db.add(log)
    # Don't commit here — let the caller manage the transaction


async def _handle_sale_created(event: DomainEvent):
    async with AsyncSessionLocal() as db:
        try:
            await write_audit_log(
                db=db,
                entity_type="Sale",
                entity_id=str(event.payload.get("sale_id")),
                action=AuditAction.SALE_CREATED,
                user_id=event.payload.get("user_id"),
                store_id=event.payload.get("store_id"),
                new_value={
                    "total_amount": str(event.payload.get("total_amount")),
                    "item_count": event.payload.get("item_count"),
                    "prescription_id": event.payload.get("prescription_id"),
                },
                description=f"Sale #{event.payload.get('sale_id')} created. Total: ₹{event.payload.get('total_amount')}",
                request_id=event.request_id,
            )
            await db.commit()
        except Exception as e:
            logger.error(f"AuditService: Failed to log sale.created: {e}")


async def _handle_prescription_created(event: DomainEvent):
    async with AsyncSessionLocal() as db:
        try:
            await write_audit_log(
                db=db,
                entity_type="Prescription",
                entity_id=str(event.payload.get("prescription_id")),
                action=AuditAction.CREATE,
                user_id=event.payload.get("user_id"),
                store_id=event.payload.get("store_id"),
                new_value={
                    "patient_name": event.payload.get("patient_name"),
                },
                description=f"Prescription #{event.payload.get('prescription_id')} created for {event.payload.get('patient_name')}",
                ip_address=event.payload.get("ip_address"),
                request_id=event.request_id,
            )
            await db.commit()
        except Exception as e:
            logger.error(f"AuditService: Failed to log prescription.created: {e}")


async def _handle_batch_added(event: DomainEvent):
    async with AsyncSessionLocal() as db:
        try:
            await write_audit_log(
                db=db,
                entity_type="Batch",
                entity_id=str(event.payload.get("batch_id")),
                action=AuditAction.BATCH_ADDED,
                user_id=event.payload.get("user_id"),
                store_id=event.payload.get("store_id"),
                new_value={
                    "medicine_id": event.payload.get("medicine_id"),
                    "quantity": event.payload.get("quantity"),
                    "batch_number": event.payload.get("batch_number"),
                    "expiry_date": str(event.payload.get("expiry_date")),
                },
                description=f"Batch {event.payload.get('batch_number')} added — qty {event.payload.get('quantity')}",
                request_id=event.request_id,
            )
            await db.commit()
        except Exception as e:
            logger.error(f"AuditService: Failed to log inventory.batch_added: {e}")


async def _handle_transfer_created(event: DomainEvent):
    async with AsyncSessionLocal() as db:
        try:
            await write_audit_log(
                db=db,
                entity_type="Transfer",
                entity_id=str(event.payload.get("transfer_id")),
                action=AuditAction.TRANSFER_CREATED,
                user_id=event.payload.get("user_id"),
                store_id=event.payload.get("from_store_id"),
                new_value={
                    "from_store_id": event.payload.get("from_store_id"),
                    "to_store_id": event.payload.get("to_store_id"),
                    "medicine_id": event.payload.get("medicine_id"),
                    "quantity": event.payload.get("quantity"),
                },
                description=f"Transfer #{event.payload.get('transfer_id')}: {event.payload.get('quantity')} units moved",
                request_id=event.request_id,
            )
            await db.commit()
        except Exception as e:
            logger.error(f"AuditService: Failed to log inventory.transfer_created: {e}")


async def _handle_prescription_approved(event: DomainEvent):
    async with AsyncSessionLocal() as db:
        try:
            await write_audit_log(
                db=db,
                entity_type="Prescription",
                entity_id=str(event.payload.get("prescription_id")),
                action=AuditAction.PRESCRIPTION_APPROVED,
                user_id=event.payload.get("reviewer_user_id"),
                store_id=event.payload.get("store_id"),
                description=f"Prescription #{event.payload.get('prescription_id')} approved for {event.payload.get('patient_name')}",
                request_id=event.request_id,
            )
            await db.commit()
        except Exception as e:
            logger.error(f"AuditService: Failed to log prescription.approved: {e}")



async def _handle_user_login(event: DomainEvent):
    async with AsyncSessionLocal() as db:
        try:
            await write_audit_log(
                db=db,
                entity_type="User",
                entity_id=str(event.payload.get("user_id")),
                action=AuditAction.USER_LOGIN,
                user_id=event.payload.get("user_id"),
                store_id=None,
                description=f"User {event.payload.get('email')} ({event.payload.get('role')}) logged in",
                ip_address=event.payload.get("ip_address"),
                request_id=event.request_id,
            )
            await db.commit()
        except Exception as e:
            logger.error(f"AuditService: Failed to log user.login: {e}")


def register_audit_handlers():
    """Register all audit event handlers with the bus. Call once on startup."""
    bus.subscribe(SALE_CREATED, _handle_sale_created)
    bus.subscribe(BATCH_ADDED, _handle_batch_added)
    bus.subscribe(TRANSFER_CREATED, _handle_transfer_created)
    bus.subscribe(PRESCRIPTION_CREATED, _handle_prescription_created)
    bus.subscribe(PRESCRIPTION_APPROVED, _handle_prescription_approved)
    bus.subscribe(USER_LOGIN, _handle_user_login)
    logger.info("AuditService: All audit handlers registered.")
