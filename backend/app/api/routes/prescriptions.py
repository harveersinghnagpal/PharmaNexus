"""
Prescription workflow API — full lifecycle management from intake to dispensing.
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime, date
from pydantic import BaseModel
import aiofiles
import os
import uuid

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.prescription import Prescription, PrescriptionStatus
from app.models.audit import AuditAction
from app.api.deps import get_current_user, require_manager
from app.events import bus, DomainEvent, PRESCRIPTION_CREATED, PRESCRIPTION_APPROVED, PRESCRIPTION_DISPENSED
from app.services.audit_service import write_audit_log

router = APIRouter(prefix="/prescriptions", tags=["Prescriptions"])

UPLOAD_DIR = "uploads/prescriptions"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _ensure_prescription_scope(prescription: Prescription, current_user: User):
    if current_user.store_id and prescription.store_id != current_user.store_id:
        raise HTTPException(status_code=403, detail="Access denied for this store's prescription")


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PrescriptionCreate(BaseModel):
    patient_name: str
    patient_age: Optional[int] = None
    patient_phone: Optional[str] = None
    doctor_name: str
    doctor_registration: Optional[str] = None
    doctor_phone: Optional[str] = None
    prescription_date: date
    valid_until: Optional[date] = None
    diagnosis: Optional[str] = None
    notes: Optional[str] = None
    store_id: int
    is_refill: bool = False
    max_refills: int = 0


class PrescriptionResponse(BaseModel):
    id: int
    patient_name: str
    patient_age: Optional[int]
    patient_phone: Optional[str]
    doctor_name: str
    doctor_registration: Optional[str]
    prescription_date: date
    valid_until: Optional[date]
    diagnosis: Optional[str]
    notes: Optional[str]
    document_url: Optional[str]
    status: PrescriptionStatus
    store_id: int
    created_by_user_id: int
    reviewed_by_user_id: Optional[int]
    is_refill: bool
    refill_count: int
    max_refills: int
    created_at: datetime
    reviewed_at: Optional[datetime]

    model_config = {"from_attributes": True}


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("", response_model=PrescriptionResponse, status_code=status.HTTP_201_CREATED)
async def create_prescription(
    payload: PrescriptionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new prescription record. Any authenticated staff can intake a prescription."""
    if current_user.store_id and payload.store_id != current_user.store_id:
        raise HTTPException(status_code=403, detail="Cannot create prescriptions for another store")

    prescription = Prescription(
        **payload.model_dump(),
        created_by_user_id=current_user.id,
        status=PrescriptionStatus.PENDING,
    )
    db.add(prescription)
    await db.commit()
    await db.refresh(prescription)

    # Emit domain event
    await bus.publish(DomainEvent(
        event_type=PRESCRIPTION_CREATED,
        payload={
            "prescription_id": prescription.id,
            "patient_name": prescription.patient_name,
            "store_id": prescription.store_id,
            "user_id": current_user.id,
            "ip_address": request.client.host if request.client else None,
        },
        source_service="prescription_service",
        request_id=getattr(request.state, "request_id", ""),
    ))

    return prescription


