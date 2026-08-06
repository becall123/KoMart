from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from math import ceil
from datetime import datetime, timezone
from typing import Optional

from app.auth.dependencies import get_current_user, require_manager_or_above, require_admin_only
from app.models.user import User, UserRole
from app.models.transaction import Transaction, PaymentMethod
from app.schemas.transaction import (
    TransactionCreate,
    TransactionResponse,
    TransactionUpdate,
    TransactionVoidRequest,
    BackfillSalesRequest,
    BackfillSalesResponse,
    BackfillValidateRequest,
    BackfillValidateResponse,
    BackfillVarianceRequest,
    BackfillVarianceResponse,
)
from app.schemas.common import PaginatedResponse
from app.models.audit_log import AuditModule
from app.services.audit import log_audit, sale_snapshot
from app.services.sales import record_sale, update_transaction, void_sale, _to_response
from app.services.sales_backfill import (
    backfill_sales_from_rows,
    post_backfill_variance,
    validate_backfill_sales,
)

router = APIRouter(prefix="/transactions", tags=["Transactions"])


@router.get("", response_model=PaginatedResponse[TransactionResponse])
async def list_transactions(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    search: str = Query(""),
    payment_method: Optional[PaymentMethod] = Query(None),
    start_date: str = Query(""),
    end_date: str = Query(""),
    current_user: User = Depends(get_current_user),
):
    filters: dict = {}

    # Cashiers can only see their own transactions
    if current_user.role == UserRole.cashier:
        filters["cashier_id"] = str(current_user.id)

    if payment_method:
        filters["payment_method"] = payment_method
    if start_date:
        start = datetime.fromisoformat(start_date)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        filters.setdefault("created_at", {})["$gte"] = start
    if end_date:
        end = datetime.fromisoformat(end_date)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        end = end.replace(hour=23, minute=59, second=59)
        filters.setdefault("created_at", {})["$lte"] = end

    query = Transaction.find(filters) if filters else Transaction.find()

    if search:
        query = query.find({"$or": [
            {"transaction_number": {"$regex": search, "$options": "i"}},
            {"customer_name": {"$regex": search, "$options": "i"}},
        ]})

    total = await query.count()
    txns = await query.sort("-created_at").skip((page - 1) * page_size).limit(page_size).to_list()
    return PaginatedResponse(
        data=[_to_response(t) for t in txns],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 1,
    )


@router.post("/backfill/validate", response_model=BackfillValidateResponse)
async def validate_backfill_transactions(
    body: BackfillValidateRequest,
    _: User = Depends(require_admin_only),
):
    return await validate_backfill_sales(body.lines)


@router.post("/backfill/variance", response_model=BackfillVarianceResponse)
async def post_backfill_variance_adjustment(
    body: BackfillVarianceRequest,
    request: Request,
    current_user: User = Depends(require_admin_only),
):
    result = await post_backfill_variance(body, created_by=current_user.name)
    await log_audit(
        module=AuditModule.sales,
        action="backfill_variance",
        user=current_user,
        request=request,
        entity_type="sales_backfill",
        entity_id=result.id,
        new={
            "wallet": result.wallet,
            "amount": result.amount,
            "direction": result.direction,
            "date": result.date,
            "remarks": result.remarks,
            "expected_total": result.expected_total,
            "actual_total": result.actual_total,
            "difference": result.difference,
        },
    )
    return result


@router.post("/backfill", response_model=BackfillSalesResponse)
async def backfill_transactions(
    body: BackfillSalesRequest,
    request: Request,
    current_user: User = Depends(require_admin_only),
):
    result = await backfill_sales_from_rows(
        body.lines,
        created_by=current_user.name,
        cashier_id=str(current_user.id),
    )
    expected = round(float(body.expected_total), 2)
    actual = round(float(body.actual_total), 2)
    difference = round(expected - actual, 2)
    result.expected_total = expected
    result.actual_total = actual
    result.difference = difference

    for created in result.created:
        await log_audit(
            module=AuditModule.sales,
            action="backfill",
            user=current_user,
            request=request,
            entity_type="transaction",
            entity_id=created.id,
            new=sale_snapshot(created),
        )
    await log_audit(
        module=AuditModule.sales,
        action="backfill_reconcile",
        user=current_user,
        request=request,
        entity_type="sales_backfill",
        entity_id="",
        new={
            "expected_total": expected,
            "actual_total": actual,
            "difference": difference,
            "created_count": result.created_count,
            "error_count": result.error_count,
            "created_bill_nos": [c.transaction_number for c in result.created],
        },
    )
    return result


@router.get("/{txn_id}", response_model=TransactionResponse)
async def get_transaction(txn_id: str, current_user: User = Depends(get_current_user)):
    txn = await Transaction.get(txn_id)
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    # Cashiers can only view their own transactions
    if current_user.role == UserRole.cashier and txn.cashier_id != str(current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Access denied")
    return _to_response(txn)


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    body: TransactionCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    result = await record_sale(body, cashier_id=str(current_user.id))
    await log_audit(
        module=AuditModule.sales,
        action="create",
        user=current_user,
        request=request,
        entity_type="transaction",
        entity_id=result.id,
        new=sale_snapshot(result),
    )
    return result


@router.patch("/{txn_id}", response_model=TransactionResponse)
async def patch_transaction(
    txn_id: str,
    body: TransactionUpdate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    txn = await Transaction.get(txn_id)
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    before = sale_snapshot(_to_response(txn))
    result = await update_transaction(txn_id, body)
    await log_audit(
        module=AuditModule.sales,
        action="update",
        user=current_user,
        request=request,
        entity_type="transaction",
        entity_id=txn_id,
        previous=before,
        new=sale_snapshot(result),
    )
    return result


@router.post("/{txn_id}/void", response_model=TransactionResponse)
async def void_transaction(
    txn_id: str,
    body: TransactionVoidRequest,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    txn = await Transaction.get(txn_id)
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    before = sale_snapshot(_to_response(txn))
    result = await void_sale(txn_id, body.reason, current_user.name)
    await log_audit(
        module=AuditModule.sales,
        action="void",
        user=current_user,
        request=request,
        entity_type="transaction",
        entity_id=txn_id,
        previous=before,
        new=sale_snapshot(result),
    )
    return result
