"""
Transfer Recommendation Engine — intelligently suggests inter-store stock movements.

Algorithm:
1. Compute per-store, per-medicine stock levels
2. Compute cross-store mean and std for each medicine
3. Flag "surplus" stores (stock > mean + 0.5*std) and "shortage" stores (stock <= threshold)
4. Apply expiry urgency multiplier for batches expiring within 14 days
5. Match each shortage store with the best available surplus store
6. Rank by urgency score (expiry risk × shortage severity)
"""
from typing import List, Dict, Optional
from datetime import date, timedelta
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from app.models.inventory import Inventory
from app.models.batch import Batch
from app.models.medicine import Medicine
from app.models.store import Store
from app.core.config import settings


@dataclass
class TransferRecommendation:
    from_store_id: int
    from_store_name: str
    to_store_id: int
    to_store_name: str
    medicine_id: int
    medicine_name: str
    medicine_category: str
    recommended_quantity: int
    reason: str
    urgency_score: float   # 0.0 – 10.0, higher = more urgent
    urgency_tag: str       # EXPIRY_RISK | CRITICAL_SHORTAGE | BALANCING
    surplus_at_source: int
    shortage_at_dest: int
    days_to_nearest_expiry: Optional[int]


class TransferRecommender:

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_recommendations(
        self,
        store_id: Optional[int] = None,
        limit: int = 20
    ) -> List[TransferRecommendation]:
        """Generate ranked transfer recommendations."""

        # 1. Load all inventory with medicine + store info
        query = (
            select(Inventory, Medicine, Store)
            .join(Medicine, Inventory.medicine_id == Medicine.id)
            .join(Store, Inventory.store_id == Store.id)
        )
        result = await self.db.execute(query)
        rows = result.all()

        if not rows:
            return []

        # 2. Build data structures
        # medicine_id -> {store_id -> quantity}
        stock_map: Dict[int, Dict[int, int]] = {}
        store_names: Dict[int, str] = {}
        medicine_info: Dict[int, Medicine] = {}

        for inv, med, store in rows:
            store_names[store.id] = store.name
            medicine_info[med.id] = med
            if med.id not in stock_map:
                stock_map[med.id] = {}
            stock_map[med.id][store.id] = inv.total_quantity

        # 3. Load expiry data (batches expiring within 30 days)
        expiry_threshold = date.today() + timedelta(days=30)
        expiry_query = (
            select(Batch)
            .where(Batch.expiry_date <= expiry_threshold)
            .where(Batch.quantity > 0)
        )
        expiry_result = await self.db.execute(expiry_query)
        expiring_batches = expiry_result.scalars().all()

        # medicine_id -> {store_id -> days_to_expiry}
        expiry_map: Dict[int, Dict[int, int]] = {}
        for batch in expiring_batches:
            days = (batch.expiry_date - date.today()).days
            if batch.medicine_id not in expiry_map:
                expiry_map[batch.medicine_id] = {}
            # Track minimum days to expiry per store
            existing = expiry_map[batch.medicine_id].get(batch.store_id, 999)
            expiry_map[batch.medicine_id][batch.store_id] = min(existing, days)

        # 4. Generate recommendations
        recommendations: List[TransferRecommendation] = []

        for med_id, store_stocks in stock_map.items():
            if len(store_stocks) < 2:
                continue  # Need at least 2 stores to recommend transfers

            med = medicine_info[med_id]
            quantities = list(store_stocks.values())
            mean_qty = sum(quantities) / len(quantities)
            threshold = settings.LOW_STOCK_THRESHOLD

            for dest_store_id, dest_qty in store_stocks.items():
                # Apply store filter if specified
                if store_id and dest_store_id != store_id:
                    continue

                if dest_qty > threshold:
                    continue  # Destination store is not in shortage

                # Find best surplus source
                surplus_stores = [
                    (sid, qty) for sid, qty in store_stocks.items()
                    if sid != dest_store_id and qty > mean_qty * 1.3  # 30% above mean = surplus
                ]

                if not surplus_stores:
                    # Check expiry-driven transfers even without typical surplus
                    surplus_stores = [
                        (sid, qty) for sid, qty in store_stocks.items()
                        if sid != dest_store_id and qty > threshold
                    ]

                if not surplus_stores:
                    continue

                # Pick the best surplus store (highest qty first, but expiry-urgent first)
                def source_score(item):
                    sid, qty = item
                    expiry_days = expiry_map.get(med_id, {}).get(sid, 999)
                    expiry_urgency = max(0, 30 - expiry_days) if expiry_days < 30 else 0
                    return expiry_urgency * 10 + qty

                surplus_stores.sort(key=source_score, reverse=True)
                src_store_id, src_qty = surplus_stores[0]

                # Calculate recommended quantity to transfer
                transfer_qty = min(
                    src_qty // 2,  # Transfer at most half of source stock
                    max(threshold * 2 - dest_qty, threshold)  # Enough to bring dest above 2x threshold
                )
                if transfer_qty <= 0:
                    continue

                # Calculate urgency score
                shortage_severity = max(0, threshold - dest_qty) / max(threshold, 1)
                expiry_days = expiry_map.get(med_id, {}).get(src_store_id, 999)
                expiry_urgency = max(0, 14 - expiry_days) / 14 if expiry_days <= 14 else 0

                urgency_score = min(10.0, shortage_severity * 5 + expiry_urgency * 5)

                # Determine reason
                if expiry_days <= 14:
                    reason = f"Source store has {expiry_days} days until nearest expiry — move before loss"
                    urgency_tag = "EXPIRY_RISK"
                    if urgency_score < 5:
                        urgency_score = 5.0  # Minimum urgency for expiry risk
                elif dest_qty == 0:
                    reason = f"{med.name} is completely out of stock at destination"
                    urgency_tag = "CRITICAL_SHORTAGE"
                    urgency_score = max(urgency_score, 8.0)
                else:
                    reason = f"Balance stock: source has {src_qty} units, destination has only {dest_qty}"
                    urgency_tag = "BALANCING"

                recommendations.append(TransferRecommendation(
                    from_store_id=src_store_id,
                    from_store_name=store_names.get(src_store_id, f"Store {src_store_id}"),
                    to_store_id=dest_store_id,
                    to_store_name=store_names.get(dest_store_id, f"Store {dest_store_id}"),
                    medicine_id=med_id,
                    medicine_name=med.name,
                    medicine_category=med.category,
                    recommended_quantity=transfer_qty,
                    reason=reason,
                    urgency_score=round(urgency_score, 2),
                    urgency_tag=urgency_tag,
                    surplus_at_source=src_qty,
                    shortage_at_dest=dest_qty,
                    days_to_nearest_expiry=expiry_days if expiry_days < 999 else None,
                ))

        # Sort by urgency descending
        recommendations.sort(key=lambda r: r.urgency_score, reverse=True)
        return recommendations[:limit]