@router.get("", response_model=List[PrescriptionResponse])
async def list_prescriptions(
    status_filter: Optional[PrescriptionStatus] = None,
    store_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List prescriptions with optional filters."""
    query = select(Prescription).order_by(Prescription.created_at.desc())

    # Scope by store
    if current_user.store_id and store_id and store_id != current_user.store_id:
        raise HTTPException(status_code=403, detail="Cannot query prescriptions for another store")
    if store_id:
        query = query.where(Prescription.store_id == store_id)
    elif current_user.store_id:
        query = query.where(Prescription.store_id == current_user.store_id)

    if status_filter:
        query = query.where(Prescription.status == status_filter)

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{prescription_id}", response_model=PrescriptionResponse)
async def get_prescription(
    prescription_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Prescription).where(Prescription.id == prescription_id))
    prescription = result.scalar_one_or_none()
    if not prescription:
        raise HTTPException(status_code=404, detail="Prescription not found")
    _ensure_prescription_scope(prescription, current_user)
    return prescription


@router.put("/{prescription_id}/approve", response_model=PrescriptionResponse)
async def approve_prescription(
    prescription_id: int,
    notes: Optional[str] = None,
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Approve a pending prescription. Requires Store Manager or higher."""
    result = await db.execute(select(Prescription).where(Prescription.id == prescription_id))
    prescription = result.scalar_one_or_none()
    if not prescription:
        raise HTTPException(status_code=404, detail="Prescription not found")
    _ensure_prescription_scope(prescription, current_user)
    if prescription.status != PrescriptionStatus.PENDING:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve prescription in '{prescription.status}' status"
        )

    prescription.status = PrescriptionStatus.APPROVED
    prescription.reviewed_by_user_id = current_user.id
    prescription.reviewed_at = datetime.utcnow()
    if notes:
        prescription.notes = (prescription.notes or "") + f"\n[Pharmacist note]: {notes}"

    await db.commit()
    await db.refresh(prescription)

    await bus.publish(DomainEvent(
        event_type=PRESCRIPTION_APPROVED,
        payload={
            "prescription_id": prescription.id,
            "patient_name": prescription.patient_name,
            "reviewer_user_id": current_user.id,
            "store_id": prescription.store_id,
        },
        source_service="prescription_service",
        request_id=getattr(request.state, "request_id", "") if request else "",
    ))

    return prescription


@router.put("/{prescription_id}/reject", response_model=PrescriptionResponse)
async def reject_prescription(
    prescription_id: int,
    reason: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Reject a prescription with a reason."""
    result = await db.execute(select(Prescription).where(Prescription.id == prescription_id))
    prescription = result.scalar_one_or_none()
    if not prescription:
        raise HTTPException(status_code=404, detail="Prescription not found")
    _ensure_prescription_scope(prescription, current_user)

    prescription.status = PrescriptionStatus.REJECTED
    prescription.reviewed_by_user_id = current_user.id
    prescription.reviewed_at = datetime.utcnow()
    prescription.notes = (prescription.notes or "") + f"\n[Rejection reason]: {reason}"

    await db.commit()
    await db.refresh(prescription)

    await write_audit_log(
        db=db,
        entity_type="Prescription",
        entity_id=str(prescription.id),
        action=AuditAction.REJECT,
        user_id=current_user.id,
        store_id=prescription.store_id,
        new_value={"reason": reason, "status": prescription.status.value},
        description=f"Prescription #{prescription.id} rejected for {prescription.patient_name}",
        ip_address=request.client.host if request.client else None,
        request_id=getattr(request.state, "request_id", None),
    )
    await db.commit()
    return prescription


@router.post("/{prescription_id}/upload-document")
async def upload_prescription_document(
    prescription_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a prescription document image (JPG, PNG, PDF)."""
    result = await db.execute(select(Prescription).where(Prescription.id == prescription_id))
    prescription = result.scalar_one_or_none()
    if not prescription:
        raise HTTPException(status_code=404, detail="Prescription not found")
    _ensure_prescription_scope(prescription, current_user)

    # Validate file type
    allowed_types = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, WebP, and PDF files are allowed")

    content = await file.read()
    max_size_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_size_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit")

    # Save file
    ext_map = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "application/pdf": "pdf",
    }
    ext = ext_map.get(file.content_type, "bin")
    filename = f"rx_{prescription_id}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    async with aiofiles.open(filepath, "wb") as f:
        await f.write(content)

    previous_document_url = prescription.document_url
    prescription.document_url = f"/uploads/prescriptions/{filename}"
    await db.commit()

    await write_audit_log(
        db=db,
        entity_type="Prescription",
        entity_id=str(prescription.id),
        action=AuditAction.UPDATE,
        user_id=current_user.id,
        store_id=prescription.store_id,
        old_value={"document_url": previous_document_url},
        new_value={"document_url": prescription.document_url, "content_type": file.content_type, "size_bytes": len(content)},
        description=f"Prescription #{prescription.id} document uploaded",
        ip_address=request.client.host if request.client else None,
        request_id=getattr(request.state, "request_id", None),
    )
    await db.commit()

    return {"document_url": prescription.document_url, "filename": filename}
