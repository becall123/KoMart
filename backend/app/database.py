from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
import os

from app.config import settings
from app.models.product import ProductStatus
from app.models import (
    User,
    Product,
    InventoryBatch,
    StockAdjustment,
    Supplier,
    PurchaseOrder,
    Customer,
    Transaction,
    Notification,
    StoreSettings,
    Expense,
    Category,
    Uom,
    RefreshToken,
    AuditLog,
    DiscountRule,
    DayClose,
    PriceHistory,
    WalletLedgerEntry,
    CacheEntry,
)

_motor_client: AsyncIOMotorClient | None = None


def get_motor_client() -> AsyncIOMotorClient:
    if _motor_client is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    return _motor_client


async def _drop_conflicting_indexes(db) -> None:
    """Drop old indexes whose options changed (e.g. non-unique → unique)."""
    migrations = [
        ("users", "email_1"),
        ("purchase_orders", "order_number_1"),
        ("discount_rules", "code_1"),
        ("refresh_tokens", "expires_at_1"),
    ]
    for collection_name, index_name in migrations:
        try:
            await db[collection_name].drop_index(index_name)
        except Exception:
            pass  # index doesn't exist or already dropped


async def _run_startup_migrations() -> None:
    """One-time data backfills — run via CLI/local start, not every Vercel cold start."""
    # Backfill legacy products created before status field existed.
    await Product.get_motor_collection().update_many(
        {"$or": [{"status": {"$exists": False}}, {"status": None}]},
        {"$set": {"status": ProductStatus.active.value}},
    )
    # Backfill UOM fields on legacy products.
    await Product.get_motor_collection().update_many(
        {"buy_uom": {"$exists": False}},
        [{"$set": {
            "buy_uom": {"$ifNull": ["$uom", "pcs"]},
            "units_per_buy_uom": 1,
            "sell_mode": "unit",
        }}],
    )
    await Product.get_motor_collection().update_many(
        {"pack_selling_price": {"$exists": False}},
        {"$set": {"pack_selling_price": 0.0}},
    )
    # Rename legacy payment method card → bank.
    await Transaction.get_motor_collection().update_many(
        {"payment_method": "card"},
        {"$set": {"payment_method": "bank"}},
    )
    await Expense.get_motor_collection().update_many(
        {"payment_method": "card"},
        {"$set": {"payment_method": "bank"}},
    )
    await StoreSettings.get_motor_collection().update_many(
        {"default_payment_method": "card"},
        {"$set": {"default_payment_method": "bank"}},
    )
    await _seed_default_uoms()
    # Assign 2-digit category codes + seed SKU sequences for 6-digit CCNNNN SKUs.
    from app.services.sku import backfill_category_sku_codes
    await backfill_category_sku_codes()
    # Seed wallet ledger from historical sales/expenses once (idempotent).
    from app.services.wallet_ledger import ensure_backfill
    await ensure_backfill(created_by="system")


async def init_db() -> None:
    """Connect Motor + Beanie. Heavy migrations are skipped on Vercel cold starts."""
    global _motor_client
    on_vercel = bool(os.getenv("VERCEL"))
    motor_kwargs: dict = {
        "serverSelectionTimeoutMS": 5_000,
        "connectTimeoutMS": 10_000,
        "socketTimeoutMS": 20_000,
        # Serverless: small pool; local/dev can use a larger pool.
        "maxPoolSize": 10 if on_vercel else 50,
        "minPoolSize": 0,
    }
    if on_vercel:
        motor_kwargs["maxIdleTimeMS"] = 30_000
    _motor_client = AsyncIOMotorClient(settings.mongo_url, **motor_kwargs)
    client = _motor_client
    db = client[settings.mongo_db_name]

    run_migrations = not settings.skip_startup_migrations
    if run_migrations:
        await _drop_conflicting_indexes(db)

    await init_beanie(
        database=db,
        document_models=[
            User,
            Product,
            InventoryBatch,
            StockAdjustment,
            Supplier,
            PurchaseOrder,
            Customer,
            Transaction,
            Notification,
            StoreSettings,
            Expense,
            Category,
            Uom,
            RefreshToken,
            AuditLog,
            DiscountRule,
            DayClose,
            PriceHistory,
            WalletLedgerEntry,
            CacheEntry,
        ],
    )

    if run_migrations:
        await _run_startup_migrations()


DEFAULT_UOMS: list[tuple[str, str]] = [
    ("pcs", "Pieces (pcs)"),
    ("pack", "Pack"),
    ("box", "Box"),
    ("bag", "Bag"),
    ("bottle", "Bottle"),
    ("can", "Can"),
    ("cup", "Cup"),
    ("dozen", "Dozen"),
    ("kg", "Kilogram (kg)"),
    ("g", "Gram (g)"),
    ("L", "Liter (L)"),
    ("ml", "Milliliter (ml)"),
]


async def _seed_default_uoms() -> None:
    if await Uom.count() > 0:
        return
    for code, label in DEFAULT_UOMS:
        await Uom(code=code, label=label).insert()
