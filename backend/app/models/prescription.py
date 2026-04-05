"""
Prescription model — full prescription workflow from intake to dispensing.
"""
import enum
from sqlalchemy import Column, Integer, String, Enum, ForeignKey, DateTime, Date, Text, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class PrescriptionStatus(str, enum.Enum):
    PENDING = "pending"       # created, awaiting pharmacist review
    APPROVED = "approved"     # pharmacist approved, ready to dispense
    DISPENSED = "dispensed"   # medicines dispensed, linked to a Sale
    REJECTED = "rejected"     # rejected (invalid, expired, etc.)
    EXPIRED = "expired"       # prescription past validity date


class Prescription(Base):
    __tablename__ = "prescriptions"

    id = Column(Integer, primary_key=True, index=True)

    # Patient information
    patient_name = Column(String(200), nullable=False)
    patient_age = Column(Integer, nullable=True)
    patient_phone = Column(String(20), nullable=True)

    # Doctor / prescriber information
    doctor_name = Column(String(200), nullable=False)
    doctor_registration = Column(String(100), nullable=True)  # medical council reg number
    doctor_phone = Column(String(20), nullable=True)

    # Prescription details
    prescription_date = Column(Date, nullable=False)
    valid_until = Column(Date, nullable=True)                 # prescriptions expire
    diagnosis = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    # Document
    document_url = Column(String(500), nullable=True)        # uploaded prescription image path

    # Workflow
    status = Column(Enum(PrescriptionStatus), default=PrescriptionStatus.PENDING, nullable=False, index=True)
    is_refill = Column(Boolean, default=False)
    refill_count = Column(Integer, default=0)
    max_refills = Column(Integer, default=0)

    # Relations
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    store = relationship("Store")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_user_id])
    sales = relationship("Sale", back_populates="prescription")
