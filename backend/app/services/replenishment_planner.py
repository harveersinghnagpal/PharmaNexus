"""
Replenishment planning service.

Turns low-stock situations into actionable plans by deciding whether a shortage
can be covered by an inter-store transfer or needs external procurement.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.inventory import Inventory
from app.models.medicine import Medicine
from app.models.store import Store
from app.services.transfer_recommender import TransferRecommender


@dataclass
class ProcurementRecommendation:
    store_id: int
    store_name: str
    medicine_id: int
    medicine_name: str
    medicine_category: str
    current_quantity: int
    target_quantity: int
    reorder_quantity: int
    urgency_tag: str
    reason: str


class ReplenishmentPlanner:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def build_plan(self, store_id: Optional[int] = None, limit: int = 30) -> Dict[str, object]:
        transfer_recommender = TransferRecommender(self.db)
        transfers = await transfer_recommender.get_recommendations(store_id=store_id, limit=limit)

        query = (
            select(Inventory, Medicine, Store)
            .join(Medicine, Inventory.medicine_id == Medicine.id)
            .join(Store, Inventory.store_id == Store.id)
            .where(Inventory.total_quantity <= settings.LOW_STOCK_THRESHOLD)
        )
        if store_id:
            query = query.where(Inventory.store_id == store_id)

        result = await self.db.execute(query)
        rows = result.all()

        transfer_lookup = {(item.to_store_id, item.medicine_id): item for item in transfers}
        procurement_recommendations: List[ProcurementRecommendation] = []

        for inventory, medicine, store in rows:
            if (inventory.store_id, inventory.medicine_id) in transfer_lookup:
                continue

            target_quantity = max(settings.LOW_STOCK_THRESHOLD * 2, settings.LOW_STOCK_THRESHOLD + 10)
            reorder_quantity = max(target_quantity - inventory.total_quantity, settings.LOW_STOCK_THRESHOLD)
            urgency_tag = "PROCURE_NOW" if inventory.total_quantity == 0 else "RESTOCK_SOON"
            reason = (
                f"{medicine.name} is out of stock and no transfer source is available."
                if inventory.total_quantity == 0
                else f"Current quantity is {inventory.total_quantity}; raise stock to at least {target_quantity}."
            )

            procurement_recommendations.append(
                ProcurementRecommendation(
                    store_id=store.id,
                    store_name=store.name,
                    medicine_id=medicine.id,
                    medicine_name=medicine.name,
                    medicine_category=medicine.category,
                    current_quantity=inventory.total_quantity,
                    target_quantity=target_quantity,
                    reorder_quantity=reorder_quantity,
                    urgency_tag=urgency_tag,
                    reason=reason,
                )
            )

        summary = {
            "store_scope": store_id,
            "low_stock_items": len(rows),
            "transfer_candidates": len(transfers),
            "procurement_candidates": len(procurement_recommendations),
            "target_days_of_cover": 14,
        }

        return {
            "summary": summary,
            "transfer_recommendations": [
                {
                    "from_store_id": item.from_store_id,
                    "from_store_name": item.from_store_name,
                    "to_store_id": item.to_store_id,
                    "to_store_name": item.to_store_name,
                    "medicine_id": item.medicine_id,
                    "medicine_name": item.medicine_name,
                    "medicine_category": item.medicine_category,
                    "recommended_quantity": item.recommended_quantity,
                    "reason": item.reason,
                    "urgency_score": item.urgency_score,
                    "urgency_tag": item.urgency_tag,
                    "surplus_at_source": item.surplus_at_source,
                    "shortage_at_dest": item.shortage_at_dest,
                    "days_to_nearest_expiry": item.days_to_nearest_expiry,
                }
                for item in transfers
            ],
            "procurement_recommendations": [asdict(item) for item in procurement_recommendations],
        }
