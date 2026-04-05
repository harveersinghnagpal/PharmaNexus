from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


class MedicineResponse(BaseModel):
    id: int
    name: str
    category: str
    is_prescription_required: bool
    price: Decimal

    model_config = {"from_attributes": True}


class BatchCreate(BaseModel):
    medicine_id: int
    store_id: int
    batch_number: str
    expiry_date: date
    cost_price: Decimal
    quantity: int


class BatchResponse(BaseModel):
    id: int
    medicine_id: int
    store_id: int
    batch_number: str
    expiry_date: date
    cost_price: Decimal
    quantity: int
    created_at: datetime
    medicine: Optional[MedicineResponse] = None

    model_config = {"from_attributes": True}


class InventoryResponse(BaseModel):
    id: int
    medicine_id: int
    store_id: int
    total_quantity: int
    medicine: Optional[MedicineResponse] = None

    model_config = {"from_attributes": True}


class TransferCreate(BaseModel):
    from_store_id: int
    to_store_id: int
    medicine_id: int
    quantity: int


class TransferResponse(BaseModel):
    id: int
    from_store_id: int
    to_store_id: int
    medicine_id: int
    quantity: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class LowStockAlert(BaseModel):
    medicine_id: int
    medicine_name: str
    store_id: int
    store_name: str
    total_quantity: int


class ExpiryAlert(BaseModel):
    batch_id: int
    medicine_id: int
    medicine_name: str
    store_id: int
    batch_number: str
    expiry_date: date
    quantity: int
    days_to_expiry: int
