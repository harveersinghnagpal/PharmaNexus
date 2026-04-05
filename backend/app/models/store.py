from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Store(Base):
    __tablename__ = "stores"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    location = Column(String(200), nullable=False)
    region = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="store")
    batches = relationship("Batch", back_populates="store")
    inventory = relationship("Inventory", back_populates="store")
    sales = relationship("Sale", back_populates="store")
    transfers_from = relationship("Transfer", back_populates="from_store", foreign_keys="Transfer.from_store_id")
    transfers_to = relationship("Transfer", back_populates="to_store", foreign_keys="Transfer.to_store_id")
