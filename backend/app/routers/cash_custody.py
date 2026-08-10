"""Cash custody APIs — cash held by staff."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user, require_manager_or_above
from app.models.audit_log import AuditModule
from app.models.cash_custody import CashCustody
from app.models.user import User
from app.services import cash_custody as cc
from app.services.audit import log_audit, cash_custody_snapshot

router = APIRouter(prefix="/cash-custodies", tags=["Cash Custody"])


class CashCustodyCreate(BaseModel):
    amount: float = Field(gt=0)
    held_by_user_id: str
    taken_date: str
    remarks: str = Field(min_length=1, max_length=500)


class CashCustodyReturn(BaseModel):
    resolved_date: str
    remarks: str = ""


class CashCustodyDeposit(BaseModel):
    wallet: str  # bank | esewa
    resolved_date: str
    remarks: str = ""


class CashCustodyResponse(BaseModel):
    id: str
    amount: float
    held_by_user_id: str
    held_by_name: str
    status: str
    taken_date: str
    taken_at: str = ""
    resolved_date: str | None = None
    resolved_at: str | None = None
    deposit_wallet: str | None = None
    remarks: str = ""
    taken_ledger_id: str = ""
    resolve_ledger_id: str = ""
    created_by: str = ""


class CustodyHolderSummary(BaseModel):
    user_id: str
    name: str
    amount: float


class CashCustodySummaryResponse(BaseModel):
    total_held: float
    by_holder: list[CustodyHolderSummary]


def _to_response(doc: CashCustody) -> CashCustodyResponse:
    return CashCustodyResponse(
        id=str(doc.id),
        amount=float(doc.amount),
        held_by_user_id=doc.held_by_user_id,
        held_by_name=doc.held_by_name,
        status=doc.status.value if hasattr(doc.status, "value") else str(doc.status),
        taken_date=doc.taken_date,
        taken_at=doc.taken_at.isoformat() if doc.taken_at else "",
        resolved_date=doc.resolved_date,
        resolved_at=doc.resolved_at.isoformat() if doc.resolved_at else None,
        deposit_wallet=doc.deposit_wallet,
        remarks=doc.remarks or "",
        taken_ledger_id=doc.taken_ledger_id or "",
        resolve_ledger_id=doc.resolve_ledger_id or "",
        created_by=doc.created_by or "",
    )


@router.get("/summary", response_model=CashCustodySummaryResponse)
async def get_summary(_: User = Depends(get_current_user)):
    data = await cc.custody_summary()
    return CashCustodySummaryResponse(
        total_held=data["total_held"],
        by_holder=[CustodyHolderSummary(**h) for h in data["by_holder"]],
    )


@router.get("", response_model=list[CashCustodyResponse])
async def list_rows(
    status_filter: str | None = Query(None, alias="status"),
    held_by_user_id: str | None = Query(None),
    _: User = Depends(get_current_user),
):
    rows = await cc.list_custodies(
        status_filter=status_filter,
        held_by_user_id=held_by_user_id,
    )
    return [_to_response(r) for r in rows]


@router.post("", response_model=CashCustodyResponse, status_code=status.HTTP_201_CREATED)
async def create_custody(
    body: CashCustodyCreate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    doc = await cc.take_custody(
        amount=body.amount,
        held_by_user_id=body.held_by_user_id,
        taken_date=body.taken_date,
        remarks=body.remarks,
        created_by=current_user.name,
    )
    await log_audit(
        module=AuditModule.accounts,
        action="cash_custody_take",
        user=current_user,
        request=request,
        entity_type="cash_custody",
        entity_id=str(doc.id),
        new=cash_custody_snapshot(doc),
    )
    return _to_response(doc)


@router.post("/{custody_id}/return", response_model=CashCustodyResponse)
async def return_to_till(
    custody_id: str,
    body: CashCustodyReturn,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    existing = await CashCustody.get(custody_id)
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Custody record not found")
    before = cash_custody_snapshot(existing)
    doc = await cc.return_custody(
        custody_id,
        resolved_date=body.resolved_date,
        remarks=body.remarks,
        updated_by=current_user.name,
    )
    await log_audit(
        module=AuditModule.accounts,
        action="cash_custody_return",
        user=current_user,
        request=request,
        entity_type="cash_custody",
        entity_id=str(doc.id),
        previous=before,
        new=cash_custody_snapshot(doc),
    )
    return _to_response(doc)


@router.post("/{custody_id}/deposit", response_model=CashCustodyResponse)
async def deposit_from_custody(
    custody_id: str,
    body: CashCustodyDeposit,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    existing = await CashCustody.get(custody_id)
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Custody record not found")
    before = cash_custody_snapshot(existing)
    doc = await cc.deposit_custody(
        custody_id,
        wallet=body.wallet,
        resolved_date=body.resolved_date,
        remarks=body.remarks,
        updated_by=current_user.name,
    )
    await log_audit(
        module=AuditModule.accounts,
        action="cash_custody_deposit",
        user=current_user,
        request=request,
        entity_type="cash_custody",
        entity_id=str(doc.id),
        previous=before,
        new=cash_custody_snapshot(doc),
    )
    return _to_response(doc)
