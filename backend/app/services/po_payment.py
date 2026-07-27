"""Purchase order payment recording — creates linked expenses."""

from __future__ import annotations

from datetime import datetime, timezone

from beanie import PydanticObjectId
from fastapi import HTTPException, Request, status
from pymongo import ReturnDocument

from app.models.audit_log import AuditModule
from app.models.expense import Expense, ExpenseCategory
from app.models.purchase_order import (
    POStatus,
    PurchaseOrder,
    PurchaseOrderPayment,
    compute_payment_status,
)
from app.models.user import User
from app.schemas.purchase_order import PurchaseOrderPaymentCreate
from app.services.audit import log_audit, po_snapshot

PAYABLE_STATUSES = {POStatus.ordered, POStatus.partial, POStatus.received}


def remaining_balance(po: PurchaseOrder) -> float:
    return round(max(0.0, po.total_amount - float(getattr(po, "amount_paid", 0) or 0)), 2)


async def record_payment(
    po_id: str,
    body: PurchaseOrderPaymentCreate,
    *,
    current_user: User,
    request: Request | None = None,
) -> PurchaseOrder:
    po = await PurchaseOrder.get(po_id)
    if not po:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Purchase order not found")
    if po.status not in PAYABLE_STATUSES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Payments can only be recorded for ordered, partial, or received purchase orders",
        )

    amount = round(float(body.amount), 2)
    if amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Payment amount must be greater than zero")

    remaining = remaining_balance(po)
    if amount > remaining + 0.001:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Payment exceeds remaining balance ({remaining:.2f})",
        )

    before = po_snapshot(po)
    expense = Expense(
        title=f"PO payment {po.order_number}",
        description=body.notes.strip() or f"Payment for purchase order {po.order_number}",
        amount=amount,
        category=ExpenseCategory.purchase_order.value,
        date=body.date,
        paid_to=po.supplier_name,
        payment_method=body.payment_method.strip() or "cash",
        is_setup_cost=False,
        purchase_order_id=str(po.id),
    )
    await expense.insert()

    from app.services.wallet_ledger import delete_reference, post_expense
    await post_expense(expense, created_by=current_user.name)

    now = datetime.now(timezone.utc)
    payment = PurchaseOrderPayment(
        amount=amount,
        date=body.date,
        payment_method=body.payment_method.strip() or "cash",
        notes=body.notes.strip(),
        expense_id=str(expense.id),
        created_by=current_user.name,
        created_at=now,
    )
    payment_doc = payment.model_dump()
    # Ensure datetime is BSON-friendly
    payment_doc["created_at"] = now

    col = PurchaseOrder.get_motor_collection()
    # Atomic claim: only succeed if amount_paid + amount still ≤ total.
    updated = await col.find_one_and_update(
        {
            "_id": PydanticObjectId(po_id),
            "$expr": {
                "$lte": [
                    {"$add": [{"$ifNull": ["$amount_paid", 0]}, amount]},
                    {"$add": ["$total_amount", 0.001]},
                ]
            },
        },
        {
            "$inc": {"amount_paid": amount},
            "$push": {"payments": payment_doc},
            "$set": {"updated_at": now},
        },
        return_document=ReturnDocument.AFTER,
    )

    if not updated:
        await delete_reference("expense", str(expense.id))
        await expense.delete()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Payment no longer fits remaining balance (concurrent payment). Retry.",
        )

    amount_paid = round(float(updated.get("amount_paid") or 0), 2)
    total_amount = float(updated.get("total_amount") or po.total_amount)
    payment_status = compute_payment_status(amount_paid, total_amount)
    await col.update_one(
        {"_id": PydanticObjectId(po_id)},
        {"$set": {"payment_status": payment_status.value if hasattr(payment_status, "value") else payment_status}},
    )

    refreshed = await PurchaseOrder.get(po_id)
    assert refreshed is not None

    await log_audit(
        module=AuditModule.expenses,
        action="create",
        user=current_user,
        request=request,
        entity_type="expense",
        entity_id=str(expense.id),
        new={
            "id": str(expense.id),
            "title": expense.title,
            "amount": expense.amount,
            "category": str(getattr(expense.category, "value", expense.category)),
            "purchase_order_id": str(po.id),
        },
    )
    await log_audit(
        module=AuditModule.purchase_orders,
        action="payment",
        user=current_user,
        request=request,
        entity_type="purchase_order",
        entity_id=po_id,
        previous=before,
        new=po_snapshot(refreshed),
    )
    return refreshed


async def reverse_payment_for_expense(
    expense: Expense,
    *,
    current_user: User,
    request: Request | None = None,
) -> None:
    """Remove the matching PO payment when a linked expense is deleted."""
    po_id = getattr(expense, "purchase_order_id", None)
    if not po_id:
        return

    po = await PurchaseOrder.get(po_id)
    if not po:
        return

    before = po_snapshot(po)
    expense_id = str(expense.id)
    payments = list(getattr(po, "payments", None) or [])
    matched = [p for p in payments if (p.expense_id or "") == expense_id]
    if not matched:
        return

    removed_amount = round(sum(p.amount for p in matched), 2)
    remaining_payments = [p for p in payments if (p.expense_id or "") != expense_id]
    amount_paid = round(max(0.0, float(getattr(po, "amount_paid", 0) or 0) - removed_amount), 2)
    payment_status = compute_payment_status(amount_paid, po.total_amount)

    await po.set({
        "payments": remaining_payments,
        "amount_paid": amount_paid,
        "payment_status": payment_status,
        "updated_at": datetime.now(timezone.utc),
    })
    refreshed = await PurchaseOrder.get(po_id)
    if refreshed:
        await log_audit(
            module=AuditModule.purchase_orders,
            action="payment_reverse",
            user=current_user,
            request=request,
            entity_type="purchase_order",
            entity_id=po_id,
            previous=before,
            new=po_snapshot(refreshed),
        )
