"""Atomic PO receive — MongoDB transaction with bulk writes; fallback rollback for standalone MongoDB."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from beanie import PydanticObjectId
from fastapi import HTTPException, Request, status
from pymongo.errors import OperationFailure

from app.database import get_motor_client
from app.models.audit_log import AuditModule
from app.models.inventory import AdjustmentType, InventoryBatch, StockAdjustment
from app.models.product import Product
from app.models.purchase_order import (
    POStatus,
    PurchaseOrder,
    PurchaseOrderItem,
    compute_po_status,
)
from app.models.supplier import Supplier
from app.models.user import User
from app.schemas.purchase_order import PurchaseOrderReceiveItem
from app.services.audit import log_audit, po_snapshot
from app.services.inventory_sync import log_receive_price_change


@dataclass
class _ReceivePlan:
    line_index: int
    item: PurchaseOrderItem
    receive: PurchaseOrderReceiveItem
    buy_delta: int
    base_delta: int
    batch_number: str = ""
    landed_cost: float = 0.0


@dataclass
class _PriceSnapshot:
    product_id: str
    before_cost: float
    before_sell: float
    product: Product


@dataclass
class _ReceiveWriteContext:
    po_id: Any
    po_id_str: str
    plans: list[_ReceivePlan]
    product_map: dict[str, Product]
    product_field_updates: dict[str, dict]
    batch_docs: list[dict]
    updated_items: list[PurchaseOrderItem]
    created_by: str
    now: datetime
    expected_updated_at: datetime
    po_revert: dict[str, Any] = field(default_factory=dict)
    product_revert: dict[str, dict[str, Any]] = field(default_factory=dict)
    inserted_batch_ids: list[Any] = field(default_factory=list)
    inserted_adj_ids: list[Any] = field(default_factory=list)


def _batch_number_for_line(
    order_number: str,
    line_index: int,
    product_id: str,
    batch_count_by_product: Counter[str],
) -> str:
    batch_count_by_product[product_id] += 1
    seq = batch_count_by_product[product_id]
    line_no = line_index + 1
    base = f"PO-{order_number}-L{line_no:02d}"
    return base if seq == 1 else f"{base}-{seq}"


async def _commit_writes(ctx: _ReceiveWriteContext, *, session: Any | None) -> None:
    product_col = Product.get_motor_collection()
    batch_col = InventoryBatch.get_motor_collection()
    adj_col = StockAdjustment.get_motor_collection()
    po_col = PurchaseOrder.get_motor_collection()
    kwargs = {"session": session} if session is not None else {}

    touched_products = set(ctx.product_field_updates)
    for pid in touched_products:
        update: dict[str, Any] = {"$set": {"updated_at": ctx.now}}
        fields = ctx.product_field_updates.get(pid)
        if fields:
            update["$set"].update(fields)
        await product_col.update_one(
            {"_id": PydanticObjectId(pid)},
            update,
            **kwargs,
        )

    pid_to_initial_stock: dict[str, int] = {}
    for plan in ctx.plans:
        pid = plan.item.product_id
        if pid not in pid_to_initial_stock:
            batches = await InventoryBatch.find(
                InventoryBatch.product_id == pid,
                InventoryBatch.quantity > 0,
            ).to_list()
            pid_to_initial_stock[pid] = sum(b.quantity for b in batches)

    batch_result = await batch_col.insert_many(ctx.batch_docs, **kwargs)
    ctx.inserted_batch_ids = list(batch_result.inserted_ids)

    running_stock = dict(pid_to_initial_stock)
    adj_docs: list[dict] = []
    for plan, batch_id in zip(ctx.plans, ctx.inserted_batch_ids, strict=True):
        pid = plan.item.product_id
        product = ctx.product_map[pid]
        sb = running_stock[pid]
        sa = sb + plan.base_delta
        running_stock[pid] = sa
        cost = plan.landed_cost
        qty_abs = plan.base_delta
        adj_docs.append({
            "product_id": pid,
            "product_name": product.name,
            "product_sku": product.sku,
            "batch_id": str(batch_id),
            "reference_type": "purchase_order",
            "reference_id": ctx.po_id_str,
            "type": AdjustmentType.receive.value,
            "quantity": plan.base_delta,
            "stock_before": sb,
            "stock_after": sa,
            "unit_cost": round(cost, 4),
            "extended_cost": round(qty_abs * cost, 2),
            "unit_selling_price": product.selling_price,
            "extended_revenue": round(qty_abs * product.selling_price, 2),
            "line_discount": 0.0,
            "category": product.category,
            "reason": f"PO receive — batch {plan.batch_number}",
            "created_by": ctx.created_by,
            "created_at": ctx.now,
        })

    adj_result = await adj_col.insert_many(adj_docs, **kwargs)
    ctx.inserted_adj_ids = list(adj_result.inserted_ids)

    new_status = compute_po_status(ctx.updated_items)
    result = await po_col.update_one(
        {"_id": ctx.po_id, "updated_at": ctx.expected_updated_at},
        {
            "$set": {
                "items": [i.model_dump() for i in ctx.updated_items],
                "status": new_status.value,
                "received_by": ctx.created_by,
                "received_date": date.today().isoformat(),
                "updated_at": ctx.now,
            },
        },
        **kwargs,
    )
    if result.matched_count != 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Purchase order was updated by another receive. Refresh and try again.",
        )


async def _rollback_writes(ctx: _ReceiveWriteContext) -> None:
    """Compensating rollback when transactions are unavailable."""
    batch_col = InventoryBatch.get_motor_collection()
    adj_col = StockAdjustment.get_motor_collection()
    product_col = Product.get_motor_collection()
    po_col = PurchaseOrder.get_motor_collection()

    if ctx.inserted_adj_ids:
        await adj_col.delete_many({"_id": {"$in": ctx.inserted_adj_ids}})
    if ctx.inserted_batch_ids:
        await batch_col.delete_many({"_id": {"$in": ctx.inserted_batch_ids}})

    for pid, revert in ctx.product_revert.items():
        await product_col.update_one(
            {"_id": PydanticObjectId(pid)},
            {"$set": revert},
        )

    if ctx.po_revert:
        await po_col.update_one({"_id": ctx.po_id}, {"$set": ctx.po_revert})


async def receive_purchase_order_items(
    po_id: str,
    receive_items: list[PurchaseOrderReceiveItem],
    *,
    created_by: str,
    current_user: User,
    request: Request,
) -> PurchaseOrder:
    """
    Receive PO lines atomically (MongoDB transaction on replica set / Atlas).

    Uses bulk insert_many, $inc stock updates, and PO-scoped batch numbers.
    Falls back to compensating rollback on standalone MongoDB (local dev).
    """
    po = await PurchaseOrder.get(po_id)
    if not po:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Purchase order not found")

    if po.status not in (POStatus.ordered, POStatus.partial):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Only ordered or partially received purchase orders can be processed",
        )

    if not receive_items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No items to receive")

    before_po = po_snapshot(po)
    updated_items: list[PurchaseOrderItem] = list(po.items)
    plans: list[_ReceivePlan] = []

    for receive in receive_items:
        idx = next(
            (i for i, it in enumerate(updated_items) if it.product_id == receive.product_id),
            None,
        )
        if idx is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Product {receive.product_id} is not on this purchase order",
            )

        item = updated_items[idx]
        buy_delta = receive.receive_quantity
        if buy_delta <= 0:
            continue

        remaining_ordered = item.quantity - item.received_quantity
        if buy_delta > remaining_ordered:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Cannot receive {buy_delta} of {item.product_name}; "
                    f"only {remaining_ordered} remaining on order"
                ),
            )

        units = receive.units_per_buy_uom or getattr(item, "units_per_buy_uom", None) or 1
        base_delta = buy_delta * units

        item_updates: dict = {"received_quantity": item.received_quantity + buy_delta}
        if receive.units_per_buy_uom and receive.units_per_buy_uom != getattr(
            item, "units_per_buy_uom", 1
        ):
            item_updates["units_per_buy_uom"] = units

        plans.append(
            _ReceivePlan(
                line_index=idx,
                item=item,
                receive=receive,
                buy_delta=buy_delta,
                base_delta=base_delta,
            ),
        )
        updated_items[idx] = item.model_copy(update=item_updates)

    if not plans:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No stock was received")

    product_ids = list(dict.fromkeys(p.item.product_id for p in plans))
    products = await Product.find(
        {"_id": {"$in": [PydanticObjectId(pid) for pid in product_ids]}},
    ).to_list()
    product_map = {str(p.id): p for p in products}

    for plan in plans:
        if plan.item.product_id not in product_map:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail=f"Product {plan.item.product_name} not found",
            )

    supplier: Supplier | None = None
    if po.supplier_id:
        try:
            supplier = await Supplier.get(PydanticObjectId(po.supplier_id))
        except Exception:
            supplier = None
        if supplier and not supplier.is_active:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Supplier not found")

    existing_batches = await InventoryBatch.find(
        InventoryBatch.purchase_order_id == str(po.id),
    ).to_list()
    batch_count_by_product: Counter[str] = Counter(b.product_id for b in existing_batches)

    now = datetime.now(timezone.utc)
    po_id_str = str(po.id)
    price_snapshots: list[_PriceSnapshot] = []
    product_revert_snapshot: dict[str, dict] = {
        pid: {
            "cost_price": product_map[pid].cost_price,
            "selling_price": product_map[pid].selling_price,
            "supplier_id": product_map[pid].supplier_id,
            "supplier_name": product_map[pid].supplier_name,
            "updated_at": product_map[pid].updated_at,
        }
        for pid in product_ids
    }
    product_field_updates: dict[str, dict] = {}
    batch_docs: list[dict] = []

    for plan in plans:
        pid = plan.item.product_id
        product = product_map[pid]
        before_cost = product.cost_price
        before_sell = product.selling_price

        units = getattr(plan.item, "units_per_buy_uom", None) or 1
        cost_per_buy = plan.item.unit_cost if plan.item.unit_cost > 0 else product.cost_price * units
        plan.landed_cost = round(cost_per_buy / units, 4) if units else cost_per_buy

        pu = product_field_updates.setdefault(pid, {})
        if plan.landed_cost > 0 and plan.landed_cost != product.cost_price:
            product.cost_price = plan.landed_cost
            pu["cost_price"] = plan.landed_cost
        plan.batch_number = _batch_number_for_line(
            po.order_number,
            plan.line_index,
            pid,
            batch_count_by_product,
        )

        if supplier:
            product.supplier_id = str(supplier.id)
            product.supplier_name = supplier.name
            pu["supplier_id"] = str(supplier.id)
            pu["supplier_name"] = supplier.name

        if before_cost != product.cost_price or before_sell != product.selling_price:
            price_snapshots.append(
                _PriceSnapshot(
                    product_id=pid,
                    before_cost=before_cost,
                    before_sell=before_sell,
                    product=product,
                ),
            )

        batch_docs.append({
            "product_id": pid,
            "batch_number": plan.batch_number,
            "quantity": plan.base_delta,
            "unit_cost": plan.landed_cost,
            "expiry_date": plan.receive.expiry_date or None,
            "purchase_order_id": po_id_str,
            "received_at": now,
        })

    ctx = _ReceiveWriteContext(
        po_id=po.id,
        po_id_str=po_id_str,
        plans=plans,
        product_map=product_map,
        product_field_updates=product_field_updates,
        batch_docs=batch_docs,
        updated_items=updated_items,
        created_by=created_by,
        now=now,
        expected_updated_at=po.updated_at,
        po_revert={
            "items": [i.model_dump() for i in po.items],
            "status": po.status.value,
            "received_by": po.received_by,
            "received_date": po.received_date,
            "updated_at": po.updated_at,
        },
        product_revert=product_revert_snapshot,
    )

    client = get_motor_client()

    try:
        async with await client.start_session() as session:
            async with session.start_transaction():
                await _commit_writes(ctx, session=session)
    except HTTPException:
        # Transaction aborted — do not compensating-rollback (would race with other receives).
        raise
    except OperationFailure as exc:
        if exc.code != 20:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Receive failed and was rolled back.",
            ) from exc
        try:
            await _commit_writes(ctx, session=None)
        except HTTPException:
            await _rollback_writes(ctx)
            raise
        except Exception as inner:
            await _rollback_writes(ctx)
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Receive failed and was rolled back.",
            ) from inner
    except Exception as exc:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Receive failed and was rolled back.",
        ) from exc

    refreshed = await PurchaseOrder.get(po_id)
    if not refreshed:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Receive commit failed")

    for snap in price_snapshots:
        await log_receive_price_change(
            product_id=snap.product_id,
            before_cost=snap.before_cost,
            before_sell=snap.before_sell,
            product=snap.product,
            current_user=current_user,
            request=request,
            module=AuditModule.purchase_orders,
        )

    await log_audit(
        module=AuditModule.purchase_orders,
        action="receive",
        user=current_user,
        request=request,
        entity_type="purchase_order",
        entity_id=po_id,
        previous=before_po,
        new=po_snapshot(refreshed),
    )

    return refreshed
