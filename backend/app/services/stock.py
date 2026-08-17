"""Central stock operations — inventory_batches are the source of truth."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from collections import defaultdict

from bson import ObjectId as BsonObjectId
from fastapi import HTTPException, status

from app.models.inventory import AdjustmentType, InventoryBatch, StockAdjustment
from app.models.product import Product


@dataclass
class BatchDeduction:
    product_id: str
    batch_id: str
    quantity: int
    unit_cost: float = 0.0


def batch_unit_cost(batch: InventoryBatch, product: Product | None) -> float:
    if batch.unit_cost and batch.unit_cost > 0:
        return batch.unit_cost
    if product:
        return product.cost_price
    return 0.0


def sort_batches_fefo(batches: list[InventoryBatch]) -> list[InventoryBatch]:
    """First-expiry-first-out; batches without expiry are consumed last."""

    def sort_key(batch: InventoryBatch) -> tuple[str, str]:
        expiry = batch.expiry_date or "9999-12-31"
        return expiry, batch.received_at.isoformat()

    return sorted(batches, key=sort_key)


async def get_batch_total(product_id: str) -> int:
    batches = await InventoryBatch.find(
        InventoryBatch.product_id == product_id,
        InventoryBatch.quantity > 0,
    ).to_list()
    return sum(batch.quantity for batch in batches)


async def get_current_stock(product_id: str) -> int:
    return await get_batch_total(product_id)


async def get_current_stock_batch(product_ids: list[str]) -> dict[str, int]:
    pipeline = [
        {"$match": {"product_id": {"$in": product_ids}, "quantity": {"$gt": 0}}},
        {"$group": {"_id": "$product_id", "total": {"$sum": "$quantity"}}},
    ]
    rows = await InventoryBatch.aggregate(pipeline).to_list()
    return {row["_id"]: row["total"] for row in rows}


async def refresh_product_stock(product: Product) -> int:
    total = await get_batch_total(str(product.id))
    await product.set({"stock": total, "updated_at": datetime.now(timezone.utc)})
    return total


async def refresh_all_product_stocks() -> None:
    products = await Product.find(Product.is_active == True).to_list()  # noqa: E712
    for product in products:
        await refresh_product_stock(product)


async def get_sorted_batches(product_id: str) -> list[InventoryBatch]:
    batches = await InventoryBatch.find(InventoryBatch.product_id == product_id).to_list()
    return sort_batches_fefo(batches)


async def get_batches_for_products(
    product_ids: list[str],
) -> dict[str, list[InventoryBatch]]:
    """Load batches for many products in one query (avoids N+1 on inventory list)."""
    if not product_ids:
        return {}
    batches = await InventoryBatch.find({"product_id": {"$in": product_ids}}).to_list()
    grouped: dict[str, list[InventoryBatch]] = defaultdict(list)
    for batch in batches:
        grouped[batch.product_id].append(batch)
    return {pid: sort_batches_fefo(grouped[pid]) for pid in product_ids}


async def check_stock_available(product_id: str, quantity: int) -> None:
    if quantity <= 0:
        return
    available = await get_batch_total(product_id)
    if available < quantity:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient stock. Available: {available}, requested: {quantity}",
        )


async def deduct_stock_fefo(product_id: str, quantity: int) -> list[BatchDeduction]:
    if quantity <= 0:
        return []

    batches = await InventoryBatch.find(
        InventoryBatch.product_id == product_id,
        InventoryBatch.quantity > 0,
    ).to_list()
    available = sum(batch.quantity for batch in batches)
    if available < quantity:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient stock. Available: {available}, requested: {quantity}",
        )

    product = await Product.get(product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
    fallback_cost = product.cost_price

    deductions: list[BatchDeduction] = []
    remaining = quantity
    for batch in sort_batches_fefo(batches):
        if remaining <= 0:
            break
        # Re-read quantity from the in-memory batch; race may have depleted it.
        deduct = min(batch.quantity, remaining)
        if deduct <= 0:
            continue
        col = InventoryBatch.get_motor_collection()
        result = await col.update_one(
            {"_id": batch.id, "quantity": {"$gte": deduct}},
            {"$inc": {"quantity": -deduct}},
        )
        if result.matched_count != 1:
            # Concurrent sale won this batch — skip and try next / re-check at end.
            continue
        deductions.append(BatchDeduction(
            product_id=product_id,
            batch_id=str(batch.id),
            quantity=deduct,
            unit_cost=batch_unit_cost(batch, product),
        ))
        remaining -= deduct

    if remaining > 0:
        if deductions:
            await restock_from_deductions(deductions)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient stock (concurrent update). Could not allocate {remaining} unit(s).",
        )

    return deductions


async def restock_from_deductions(deductions: list[BatchDeduction]) -> None:
    """Restore quantities deducted during a failed sale."""
    touched_products: set[str] = set()
    for d in deductions:
        col = InventoryBatch.get_motor_collection()
        await col.update_one(
            {"_id": BsonObjectId(d.batch_id)},
            {"$inc": {"quantity": d.quantity}},
        )
        touched_products.add(d.product_id)

    for product_id in touched_products:
        product = await Product.get(product_id)


async def _insert_adjustment(
    *,
    product: Product,
    quantity: int,
    adjustment_type: AdjustmentType,
    reason: str,
    created_by: str,
    stock_before: int,
    stock_after: int,
    batch_id: str | None = None,
    transaction_id: str | None = None,
    reference_type: str = "",
    reference_id: str = "",
    unit_cost: float = 0.0,
    unit_selling_price: float = 0.0,
    line_discount: float = 0.0,
    category: str = "",
) -> StockAdjustment:
    qty_abs = abs(quantity)
    cost = unit_cost if unit_cost > 0 else product.cost_price
    extended_cost = round(qty_abs * cost, 2)
    net_unit = max(0.0, unit_selling_price - line_discount) if unit_selling_price else 0.0
    extended_revenue = round(qty_abs * net_unit, 2) if unit_selling_price else 0.0
    adjustment = StockAdjustment(
        product_id=str(product.id),
        product_name=product.name,
        product_sku=product.sku,
        batch_id=batch_id,
        transaction_id=transaction_id,
        reference_type=reference_type,
        reference_id=reference_id,
        type=adjustment_type,
        quantity=quantity,
        stock_before=stock_before,
        stock_after=stock_after,
        unit_cost=round(cost, 4),
        extended_cost=extended_cost,
        unit_selling_price=unit_selling_price,
        extended_revenue=extended_revenue,
        line_discount=line_discount,
        category=category or product.category,
        reason=reason,
        created_by=created_by,
    )
    await adjustment.insert()
    return adjustment


async def record_inventory_change(
    *,
    product: Product,
    quantity: int,
    adjustment_type: AdjustmentType,
    reason: str,
    created_by: str,
    stock_before: int,
    stock_after: int,
    batch_id: str | None = None,
    transaction_id: str | None = None,
    reference_type: str = "",
    reference_id: str = "",
    unit_cost: float = 0.0,
    unit_selling_price: float = 0.0,
    line_discount: float = 0.0,
    category: str = "",
) -> StockAdjustment:
    """Public helper for logging inventory changes from sales and other services."""
    ref_type = reference_type or (adjustment_type.value if adjustment_type != AdjustmentType.sale else "sale")
    ref_id = reference_id or transaction_id or ""
    return await _insert_adjustment(
        product=product,
        quantity=quantity,
        adjustment_type=adjustment_type,
        reason=reason,
        created_by=created_by,
        stock_before=stock_before,
        stock_after=stock_after,
        batch_id=batch_id,
        transaction_id=transaction_id,
        reference_type=ref_type,
        reference_id=ref_id,
        unit_cost=unit_cost,
        unit_selling_price=unit_selling_price,
        line_discount=line_discount,
        category=category,
    )


async def receive_stock(
    product_id: str,
    batch_number: str,
    quantity: int,
    *,
    expiry_date: str | None = None,
    purchase_order_id: str | None = None,
    unit_cost: float | None = None,
    unit_selling_price: float | None = None,
    created_by: str = "System",
) -> InventoryBatch:
    if quantity < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Quantity must be at least 1")

    product = await Product.get(product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")

    stock_before = await get_current_stock(product_id)
    landed_cost = unit_cost if unit_cost is not None and unit_cost > 0 else product.cost_price
    selling_price = (
        unit_selling_price
        if unit_selling_price is not None and unit_selling_price >= 0
        else product.selling_price
    )

    batch = InventoryBatch(
        product_id=product_id,
        batch_number=batch_number,
        quantity=quantity,
        unit_cost=landed_cost,
        expiry_date=expiry_date,
        purchase_order_id=purchase_order_id,
        received_at=datetime.now(timezone.utc),
    )
    await batch.insert()

    stock_after = await get_current_stock(product_id)
    reason = f"Received batch {batch_number}"
    ref_type = "receive"
    ref_id = str(batch.id)
    if purchase_order_id:
        reason = f"PO receive — batch {batch_number}"
        ref_type = "purchase_order"
        ref_id = purchase_order_id

    await _insert_adjustment(
        product=product,
        quantity=quantity,
        adjustment_type=AdjustmentType.receive,
        reason=reason,
        created_by=created_by,
        stock_before=stock_before,
        stock_after=stock_after,
        batch_id=str(batch.id),
        reference_type=ref_type,
        reference_id=ref_id,
        unit_cost=landed_cost,
        unit_selling_price=selling_price,
    )
    from app.services.response_cache import bump_commerce_caches
    await bump_commerce_caches()
    return batch


async def adjust_stock(
    product_id: str,
    quantity: int,
    adjustment_type: AdjustmentType,
    reason: str,
    created_by: str,
    batch_id: str | None = None,
) -> int:
    if quantity == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Quantity cannot be zero")

    product = await Product.get(product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")

    stock_before = await get_current_stock(product_id)
    affected_batch_id = batch_id

    if batch_id:
        batch = await InventoryBatch.get(batch_id)
        if not batch or batch.product_id != product_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Batch not found")
        if quantity < 0 and batch.quantity + quantity < 0:
            new_qty = 0
        else:
            new_qty = batch.quantity + quantity
        col = InventoryBatch.get_motor_collection()
        await col.update_one(
            {"_id": batch.id},
            {"$set": {"quantity": max(0, new_qty)}},
        )
    elif quantity < 0:
        await deduct_stock_fefo(product_id, abs(quantity))
    else:
        batch = InventoryBatch(
            product_id=product_id,
            batch_number=f"ADJ-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
            quantity=quantity,
            unit_cost=product.cost_price,
            received_at=datetime.now(timezone.utc),
        )
        await batch.insert()
        affected_batch_id = str(batch.id)

    stock_after = await get_current_stock(product_id)

    await _insert_adjustment(
        product=product,
        quantity=quantity,
        adjustment_type=adjustment_type,
        reason=reason,
        created_by=created_by,
        stock_before=stock_before,
        stock_after=stock_after,
        batch_id=affected_batch_id,
        reference_type=adjustment_type.value,
        reference_id=affected_batch_id or "",
        unit_cost=product.cost_price,
    )

    from app.services.response_cache import bump_commerce_caches
    await bump_commerce_caches()
    return stock_after


async def expiring_product_ids(within_days: int = 30) -> set[str]:
    today = date.today().isoformat()
    cutoff = (date.today() + timedelta(days=within_days)).isoformat()
    batches = await InventoryBatch.find(
        InventoryBatch.quantity > 0,
        {"expiry_date": {"$gte": today, "$lte": cutoff}},
    ).to_list()
    return {batch.product_id for batch in batches}


def nearest_expiry(batches: list[InventoryBatch]) -> str | None:
    active = [batch for batch in batches if batch.quantity > 0 and batch.expiry_date]
    if not active:
        return None
    return min(batch.expiry_date for batch in active if batch.expiry_date)
