import enum
from sqlalchemy import Column, Integer, Enum, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class TransferStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    COMPLETED = "completed"
    REJECTED = "rejected"


class Transfer(Base):
    __tablename__ = "transfers"

    id = Column(Integer, primary_key=True, index=True)
    from_store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    to_store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    medicine_id = Column(Integer, ForeignKey("medicines.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    status = Column(Enum(TransferStatus), default=TransferStatus.PENDING, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    from_store = relationship("Store", back_populates="transfers_from", foreign_keys=[from_store_id])
    to_store = relationship("Store", back_populates="transfers_to", foreign_keys=[to_store_id])
    medicine = relationship("Medicine", back_populates="transfers")
