"""
Seed script — run once to populate demo data.
Usage: python seed.py
"""
import asyncio
import random
from datetime import date, timedelta, datetime
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select

DATABASE_URL = "postgresql+asyncpg://pharma:pharma123@db:5432/pharmanexus"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def seed():
    # Import models after engine is set up
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))

    from app.core.database import Base, create_tables
    from app.models.user import User, UserRole
    from app.models.store import Store
    from app.models.medicine import Medicine
    from app.models.batch import Batch
    from app.models.inventory import Inventory
    from app.models.sales import Sale, SaleItem
    from app.core.security import get_password_hash

    # Override engine
    from app.core import database as db_module
    db_module.engine = engine
    db_module.AsyncSessionLocal = AsyncSessionLocal

    await create_tables()

    async with AsyncSessionLocal() as db:
        # Check if already seeded
        result = await db.execute(select(Store))
        if result.scalars().first():
            print("✅ DB already seeded. Skipping.")
            return

        # ── Stores ──────────────────────────────────────────
        stores = [
            Store(name="PharmaNexus Central", location="Connaught Place, Delhi", region="North"),
            Store(name="PharmaNexus West", location="Bandra, Mumbai", region="West"),
            Store(name="PharmaNexus South", location="Koramangala, Bangalore", region="South"),
        ]
        db.add_all(stores)
        await db.flush()

        # ── Users ────────────────────────────────────────────
        users = [
            User(name="Arjun Sharma", email="admin@pharmanexus.com",
                 password_hash=get_password_hash("admin123"), role=UserRole.SUPER_ADMIN),
            User(name="Priya Nair", email="regional@pharmanexus.com",
                 password_hash=get_password_hash("admin123"), role=UserRole.REGIONAL_ADMIN),
            User(name="Rahul Verma", email="manager@pharmanexus.com",
                 password_hash=get_password_hash("admin123"), role=UserRole.STORE_MANAGER,
                 store_id=stores[0].id),
            User(name="Sneha Patel", email="inventory@pharmanexus.com",
                 password_hash=get_password_hash("admin123"), role=UserRole.INVENTORY_SUPERVISOR,
                 store_id=stores[0].id),
            User(name="Mohan Das", email="sales@pharmanexus.com",
                 password_hash=get_password_hash("admin123"), role=UserRole.SALES_STAFF,
                 store_id=stores[0].id),
        ]
        db.add_all(users)
        await db.flush()

        # ── Medicines ────────────────────────────────────────
        medicine_data = [
            ("Paracetamol 500mg", "Analgesic", False, 12.50),
            ("Amoxicillin 500mg", "Antibiotic", True, 85.00),
            ("Cetirizine 10mg", "Antihistamine", False, 25.00),
            ("Omeprazole 20mg", "Gastrointestinal", False, 45.00),
            ("Metformin 500mg", "Antidiabetic", True, 35.00),
            ("Atorvastatin 10mg", "Cardiovascular", True, 120.00),
            ("Azithromycin 500mg", "Antibiotic", True, 95.00),
            ("Vitamin C 1000mg", "Supplement", False, 18.00),
            ("Ibuprofen 400mg", "Analgesic", False, 22.00),
            ("Pantoprazole 40mg", "Gastrointestinal", False, 55.00),
            ("Losartan 50mg", "Cardiovascular", True, 75.00),
            ("Vitamin D3 60K", "Supplement", False, 42.00),
            ("Levothyroxine 50mcg", "Thyroid", True, 65.00),
            ("Dolo 650", "Analgesic", False, 30.00),
            ("Montelukast 10mg", "Respiratory", True, 88.00),
            ("Clopidogrel 75mg", "Cardiovascular", True, 110.00),
            ("Folic Acid 5mg", "Supplement", False, 15.00),
            ("Metronidazole 400mg", "Antibiotic", True, 40.00),
            ("Diclofenac 50mg", "Analgesic", False, 28.00),
            ("Ranitidine 150mg", "Gastrointestinal", False, 20.00),
            ("Calcium Carbonate 500mg", "Supplement", False, 22.00),
            ("Amlodipine 5mg", "Cardiovascular", True, 58.00),
            ("Salbutamol Inhaler", "Respiratory", True, 145.00),
            ("Insulin Glargine", "Antidiabetic", True, 850.00),
            ("Cefixime 200mg", "Antibiotic", True, 92.00),
            ("Sertraline 50mg", "Antidepressant", True, 135.00),
            ("Gabapentin 300mg", "Neurological", True, 78.00),
            ("B-Complex Tablet", "Supplement", False, 35.00),
            ("ORS Sachet", "Electrolyte", False, 8.00),
            ("Antiseptic Cream 30g", "Topical", False, 55.00),
        ]

        medicines = []
        for name, cat, rx, price in medicine_data:
            m = Medicine(name=name, category=cat, is_prescription_required=rx, price=price)
            db.add(m)
            medicines.append(m)
        await db.flush()

        # ── Batches & Inventory ──────────────────────────────
        batch_counter = 1000
        inv_map = {}  # (medicine_id, store_id) -> quantity

        for store in stores:
            for med in medicines:
                qty = random.randint(5, 200)
                expiry_offset = random.choice([15, 25, 60, 120, 180, 365])
                exp_date = date.today() + timedelta(days=expiry_offset)
                cost = float(med.price) * random.uniform(0.55, 0.75)

                batch = Batch(
                    medicine_id=med.id,
                    store_id=store.id,
                    batch_number=f"BT-{batch_counter:04d}",
                    expiry_date=exp_date,
                    cost_price=round(cost, 2),
                    quantity=qty,
                )
                db.add(batch)
                batch_counter += 1

                key = (med.id, store.id)
                inv_map[key] = inv_map.get(key, 0) + qty

        await db.flush()

        # Inventory aggregates
        for (med_id, store_id), total_qty in inv_map.items():
            inv = Inventory(medicine_id=med_id, store_id=store_id, total_quantity=total_qty)
            db.add(inv)

        await db.flush()

        # ── Historical Sales (60 days) ────────────────────────
        # Reload batches for sale generation
        batch_result = await db.execute(
            select(Batch).where(Batch.quantity > 0)
        )
        all_batches = batch_result.scalars().all()

        sales_user = users[4]  # sales staff

        for day_offset in range(60):
            sale_date_offset = 60 - day_offset
            for store in stores:
                store_batches = [b for b in all_batches if b.store_id == store.id and b.quantity > 2]
                if not store_batches:
                    continue

                num_sales = random.randint(4, 12)
                for _ in range(num_sales):
                    n_items = random.randint(1, 4)
                    chosen = random.sample(store_batches, min(n_items, len(store_batches)))

                    total = 0
                    sale_items_data = []
                    valid = True
                    for batch in chosen:
                        max_qty = min(3, batch.quantity)
                        if max_qty < 1:
                            valid = False
                            break
                        qty = random.randint(1, max_qty)
                        if batch.quantity < qty:
                            valid = False
                            break
                        med_result = await db.execute(
                            select(Medicine).where(Medicine.id == batch.medicine_id)
                        )
                        med = med_result.scalar_one()
                        price = float(med.price)
                        total += price * qty
                        sale_items_data.append((batch, qty, price, med))

                    if not valid or not sale_items_data:
                        continue

                    sale_dt = datetime.now() - timedelta(days=sale_date_offset, hours=random.randint(0, 12))
                    sale = Sale(
                        store_id=store.id,
                        user_id=sales_user.id,
                        total_amount=round(total, 2),
                        created_at=sale_dt,
                    )
                    db.add(sale)
                    await db.flush()

                    for batch, qty, price, med in sale_items_data:
                        db.add(SaleItem(
                            sale_id=sale.id,
                            medicine_id=med.id,
                            batch_id=batch.id,
                            quantity=qty,
                            price=price,
                        ))
                        batch.quantity = max(0, batch.quantity - qty)

        await db.commit()
        print("✅ Seed complete!")
        print("\n📧 Demo Credentials (password: admin123):")
        print("  admin@pharmanexus.com       → Super Admin")
        print("  regional@pharmanexus.com    → Regional Admin")
        print("  manager@pharmanexus.com     → Store Manager")
        print("  inventory@pharmanexus.com   → Inventory Supervisor")
        print("  sales@pharmanexus.com       → Sales Staff")


if __name__ == "__main__":
    asyncio.run(seed())
