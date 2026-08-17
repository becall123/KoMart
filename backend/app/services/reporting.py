"""Shared helpers for report aggregation."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from beanie import PydanticObjectId

from app.models.expense import Expense
from app.models.inventory import InventoryBatch
from app.models.product import Product
from app.models.transaction import Transaction, TransactionItem, TransactionStatus
from app.services.stock import get_current_stock_batch


def parse_date_range(start_date: str, end_date: str) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = datetime.fromisoformat(start_date) if start_date else now - timedelta(days=30)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(end_date) if end_date else now
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    end = end.replace(hour=23, minute=59, second=59, microsecond=999999)
    return start, end


async def fetch_transactions(start: datetime, end: datetime) -> list[Transaction]:
    return await Transaction.find({
        "created_at": {"$gte": start, "$lte": end},
        "status": {"$ne": TransactionStatus.voided.value},
    }).to_list()


def line_revenue(item: TransactionItem) -> float:
    return item.price * item.quantity - item.discount * item.quantity


def line_cogs(item: TransactionItem, product: Product | None) -> float:
    unit_cost = getattr(item, "unit_cost", 0.0) or 0.0
    if unit_cost > 0:
        return unit_cost * item.quantity
    if product:
        return product.cost_price * item.quantity
    return 0.0


def _object_ids(product_ids: set[str]) -> list[PydanticObjectId]:
    ids: list[PydanticObjectId] = []
    for pid in product_ids:
        try:
            ids.append(PydanticObjectId(pid))
        except Exception:
            continue
    return ids


async def build_product_cache(product_ids: set[str]) -> dict[str, Product]:
    """Load products in a single query instead of one get() per id."""
    if not product_ids:
        return {}
    oids = _object_ids(product_ids)
    if not oids:
        return {}
    products = await Product.find({"_id": {"$in": oids}}).to_list()
    return {str(product.id): product for product in products}


async def aggregate_sales_total(
    since: datetime,
    until: datetime | None = None,
) -> float:
    match: dict[str, Any] = {
        "created_at": {"$gte": since},
        "status": {"$ne": TransactionStatus.voided.value},
    }
    if until is not None:
        match["created_at"]["$lte"] = until
    pipeline = [
        {"$match": match},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}},
    ]
    rows = await Transaction.aggregate(pipeline).to_list()
    return float(rows[0]["total"]) if rows else 0.0


async def aggregate_sales_by_day(start: datetime, end: datetime) -> dict[str, float]:
    pipeline = [
        {
            "$match": {
                "created_at": {"$gte": start, "$lte": end},
                "status": {"$ne": TransactionStatus.voided.value},
            },
        },
        {
            "$group": {
                "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
                "revenue": {"$sum": "$total"},
            },
        },
    ]
    rows = await Transaction.aggregate(pipeline).to_list()
    return {row["_id"]: float(row["revenue"]) for row in rows}


async def aggregate_batch_inventory_value() -> float:
    """
    Batch-weighted valuation: sum(qty * unit_cost) per product from active batches.
    """
    batch_pipeline = [
        {"$match": {"quantity": {"$gt": 0}}},
        {
            "$group": {
                "_id": "$product_id",
                "batch_value": {"$sum": {"$multiply": ["$quantity", "$unit_cost"]}},
            },
        },
    ]
    batch_rows = await InventoryBatch.aggregate(batch_pipeline).to_list()
    return round(sum(float(row["batch_value"]) for row in batch_rows), 2)


async def aggregate_product_inventory_stats() -> dict[str, float | int]:
    products = await Product.find(Product.is_active == True).to_list()  # noqa: E712
    product_ids = [str(p.id) for p in products]
    stock_map = await get_current_stock_batch(product_ids)

    total_products = len(products)
    low_stock = 0
    out_of_stock = 0
    for product in products:
        stock = stock_map.get(str(product.id), 0)
        if stock == 0:
            out_of_stock += 1
        elif stock <= product.low_stock_threshold:
            low_stock += 1

    inventory_value = await aggregate_batch_inventory_value()
    return {
        "total_products": total_products,
        "inventory_value": inventory_value,
        "low_stock": low_stock,
        "out_of_stock": out_of_stock,
    }


async def aggregate_expense_total_since(date_gte: str) -> float:
    pipeline = [
        {"$match": {"date": {"$gte": date_gte}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]
    rows = await Expense.aggregate(pipeline).to_list()
    return float(rows[0]["total"]) if rows else 0.0


async def aggregate_operating_expense_total_since(date_gte: str) -> float:
    """Sum expenses since date, excluding setup / investment costs."""
    from app.services.expense_helpers import SETUP_INVESTMENT_MATCH

    pipeline = [
        {"$match": {"date": {"$gte": date_gte}}},
        {
            "$group": {
                "_id": None,
                "total": {"$sum": "$amount"},
                "setup": {"$sum": {"$cond": [SETUP_INVESTMENT_MATCH, "$amount", 0]}},
            },
        },
    ]
    rows = await Expense.aggregate(pipeline).to_list()
    if not rows:
        return 0.0
    return float(rows[0]["total"] or 0) - float(rows[0]["setup"] or 0)


async def aggregate_sold_product_ids(since: datetime) -> set[str]:
    pipeline = [
        {"$match": {"created_at": {"$gte": since}}},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.product_id"}},
    ]
    rows = await Transaction.aggregate(pipeline).to_list()
    return {row["_id"] for row in rows if row["_id"]}


async def aggregate_last_sale_before(
    product_ids: list[str],
    before: datetime,
) -> dict[str, datetime]:
    if not product_ids:
        return {}
    pipeline = [
        {"$match": {"created_at": {"$lt": before}}},
        {"$unwind": "$items"},
        {"$match": {"items.product_id": {"$in": product_ids}}},
        {"$group": {"_id": "$items.product_id", "last_sale": {"$max": "$created_at"}}},
    ]
    rows = await Transaction.aggregate(pipeline).to_list()
    return {row["_id"]: row["last_sale"] for row in rows}


def collect_product_ids(txns: list[Transaction]) -> set[str]:
    ids: set[str] = set()
    for txn in txns:
        for item in txn.items:
            ids.add(item.product_id)
    return ids


def days_until(expiry: str) -> int:
    expiry_date = date.fromisoformat(expiry)
    return (expiry_date - date.today()).days


async def aggregate_inventory_by_category() -> list[dict[str, Any]]:
    products = await Product.find(Product.is_active == True).to_list()  # noqa: E712
    product_ids = [str(p.id) for p in products]
    stock_map = await get_current_stock_batch(product_ids)

    by_category: dict[str, dict[str, Any]] = {}
    for product in products:
        pid = str(product.id)
        stock = stock_map.get(pid, 0)
        cat = product.category or "Uncategorized"
        entry = by_category.setdefault(cat, {
            "category": cat,
            "sku_count": 0,
            "total_stock": 0,
            "stock_value": 0.0,
        })
        entry["sku_count"] += 1
        entry["total_stock"] += stock
        entry["stock_value"] += stock * product.cost_price

    result = list(by_category.values())
    result.sort(key=lambda x: x["stock_value"], reverse=True)
    return result


def fill_daily_revenue(
    start: datetime,
    end: datetime,
    daily_totals: dict[str, float],
) -> list[tuple[str, float]]:
    daily: dict[str, float] = {}
    current = start.replace(hour=0, minute=0, second=0, microsecond=0)
    end_day = end.replace(hour=0, minute=0, second=0, microsecond=0)
    while current <= end_day:
        key = current.strftime("%Y-%m-%d")
        daily[key] = daily_totals.get(key, 0.0)
        current += timedelta(days=1)
    return sorted(daily.items())
