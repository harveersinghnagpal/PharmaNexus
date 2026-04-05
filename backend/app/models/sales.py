from sqlalchemy import Column, Integer, Numeric, ForeignKey, DateTime, String, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    total_amount = Column(Numeric(10, 2), nullable=False)
    prescription_number = Column(String(50), nullable=True)  # legacy / manual entry
    prescription_id = Column(Integer, ForeignKey("prescriptions.id"), nullable=True)
    payment_method = Column(String(30), default="cash", nullable=True)  # cash, card, upi
    discount_amount = Column(Numeric(10, 2), default=0)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    store = relationship("Store", back_populates="sales")
    user = relationship("User", back_populates="sales")
    prescription = relationship("Prescription", back_populates="sales", foreign_keys=[prescription_id])
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    medicine_id = Column(Integer, ForeignKey("medicines.id"), nullable=False)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)

    sale = relationship("Sale", back_populates="items")
    medicine = relationship("Medicine", back_populates="sale_items")
    batch = relationship("Batch", back_populates="sale_items")
