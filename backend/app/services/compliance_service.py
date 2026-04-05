"""
Compliance service — validates prescriptions, checks Rx medicine requirements,
drug schedule restrictions, and controlled substance access controls.
"""
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException, status
from app.models.medicine import Medicine
from app.models.prescription import Prescription, PrescriptionStatus
from app.models.user import User, UserRole
from loguru import logger


class ComplianceService:
    """
    Enforces pharmacy compliance rules:
    - Rx medicines require valid prescriptions
    - Controlled substances have stricter access rules
    - Schedule-based dispensing controls
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_medicines_for_items(self, item_medicine_ids: List[int]) -> dict:
        """Fetch medicine records for a list of medicine IDs."""
        result = await self.db.execute(
            select(Medicine).where(Medicine.id.in_(item_medicine_ids))
        )
        medicines = result.scalars().all()
        return {m.id: m for m in medicines}

    async def validate_sale_compliance(
        self,
        item_medicine_ids: List[int],
        prescription_id: Optional[int],
        current_user: User,
    ) -> None:
        """
        Validates compliance for a sale.
        Raises HTTPException if compliance rules are violated.
        """
        medicines = await self.get_medicines_for_items(item_medicine_ids)

        # Check for Rx-required medicines
        rx_medicines = [m for m in medicines.values() if m.is_prescription_required]
        controlled_medicines = [m for m in medicines.values() if m.is_controlled_substance]

        if rx_medicines:
            if not prescription_id:
                med_names = [m.name for m in rx_medicines]
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "code": "RX_REQUIRED",
                        "message": f"Prescription required for: {', '.join(med_names)}",
                        "medicines": med_names,
                    }
                )
            # Validate the prescription exists and is approved
            await self.validate_prescription(prescription_id)

        if controlled_medicines:
            # Controlled substances need manager+ role
            allowed_roles = [UserRole.SUPER_ADMIN, UserRole.REGIONAL_ADMIN, UserRole.STORE_MANAGER]
            if current_user.role not in allowed_roles:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "CONTROLLED_SUBSTANCE_RESTRICTED",
                        "message": "Controlled substances can only be dispensed by a Store Manager or higher.",
                    }
                )

        # Check requires_approval medicines
        approval_needed = [m for m in medicines.values() if m.requires_approval]
        if approval_needed and current_user.role == UserRole.SALES_STAFF:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "MANAGER_APPROVAL_REQUIRED",
                    "message": f"These medicines require manager approval to dispense: {', '.join(m.name for m in approval_needed)}",
                }
            )

    async def validate_prescription(self, prescription_id: int) -> Prescription:
        """Validate a prescription is approved and not expired."""
        from datetime import date
        result = await self.db.execute(
            select(Prescription).where(Prescription.id == prescription_id)
        )
        prescription = result.scalar_one_or_none()

        if not prescription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "PRESCRIPTION_NOT_FOUND", "message": f"Prescription #{prescription_id} not found."}
            )

        if prescription.status == PrescriptionStatus.REJECTED:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "PRESCRIPTION_REJECTED", "message": "This prescription has been rejected."}
            )

        if prescription.status == PrescriptionStatus.DISPENSED and not prescription.max_refills:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "PRESCRIPTION_ALREADY_DISPENSED", "message": "This prescription has already been dispensed."}
            )

        if prescription.status == PrescriptionStatus.EXPIRED:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "PRESCRIPTION_EXPIRED", "message": "This prescription has expired."}
            )

        if prescription.status == PrescriptionStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "PRESCRIPTION_NOT_APPROVED", "message": "This prescription is still pending pharmacist approval."}
            )

        # Check validity date
        if prescription.valid_until and prescription.valid_until < date.today():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "PRESCRIPTION_DATE_EXPIRED", "message": "This prescription is past its validity date."}
            )

        return prescription
