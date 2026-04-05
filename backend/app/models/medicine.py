from sqlalchemy import Column, Integer, String, Boolean, Numeric, DateTime, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Medicine(Base):
    __tablename__ = "medicines"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    category = Column(String(100), nullable=False)
    is_prescription_required = Column(Boolean, default=False, nullable=False)
    is_controlled_substance = Column(Boolean, default=False, nullable=False)
    drug_schedule = Column(String(10), nullable=True)  # H, H1, X, OTC, G (Schedule classification)
    requires_approval = Column(Boolean, default=False, nullable=False)  # requires manager pre-approval
    manufacturer = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    price = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    batches = relationship("Batch", back_populates="medicine")
    inventory = relationship("Inventory", back_populates="medicine")
    sale_items = relationship("SaleItem", back_populates="medicine")
    transfers = relationship("Transfer", back_populates="medicine")
