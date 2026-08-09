from fastapi import APIRouter, HTTPException, status, Depends, Query, Request
from math import ceil
from datetime import datetime, timezone

from app.auth.dependencies import get_current_user, require_manager_or_above
from app.models.user import User
from app.services.po_receive import receive_purchase_order_items
from app.services.po_payment import record_payment
from app.models.purchase_order import (
    PurchaseOrder,
    POStatus,
    PaymentStatus,
    compute_payment_status,
)
from app.schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderUpdate,
    PurchaseOrderStatusUpdate,
    PurchaseOrderReceiveRequest,
    PurchaseOrderPaymentCreate,
    PurchaseOrderResponse,
    PurchaseOrderListResponse,
    item_to_response,
    payment_to_response,
)
from app.schemas.common import PaginatedResponse
from app.models.audit_log import AuditModule
from app.services.audit import log_audit, po_snapshot
from app.services.store_settings import get_store_settings

router = APIRouter(prefix="/purchase-orders", tags=["Purchase Orders"])


def _resolve_ordered_by(body_ordered_by: str | None, current_user: User, placing_order: bool) -> str | None:
    if body_ordered_by and body_ordered_by.strip():
        return body_ordered_by.strip()
    if placing_order:
        return current_user.name
    return None


def _po_is_editable(po: PurchaseOrder) -> bool:
    if po.status in (POStatus.received, POStatus.cancelled):
        return False
    if po.status == POStatus.partial:
        return True
    if po.status == POStatus.ordered:
        return all(item.received_quantity == 0 for item in po.items)
    return po.status == POStatus.draft


def _allowed_update_status(po: PurchaseOrder, target: POStatus) -> bool:
    if target in (POStatus.received, POStatus.cancelled, POStatus.partial) and target != po.status:
        if target == POStatus.partial:
            return po.status == POStatus.partial
        return False
    if po.status in (POStatus.ordered, POStatus.partial) and target == POStatus.draft:
        return False
    return target in (POStatus.draft, POStatus.ordered, POStatus.partial)


def _merge_items(existing: PurchaseOrder, incoming: list) -> list:
    received_by_product = {item.product_id: item.received_quantity for item in existing.items}
    merged = []
    for item in incoming:
        data = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        received = received_by_product.get(data["product_id"], 0)
        if data["quantity"] < received:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Quantity for {data['product_name']} cannot be less than received quantity ({received})",
            )
        data["received_quantity"] = received
        merged.append(data)
    return merged


def _to_response(po: PurchaseOrder) -> PurchaseOrderResponse:
    amount_paid = float(getattr(po, "amount_paid", 0) or 0)
    total_amount = float(getattr(po, "total_amount", 0) or 0)
    raw_status = getattr(po, "payment_status", None)
    if isinstance(raw_status, PaymentStatus):
        payment_status = raw_status
    elif raw_status:
        try:
            payment_status = PaymentStatus(str(raw_status).strip().lower())
        except ValueError:
            payment_status = compute_payment_status(amount_paid, total_amount)
    else:
        payment_status = compute_payment_status(amount_paid, total_amount)

    payments = getattr(po, "payments", None) or []
    created_at = getattr(po, "created_at", None)
    updated_at = getattr(po, "updated_at", None)
    created_at_str = (
        created_at.isoformat()
        if hasattr(created_at, "isoformat")
        else (str(created_at) if created_at else "")
    )
    updated_at_str = (
        updated_at.isoformat()
        if hasattr(updated_at, "isoformat")
        else (str(updated_at) if updated_at else "")
    )

    return PurchaseOrderResponse(
        id=str(po.id),
        order_number=po.order_number,
        supplier_id=po.supplier_id,
        supplier_name=po.supplier_name,
        status=po.status,
        items=[item_to_response(i) for i in po.items],
        total_amount=total_amount,
        amount_paid=amount_paid,
        payment_status=payment_status,
        payments=[payment_to_response(p) for p in payments],
        expected_delivery=po.expected_delivery,
        ordered_by=po.ordered_by,
        received_by=po.received_by,
        received_date=po.received_date,
        created_at=created_at_str,
        updated_at=updated_at_str,
    )


async def _next_po_number() -> str:
    settings = await get_store_settings()
    prefix_base = (settings.purchase_order_prefix or "PO").strip().upper()
    prefix = f"{prefix_base}-"
    count = await PurchaseOrder.find({"order_number": {"$regex": f"^{prefix}"}}).count()
    return f"{prefix}{str(count + 1).zfill(4)}"


