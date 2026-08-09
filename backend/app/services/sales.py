"""Sale recording — transactions as the sales ledger with stock audit trail."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.models.customer import Customer, MembershipTier
from app.models.transaction import Transaction, TransactionItem, BatchAllocation, TransactionStatus
from app.models.inventory import AdjustmentType, StockAdjustment
from app.models.product import (
    Product,
    SellMode,
    product_is_billable,
    billable_rejection_detail,
    _pack_billable_price,
)
from app.schemas.transaction import TransactionCreate, TransactionResponse
from app.services.stock import (
    BatchDeduction,
    check_stock_available,
    deduct_stock_fefo,
    record_inventory_change,
    restock_from_deductions,
)
from app.services.store_settings import get_store_settings
from app.services.time_nepal import resolve_sale_created_at
from beanie import PydanticObjectId


def _base_quantity(item: TransactionItem) -> int:
    factor = getattr(item, "unit_factor", None) or 1
    return item.quantity * max(1, factor)


def _resolve_server_line_pricing(product: Product, sell_uom: str) -> tuple[float, int, str]:
    """
    Authoritative unit price + factor from catalog (mirrors frontend uomSell).
    Returns (price, unit_factor, normalized_sell_uom).
    """
    units = int(getattr(product, "units_per_buy_uom", 1) or 1)
    mode = getattr(product, "sell_mode", SellMode.unit) or SellMode.unit
    buy_uom = (getattr(product, "buy_uom", None) or "").strip()
    base_uom = (getattr(product, "uom", None) or buy_uom or "").strip()
    requested = (sell_uom or "").strip()

    def _eq(a: str, b: str) -> bool:
        return bool(a) and bool(b) and a.casefold() == b.casefold()

    pack_price = _pack_billable_price(product)
    piece_price = float(product.selling_price or 0)

    want_pack = False
    if mode == SellMode.piece:
        want_pack = False
    elif mode == SellMode.unit and units > 1:
        want_pack = True
    elif mode == SellMode.both and units > 1:
        if requested and _eq(requested, buy_uom):
            want_pack = True
        elif requested and _eq(requested, base_uom):
            want_pack = False
        else:
            # Default to piece when ambiguous; pack if only pack is billable.
            want_pack = piece_price <= 0 and pack_price > 0

    if want_pack and units > 1 and pack_price > 0 and buy_uom:
        return round(pack_price, 2), units, buy_uom
    if piece_price <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=billable_rejection_detail(product),
        )
    return round(piece_price, 2), 1, base_uom or buy_uom or requested


async def _load_products_map(product_ids: list[str]) -> dict[str, Product]:
    ids = list(dict.fromkeys(product_ids))
    if not ids:
        return {}
    products = await Product.find(
        {"_id": {"$in": [PydanticObjectId(pid) for pid in ids]}},
    ).to_list()
    return {str(p.id): p for p in products}


def _compute_tier(total_spent: float) -> MembershipTier:
    if total_spent >= 100000:
        return MembershipTier.platinum
    if total_spent >= 50000:
        return MembershipTier.gold
    if total_spent >= 25000:
        return MembershipTier.silver
    return MembershipTier.bronze


async def _next_txn_number() -> str:
    settings = await get_store_settings()
    prefix_base = (settings.transaction_prefix or "TXN").strip().upper()
    prefix = f"{prefix_base}-"
    count = await Transaction.find({"transaction_number": {"$regex": f"^{prefix}"}}).count()
    return f"{prefix}{str(count + 1).zfill(4)}"


from app.schemas.discount import EvaluateCartItem
from app.services.discounts import evaluate_discounts


async def prepare_sale_body(body: TransactionCreate) -> TransactionCreate:
    """Apply promotion rules server-side, normalize prices/factors, validate loyalty."""
    product_map = await _load_products_map([i.product_id for i in body.items])

    priced_items: list[TransactionItem] = []
    for item in body.items:
        product = product_map.get(item.product_id)
        if not product:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
        if not product_is_billable(product):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=billable_rejection_detail(product),
            )
        price, factor, sell_uom = _resolve_server_line_pricing(
            product, getattr(item, "sell_uom", "") or "",
        )
        priced_items.append(
            item.model_copy(
                update={
                    "price": price,
                    "unit_factor": factor,
                    "sell_uom": sell_uom,
                    "name": product.name,
                    "sku": product.sku,
                }
            )
        )

    evaluate_items: list[EvaluateCartItem] = []
    for item in priced_items:
        product = product_map[item.product_id]
        evaluate_items.append(
            EvaluateCartItem(
                product_id=item.product_id,
                price=item.price,
                quantity=item.quantity,
                category=product.category if product else "",
                sell_uom=getattr(item, "sell_uom", "") or "",
            )
        )

    evaluated = await evaluate_discounts(evaluate_items, coupon_code=body.coupon_code or "")
    items = []
    for i, item in enumerate(priced_items):
        per_unit = (
            evaluated.line_items[i].per_unit_discount
            if i < len(evaluated.line_items)
            else item.discount
        )
        items.append(item.model_copy(update={"discount": per_unit}))

    line_discount_total = sum(i.discount * i.quantity for i in items)
    subtotal = round(sum(i.price * i.quantity for i in items), 2)

    loyalty = max(0, int(body.loyalty_points_redeemed or 0))
    if loyalty > 0:
        if not body.customer_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Loyalty redeem requires a customer",
            )
        customer = await Customer.get(body.customer_id)
        if not customer:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found")
        if loyalty > int(customer.loyalty_points or 0):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient loyalty points. Available: {customer.loyalty_points}",
            )

    manual = max(0.0, body.manual_discount)
    if manual == 0 and body.discount > 0 and not body.applied_promotions:
        manual = max(0.0, body.discount - evaluated.cart_discount - loyalty)

    txn_discount = round(evaluated.cart_discount + manual + loyalty, 2)
    round_off = round(float(getattr(body, "round_off", 0.0) or 0.0), 2)
    tax = round(float(body.tax or 0), 2)
    total = round(subtotal - line_discount_total - txn_discount + tax + round_off, 2)
    if total < 0:
        total = 0.0

    return body.model_copy(
        update={
            "items": items,
            "subtotal": subtotal,
            "promotion_discount": evaluated.promotion_discount_total,
            "manual_discount": manual,
            "loyalty_points_redeemed": loyalty,
            "discount": txn_discount,
            "applied_promotions": evaluated.applied_promotions,
            "round_off": round_off,
            "tax": tax,
            "total": total,
        }
    )


def _to_response(txn: Transaction) -> TransactionResponse:
    return TransactionResponse(
        id=str(txn.id),
        transaction_number=txn.transaction_number,
        customer_id=txn.customer_id,
        customer_name=txn.customer_name,
        items=txn.items,
        subtotal=txn.subtotal,
        discount=txn.discount,
        promotion_discount=getattr(txn, "promotion_discount", 0.0) or 0.0,
        manual_discount=getattr(txn, "manual_discount", 0.0) or 0.0,
        applied_promotions=getattr(txn, "applied_promotions", []) or [],
        coupon_code=getattr(txn, "coupon_code", "") or "",
        tax=txn.tax,
        round_off=float(getattr(txn, "round_off", 0.0) or 0.0),
        loyalty_points_redeemed=txn.loyalty_points_redeemed,
        total=txn.total,
        payment_method=txn.payment_method,
        status=getattr(txn, "status", TransactionStatus.completed),
        void_reason=getattr(txn, "void_reason", "") or "",
        notes=getattr(txn, "notes", "") or "",
        created_by=txn.created_by,
        cashier_id=txn.cashier_id,
        created_at=txn.created_at.isoformat(),
        total_cost=round(getattr(txn, "total_cost", 0.0) or 0.0, 2),
    )


async def record_sale(
    body: TransactionCreate,
    cashier_id: str | None = None,
    *,
    apply_loyalty: bool = True,
    skip_server_pricing: bool = False,
) -> TransactionResponse:
    if not skip_server_pricing:
        body = await prepare_sale_body(body)
    else:
        # Backfill: keep Excel/catalog prices already on the body; zero promos/loyalty.
        subtotal = round(sum(i.price * i.quantity for i in body.items), 2)
        manual = max(0.0, min(float(body.manual_discount or 0), subtotal))
        body = body.model_copy(
            update={
                "subtotal": subtotal,
                "promotion_discount": 0.0,
                "manual_discount": manual,
                "loyalty_points_redeemed": 0,
                "discount": manual,
                "applied_promotions": [],
                "coupon_code": "",
                "tax": 0.0,
                "round_off": 0.0,
                "total": round(max(0.0, subtotal - manual), 2),
            }
        )
    product_map = await _load_products_map([i.product_id for i in body.items])

    for item in body.items:
        product = product_map.get(item.product_id)
        if not product:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
        if not product_is_billable(product):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=billable_rejection_detail(product),
            )
        await check_stock_available(item.product_id, _base_quantity(item))

    txn_number = await _next_txn_number()
    all_deductions: list[BatchDeduction] = []
    adjustment_ids: list[str] = []
    enriched_items: list[TransactionItem] = []
    txn_id: str | None = None

    try:
        for item in body.items:
            product = product_map[item.product_id]
            stock_before = product.stock
            base_qty = _base_quantity(item)

            deductions = await deduct_stock_fefo(item.product_id, base_qty)
            all_deductions.extend(deductions)

            running_stock = stock_before
            for deduction in deductions:
                running_after = running_stock - deduction.quantity
                adj = await record_inventory_change(
                    product=product,
                    quantity=-deduction.quantity,
                    adjustment_type=AdjustmentType.sale,
                    reason=f"Sale {txn_number}",
                    created_by=body.created_by,
                    stock_before=running_stock,
                    stock_after=running_after,
                    batch_id=deduction.batch_id,
                    unit_cost=deduction.unit_cost,
                    unit_selling_price=item.price,
                    line_discount=item.discount,
                    category=product.category,
                )
                adjustment_ids.append(str(adj.id))
                running_stock = running_after

            total_line_cost = sum(d.quantity * d.unit_cost for d in deductions)
            weighted_cost = (
                total_line_cost / base_qty if base_qty else product.cost_price
            )
            allocations = [
                BatchAllocation(
                    batch_id=d.batch_id,
                    quantity=d.quantity,
                    unit_cost=d.unit_cost,
                )
                for d in deductions
            ]
            enriched_items.append(
                item.model_copy(
                    update={
                        "list_price": item.price,
                        "unit_cost": round(weighted_cost, 4),
                        "category": product.category,
                        "batch_allocations": allocations,
                    }
                )
            )

        # unit_cost is per base unit; multiply by base qty (sell qty × factor), not sell qty alone.
        total_cost = round(
            sum(i.unit_cost * _base_quantity(i) for i in enriched_items),
            2,
        )
        txn_payload = body.model_dump(exclude={"sale_date"})
        txn_payload["items"] = enriched_items
        txn_payload["total_cost"] = total_cost

        created_at = resolve_sale_created_at(body.sale_date)

        txn = Transaction(
            transaction_number=txn_number,
            cashier_id=cashier_id,
            created_at=created_at,
            updated_at=created_at,
            **txn_payload,
        )
        await txn.insert()
        txn_id = str(txn.id)

        from app.services.wallet_ledger import post_sale
        await post_sale(txn, created_by=txn.created_by or "")

        for adj_id in adjustment_ids:
            adj = await StockAdjustment.get(adj_id)
            if adj:
                await adj.set({
                    "transaction_id": txn_id,
                    "reference_type": "sale",
                    "reference_id": txn_id,
                })

        if apply_loyalty and body.customer_id:
            customer = await Customer.get(body.customer_id)
            if customer:
                points_earned = int(body.total / 100)
                new_points = customer.loyalty_points + points_earned - body.loyalty_points_redeemed
                new_spent = customer.total_spent + body.total
                new_tier = _compute_tier(new_spent)
                await customer.set({
                    "loyalty_points": max(0, new_points),
                    "total_spent": new_spent,
                    "membership_tier": new_tier,
                })

        from app.services.response_cache import bump_commerce_caches
        await bump_commerce_caches()
        return _to_response(txn)

    except Exception:
        if txn_id:
            from app.services.wallet_ledger import delete_reference
            await delete_reference("transaction", txn_id)
            txn = await Transaction.get(txn_id)
            if txn:
                await txn.delete()
        if adjustment_ids:
            for adj_id in adjustment_ids:
                adj = await StockAdjustment.get(adj_id)
                if adj:
                    await adj.delete()
        if all_deductions:
            await restock_from_deductions(all_deductions)
        raise


async def update_transaction(txn_id: str, body: "TransactionUpdate") -> TransactionResponse:
    """Update sale metadata (customer, payment, discount). Line items are not changed."""
    from app.schemas.transaction import TransactionUpdate as TxnUpdate
    from app.services.wallet_ledger import delete_reference, post_sale

    txn = await Transaction.get(txn_id)
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    updates: dict = {}
    data = body.model_dump(exclude_unset=True) if isinstance(body, TxnUpdate) else body
    prev_method = (
        txn.payment_method.value
        if hasattr(txn.payment_method, "value")
        else str(txn.payment_method)
    )
    prev_total = float(txn.total or 0)

    if "customer_id" in data:
        cid = data["customer_id"]
        if cid:
            customer = await Customer.get(cid)
            if not customer:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found")
            updates["customer_id"] = cid
            updates["customer_name"] = data.get("customer_name") or customer.name
        else:
            updates["customer_id"] = None
            updates["customer_name"] = data.get("customer_name") or "Walk-In Customer"

    if "customer_name" in data and "customer_id" not in data:
        updates["customer_name"] = data["customer_name"]

    if "payment_method" in data and data["payment_method"] is not None:
        updates["payment_method"] = data["payment_method"]

    if "loyalty_points_redeemed" in data and data["loyalty_points_redeemed"] is not None:
        new_loyalty = max(0, int(data["loyalty_points_redeemed"]))
        cid = updates.get("customer_id", txn.customer_id)
        if new_loyalty > 0:
            if not cid:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail="Loyalty redeem requires a customer",
                )
            customer = await Customer.get(cid)
            if not customer:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found")
            # Allow keeping existing redeem; block increasing beyond available.
            available = int(customer.loyalty_points or 0) + int(txn.loyalty_points_redeemed or 0)
            if new_loyalty > available:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail=f"Insufficient loyalty points. Available: {available}",
                )
        updates["loyalty_points_redeemed"] = new_loyalty

    if "discount" in data and data["discount"] is not None:
        discount = float(data["discount"])
        line_discount = sum(i.discount * i.quantity for i in txn.items)
        max_discount = txn.subtotal - line_discount
        if discount > max_discount:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Discount cannot exceed subtotal",
            )
        updates["discount"] = discount
        updates["total"] = round(txn.subtotal - line_discount - discount + txn.tax, 2)

    if not updates:
        return _to_response(txn)

    await txn.set(updates)
    refreshed = await Transaction.get(txn_id)
    if not refreshed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    new_method = (
        refreshed.payment_method.value
        if hasattr(refreshed.payment_method, "value")
        else str(refreshed.payment_method)
    )
    new_total = float(refreshed.total or 0)
    if new_method != prev_method or abs(new_total - prev_total) > 0.001:
        # Rewrite ledger so wallet balances match the edited sale.
        await delete_reference("transaction", txn_id)
        await post_sale(refreshed, created_by=refreshed.created_by or "")
        from app.services.response_cache import bump_commerce_caches
        await bump_commerce_caches()

    return _to_response(refreshed)


async def void_sale(txn_id: str, reason: str, voided_by: str) -> TransactionResponse:
    """Void a completed sale; restock from stored batch allocations and reverse loyalty."""
    txn = await Transaction.get(txn_id)
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    if not reason.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Void reason is required")

    now = datetime.now(timezone.utc)
    # Atomic claim: only one concurrent void wins.
    col = Transaction.get_motor_collection()
    claim = await col.update_one(
        {
            "_id": PydanticObjectId(txn_id),
            "status": {"$ne": TransactionStatus.voided.value},
        },
        {
            "$set": {
                "status": TransactionStatus.voided.value,
                "void_reason": reason.strip(),
                "voided_at": now,
                "voided_by": voided_by,
                "updated_at": now,
            },
        },
    )
    if claim.matched_count != 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Transaction already voided")

    deductions: list[BatchDeduction] = []
    for item in txn.items:
        for alloc in item.batch_allocations:
            deductions.append(
                BatchDeduction(
                    product_id=item.product_id,
                    batch_id=alloc.batch_id,
                    quantity=alloc.quantity,
                    unit_cost=alloc.unit_cost,
                ),
            )
    if deductions:
        await restock_from_deductions(deductions)

    if txn.customer_id:
        customer = await Customer.get(txn.customer_id)
        if customer:
            points_earned = int(txn.total / 100)
            new_points = customer.loyalty_points - points_earned + txn.loyalty_points_redeemed
            new_spent = max(0.0, customer.total_spent - txn.total)
            await customer.set({
                "loyalty_points": max(0, new_points),
                "total_spent": new_spent,
                "membership_tier": _compute_tier(new_spent),
            })

    from app.services.wallet_ledger import reverse_reference
    await reverse_reference(
        reference_type="transaction",
        reference_id=txn_id,
        reason=reason.strip(),
        created_by=voided_by,
        date=now.date().isoformat(),
    )

    refreshed = await Transaction.get(txn_id)
    from app.services.response_cache import bump_commerce_caches
    await bump_commerce_caches()
    return _to_response(refreshed)  # type: ignore[arg-type]
