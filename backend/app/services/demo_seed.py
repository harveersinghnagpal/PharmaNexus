"""
Development/demo data bootstrap.

Ensures the app has enough realistic data to render dashboards in environments
where the database exists but the full seed script was never executed.
"""
from __future__ import annotations

import random
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash, verify_password
from app.models.batch import Batch
from app.models.inventory import Inventory
from app.models.medicine import Medicine
from app.models.sales import Sale, SaleItem
from app.models.store import Store
from app.models.user import User, UserRole


STORE_DATA = [
    ("PharmaNexus Central", "Connaught Place, Delhi", "North"),
    ("PharmaNexus West", "Bandra, Mumbai", "West"),
    ("PharmaNexus South", "Koramangala, Bangalore", "South"),
]

USER_DATA = [
    ("Arjun Sharma", "admin@pharmanexus.com", UserRole.SUPER_ADMIN, None),
    ("Priya Nair", "regional@pharmanexus.com", UserRole.REGIONAL_ADMIN, None),
    ("Rahul Verma", "manager@pharmanexus.com", UserRole.STORE_MANAGER, 0),
    ("Sneha Patel", "inventory@pharmanexus.com", UserRole.INVENTORY_SUPERVISOR, 0),
    ("Mohan Das", "sales@pharmanexus.com", UserRole.SALES_STAFF, 0),
]

DEFAULT_DEMO_PASSWORD = "PharmaNexus@2026!"
LEGACY_DEMO_PASSWORD = "admin123"

MEDICINE_DATA = [
    ("Paracetamol 500mg", "Analgesic", False, False, False, Decimal("12.50")),
    ("Amoxicillin 500mg", "Antibiotic", True, False, False, Decimal("85.00")),
    ("Cetirizine 10mg", "Antihistamine", False, False, False, Decimal("25.00")),
    ("Omeprazole 20mg", "Gastrointestinal", False, False, False, Decimal("45.00")),
    ("Metformin 500mg", "Antidiabetic", True, False, False, Decimal("35.00")),
    ("Atorvastatin 10mg", "Cardiovascular", True, False, False, Decimal("120.00")),
    ("Azithromycin 500mg", "Antibiotic", True, False, False, Decimal("95.00")),
    ("Vitamin C 1000mg", "Supplement", False, False, False, Decimal("18.00")),
    ("Ibuprofen 400mg", "Analgesic", False, False, False, Decimal("22.00")),
    ("Losartan 50mg", "Cardiovascular", True, False, False, Decimal("75.00")),
    ("Salbutamol Inhaler", "Respiratory", True, False, False, Decimal("145.00")),
    ("Insulin Glargine", "Antidiabetic", True, True, True, Decimal("850.00")),
    ("Sertraline 50mg", "Antidepressant", True, False, True, Decimal("135.00")),
]


async def ensure_demo_data(db: AsyncSession) -> None:
    random.seed(42)

    stores = await _ensure_stores(db)
    await _ensure_users(db, stores)
    medicines = await _ensure_medicines(db)
    await _ensure_inventory(db, stores, medicines)
    await _ensure_sales_history(db, stores)


async def _ensure_stores(db: AsyncSession) -> list[Store]:
    result = await db.execute(select(Store).order_by(Store.id))
    stores = list(result.scalars().all())
    if stores:
        return stores

    stores = [Store(name=name, location=location, region=region) for name, location, region in STORE_DATA]
    db.add_all(stores)
    await db.flush()
    await db.commit()
    return stores


async def _ensure_users(db: AsyncSession, stores: list[Store]) -> None:
    result = await db.execute(select(User))
    existing_users = {user.email: user for user in result.scalars().all()}
    new_users = []
    updated_existing_user = False

    for name, email, role, store_index in USER_DATA:
        existing_user = existing_users.get(email)
        if existing_user:
            if verify_password(LEGACY_DEMO_PASSWORD, existing_user.password_hash):
                existing_user.password_hash = get_password_hash(DEFAULT_DEMO_PASSWORD)
                updated_existing_user = True
            continue
        store_id = stores[store_index].id if store_index is not None and stores else None
        new_users.append(
            User(
                name=name,
                email=email,
                password_hash=get_password_hash(DEFAULT_DEMO_PASSWORD),
                role=role,
                store_id=store_id,
            )
        )

    if new_users:
        db.add_all(new_users)
    if new_users or updated_existing_user:
        await db.commit()


