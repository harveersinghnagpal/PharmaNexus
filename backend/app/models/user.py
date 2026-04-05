import enum
from sqlalchemy import Column, Integer, String, Enum, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    REGIONAL_ADMIN = "regional_admin"
    STORE_MANAGER = "store_manager"
    INVENTORY_SUPERVISOR = "inventory_supervisor"
    SALES_STAFF = "sales_staff"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.SALES_STAFF)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    store = relationship("Store", back_populates="users")
    sales = relationship("Sale", back_populates="user")
