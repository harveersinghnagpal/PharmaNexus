"""
Billing schemas — updated with new fields.
Note: The billing route defines schemas inline for clarity.
This file is kept for backward compatibility and external imports.
"""
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from decimal import Decimal


class SaleItemCreate(BaseModel):
    medicine_id: int
    batch_id: int
    quantity: int
    price: Decimal


class SaleCreate(BaseModel):
    store_id: int
    prescription_number: Optional[str] = None
    prescription_id: Optional[int] = None
    payment_method: str = "cash"
    discount_amount: Decimal = Decimal("0")
    notes: Optional[str] = None
    items: List[SaleItemCreate]


class SaleItemResponse(BaseModel):
    id: int
    medicine_id: int
    batch_id: int
    quantity: int
    price: Decimal
    model_config = {"from_attributes": True}


class SaleResponse(BaseModel):
    id: int
    store_id: int
    user_id: int
    total_amount: Decimal
    prescription_number: Optional[str] = None
    prescription_id: Optional[int] = None
    payment_method: Optional[str] = None
    discount_amount: Optional[Decimal] = None
    notes: Optional[str] = None
    created_at: datetime
    items: List[SaleItemResponse] = []
    model_config = {"from_attributes": True}
