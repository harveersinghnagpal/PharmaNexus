"""
AuditLog model — tracks every significant state change in the system.
Used for compliance, debugging, and regulatory requirements.
"""
import enum
from sqlalchemy import Column, Integer, String, Enum, ForeignKey, DateTime, JSON, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class AuditAction(str, enum.Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    APPROVE = "APPROVE"
    REJECT = "REJECT"
    LOGIN = "LOGIN"
    LOGOUT = "LOGOUT"
    SALE_CREATED = "SALE_CREATED"
    BATCH_ADDED = "BATCH_ADDED"
    TRANSFER_CREATED = "TRANSFER_CREATED"
    PRESCRIPTION_APPROVED = "PRESCRIPTION_APPROVED"
    PRESCRIPTION_DISPENSED = "PRESCRIPTION_DISPENSED"
    AI_DECISION = "AI_DECISION"
    AI_REVIEWED = "AI_REVIEWED"


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(100), nullable=False, index=True)   # e.g. "Sale", "Batch", "Transfer"
    entity_id = Column(String(50), nullable=True, index=True)       # id of affected entity
    action = Column(Enum(AuditAction), nullable=False, index=True)
    changed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)
    old_value = Column(JSON, nullable=True)                         # snapshot before change
    new_value = Column(JSON, nullable=True)                         # snapshot after change
    description = Column(Text, nullable=True)                       # human-readable summary
    ip_address = Column(String(45), nullable=True)
    request_id = Column(String(64), nullable=True)                  # X-Request-ID
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    changed_by = relationship("User", foreign_keys=[changed_by_user_id])