@router.get("", response_model=PurchaseOrderListResponse)
async def list_purchase_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    search: str = Query(""),
    supplier_id: str = Query(""),
    _: User = Depends(get_current_user),
):
    query = PurchaseOrder.find()
    if supplier_id:
        query = query.find(PurchaseOrder.supplier_id == supplier_id)
    if search:
        query = query.find({"$or": [
            {"order_number": {"$regex": search, "$options": "i"}},
            {"supplier_name": {"$regex": search, "$options": "i"}},
        ]})

    total = await query.count()

    # Aggregate summary totals without loading every document into Python first.
    match: dict = {}
    if supplier_id:
        match["supplier_id"] = supplier_id
    if search:
        match["$or"] = [
            {"order_number": {"$regex": search, "$options": "i"}},
            {"supplier_name": {"$regex": search, "$options": "i"}},
        ]
    col = PurchaseOrder.get_motor_collection()
    summary_rows = await col.aggregate([
        {"$match": match} if match else {"$match": {}},
        {
            "$group": {
                "_id": None,
                "received_total_amount": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", POStatus.received.value]},
                            "$total_amount",
                            0,
                        ]
                    }
                },
                "outstanding_amount": {
                    "$sum": {
                        "$cond": [
                            {"$ne": ["$status", POStatus.cancelled.value]},
                            {
                                "$max": [
                                    0,
                                    {
                                        "$subtract": [
                                            "$total_amount",
                                            {"$ifNull": ["$amount_paid", 0]},
                                        ]
                                    },
                                ]
                            },
                            0,
                        ]
                    }
                },
            }
        },
    ]).to_list(1)
    received_total_amount = round(float(summary_rows[0]["received_total_amount"]), 2) if summary_rows else 0.0
    outstanding_amount = round(float(summary_rows[0]["outstanding_amount"]), 2) if summary_rows else 0.0

    page_orders = (
        await query.sort("-created_at")
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )
    return PurchaseOrderListResponse(
        data=[_to_response(po) for po in page_orders],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 1,
        received_total_amount=received_total_amount,
        outstanding_amount=outstanding_amount,
    )


@router.post("", response_model=PurchaseOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_purchase_order(
    body: PurchaseOrderCreate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    po_data = body.model_dump()
    placing_order = body.status == POStatus.ordered
    ordered_by = _resolve_ordered_by(body.ordered_by, current_user, placing_order)
    if ordered_by:
        po_data["ordered_by"] = ordered_by
    elif not placing_order:
        po_data.pop("ordered_by", None)
    po = PurchaseOrder(
        order_number=await _next_po_number(),
        **po_data,
    )
    await po.insert()
    await log_audit(
        module=AuditModule.purchase_orders,
        action="create",
        user=current_user,
        request=request,
        entity_type="purchase_order",
        entity_id=str(po.id),
        new=po_snapshot(po),
    )
    return _to_response(po)


@router.get("/{po_id}", response_model=PurchaseOrderResponse)
async def get_purchase_order(po_id: str, _: User = Depends(get_current_user)):
    po = await PurchaseOrder.get(po_id)
    if not po:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Purchase order not found")
    return _to_response(po)


@router.patch("/{po_id}", response_model=PurchaseOrderResponse)
async def update_purchase_order(
    po_id: str,
    body: PurchaseOrderUpdate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    po = await PurchaseOrder.get(po_id)
    if not po:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Purchase order not found")
    if not _po_is_editable(po):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Only draft, ordered, or partial purchase orders can be edited",
        )
    if not _allowed_update_status(po, body.status):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Invalid status for this purchase order update",
        )

    before = po_snapshot(po)
    try:
        merged_items = _merge_items(po, body.items)
    except HTTPException:
        raise

    amount_paid = float(getattr(po, "amount_paid", 0) or 0)
    if body.total_amount + 0.001 < amount_paid:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Total amount cannot be less than amount already paid ({amount_paid:.2f})",
        )

    updates: dict = {
        **body.model_dump(),
        "items": merged_items,
        "payment_status": compute_payment_status(amount_paid, body.total_amount),
        "updated_at": datetime.now(timezone.utc),
    }
    placing_order = body.status == POStatus.ordered
    if body.ordered_by and body.ordered_by.strip():
        updates["ordered_by"] = body.ordered_by.strip()
    elif placing_order:
        resolved = _resolve_ordered_by(None, current_user, True)
        if resolved:
            updates["ordered_by"] = resolved

    await po.set(updates)
    refreshed = await PurchaseOrder.get(po_id)
    await log_audit(
        module=AuditModule.purchase_orders,
        action="update",
        user=current_user,
        request=request,
        entity_type="purchase_order",
        entity_id=po_id,
        previous=before,
        new=po_snapshot(refreshed),  # type: ignore[arg-type]
    )
    return _to_response(refreshed)  # type: ignore[arg-type]


@router.patch("/{po_id}/status", response_model=PurchaseOrderResponse)
async def update_status(
    po_id: str,
    body: PurchaseOrderStatusUpdate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    if body.status in (POStatus.partial, POStatus.received):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Use the receive endpoint to process received items",
        )

    po = await PurchaseOrder.get(po_id)
    if not po:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Purchase order not found")

    before = po_snapshot(po)
    updates: dict = {"status": body.status, "updated_at": datetime.now(timezone.utc)}
    if body.status == POStatus.ordered and not po.ordered_by:
        updates["ordered_by"] = current_user.name

    await po.set(updates)
    refreshed = await PurchaseOrder.get(po_id)
    await log_audit(
        module=AuditModule.purchase_orders,
        action="status_change",
        user=current_user,
        request=request,
        entity_type="purchase_order",
        entity_id=po_id,
        previous=before,
        new=po_snapshot(refreshed),  # type: ignore[arg-type]
    )
    return _to_response(refreshed)  # type: ignore[arg-type]


@router.post("/{po_id}/payments", response_model=PurchaseOrderResponse)
async def create_payment(
    po_id: str,
    body: PurchaseOrderPaymentCreate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    refreshed = await record_payment(
        po_id,
        body,
        current_user=current_user,
        request=request,
    )
    return _to_response(refreshed)


@router.post("/{po_id}/receive", response_model=PurchaseOrderResponse)
async def receive_items(
    po_id: str,
    body: PurchaseOrderReceiveRequest,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    refreshed = await receive_purchase_order_items(
        po_id,
        body.items,
        created_by=current_user.name,
        current_user=current_user,
        request=request,
    )
    return _to_response(refreshed)
