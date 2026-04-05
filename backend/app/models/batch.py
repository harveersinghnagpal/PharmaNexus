from sqlalchemy import Column, Integer, String, Numeric, Date, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Batch(Base):
    __tablename__ = "batches"

    id = Column(Integer, primary_key=True, index=True)
    medicine_id = Column(Integer, ForeignKey("medicines.id"), nullable=False)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    batch_number = Column(String(50), nullable=False)
    expiry_date = Column(Date, nullable=False)
    cost_price = Column(Numeric(10, 2), nullable=False)
    quantity = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    medicine = relationship("Medicine", back_populates="batches")
    store = relationship("Store", back_populates="batches")
    sale_items = relationship("SaleItem", back_populates="batch")