async def _ensure_medicines(db: AsyncSession) -> list[Medicine]:
    result = await db.execute(select(Medicine).order_by(Medicine.id))
    medicines = list(result.scalars().all())
    if medicines:
        return medicines

    medicines = [
        Medicine(
            name=name,
            category=category,
            is_prescription_required=is_rx,
            is_controlled_substance=is_controlled,
            requires_approval=requires_approval,
            price=price,
        )
        for name, category, is_rx, is_controlled, requires_approval, price in MEDICINE_DATA
    ]
    db.add_all(medicines)
    await db.flush()
    await db.commit()
    return medicines


async def _ensure_inventory(db: AsyncSession, stores: list[Store], medicines: list[Medicine]) -> None:
    inventory_count = (await db.execute(select(func.count(Inventory.id)))).scalar_one()
    if inventory_count:
        return

    batch_counter = 1000
    inventory_rows = []
    for store in stores:
        for medicine in medicines:
            qty = random.randint(20, 180)
            expiry_offset = random.choice([20, 40, 90, 180, 365])
            batch = Batch(
                medicine_id=medicine.id,
                store_id=store.id,
                batch_number=f"BT-{batch_counter:04d}",
                expiry_date=date.today() + timedelta(days=expiry_offset),
                cost_price=Decimal(str(round(float(medicine.price) * random.uniform(0.55, 0.75), 2))),
                quantity=qty,
            )
            db.add(batch)
            inventory_rows.append(
                Inventory(
                    medicine_id=medicine.id,
                    store_id=store.id,
                    total_quantity=qty,
                )
            )
            batch_counter += 1

    db.add_all(inventory_rows)
    await db.commit()


async def _ensure_sales_history(db: AsyncSession, stores: list[Store]) -> None:
    sales_count = (await db.execute(select(func.count(Sale.id)))).scalar_one()
    if sales_count:
        return

    sales_user = (
        await db.execute(select(User).where(User.role == UserRole.SALES_STAFF).order_by(User.id))
    ).scalars().first()
    if not sales_user:
        sales_user = (await db.execute(select(User).order_by(User.id))).scalars().first()
    if not sales_user:
        return

    all_batches = list((await db.execute(select(Batch).where(Batch.quantity > 5).order_by(Batch.id))).scalars().all())
    medicines = {
        medicine.id: medicine
        for medicine in (await db.execute(select(Medicine).order_by(Medicine.id))).scalars().all()
    }
    inventory_rows = (
        await db.execute(select(Inventory).order_by(Inventory.store_id, Inventory.medicine_id))
    ).scalars().all()
    inventory_map = {(row.store_id, row.medicine_id): row for row in inventory_rows}
    if not all_batches:
        return

    for day_offset in range(60):
        sale_date_offset = 60 - day_offset
        for store in stores:
            store_batches = [batch for batch in all_batches if batch.store_id == store.id and batch.quantity > 3]
            if not store_batches:
                continue

            for _ in range(random.randint(4, 9)):
                chosen_batches = random.sample(store_batches, min(random.randint(1, 4), len(store_batches)))
                sale_items_data = []
                total = Decimal("0")

                for batch in chosen_batches:
                    max_qty = min(3, batch.quantity)
                    if max_qty < 1:
                        continue

                    medicine = medicines.get(batch.medicine_id)
                    if medicine is None:
                        continue

                    qty = random.randint(1, max_qty)
                    price = Decimal(str(medicine.price))
                    total += price * qty
                    sale_items_data.append((batch, medicine, qty, price))

                if not sale_items_data:
                    continue

                sale_dt = datetime.now() - timedelta(days=sale_date_offset, hours=random.randint(0, 12))
                sale = Sale(
                    store_id=store.id,
                    user_id=sales_user.id,
                    total_amount=total,
                    payment_method=random.choice(["cash", "card", "upi"]),
                    created_at=sale_dt,
                )
                db.add(sale)
                await db.flush()

                for batch, medicine, qty, price in sale_items_data:
                    db.add(
                        SaleItem(
                            sale_id=sale.id,
                            medicine_id=medicine.id,
                            batch_id=batch.id,
                            quantity=qty,
                            price=price,
                        )
                    )
                    batch.quantity = max(0, batch.quantity - qty)
                    inventory = inventory_map.get((store.id, medicine.id))
                    if inventory:
                        inventory.total_quantity = max(0, inventory.total_quantity - qty)

    await db.commit()
