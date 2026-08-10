"""Wallet / accounts API — balances, ledger, transfers, adjustments."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.auth.dependencies import get_current_user, require_manager_or_above
from app.models.user import User
from app.models.audit_log import AuditModule
from app.schemas.wallet import (
    WalletAdjustmentCreate,
    WalletBalancesResponse,
    WalletLedgerEntryResponse,
    WalletTransferCreate,
)
from app.services import wallet_ledger as wl
from app.services.audit import log_audit, wallet_transfer_snapshot, wallet_adjustment_snapshot
from app.models.wallet_ledger import WalletLedgerEntry

router = APIRouter(prefix="/wallets", tags=["Wallets"])


def _to_entry(e: WalletLedgerEntry) -> WalletLedgerEntryResponse:
    return WalletLedgerEntryResponse(
        id=str(e.id),
        date=e.date,
        wallet=e.wallet.value if hasattr(e.wallet, "value") else str(e.wallet),
        direction=e.direction.value if hasattr(e.direction, "value") else str(e.direction),
        amount=float(e.amount),
        entry_type=e.entry_type.value if hasattr(e.entry_type, "value") else str(e.entry_type),
        remarks=e.remarks or "",
        reference_type=e.reference_type or "",
        reference_id=e.reference_id or "",
        transfer_id=e.transfer_id or "",
        created_by=e.created_by or "",
        created_at=e.created_at.isoformat() if e.created_at else "",
    )


@router.get("/balances", response_model=WalletBalancesResponse)
async def get_balances(_: User = Depends(get_current_user)):
    await wl.ensure_backfill()
    data = await wl.all_balances()
    return WalletBalancesResponse(**data)


@router.get("/ledger", response_model=list[WalletLedgerEntryResponse])
async def get_ledger(
    wallet: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    entry_type: str | None = Query(None),
    limit: int = Query(200, ge=1, le=500),
    _: User = Depends(get_current_user),
):
    await wl.ensure_backfill()
    entries = await wl.list_ledger(
        wallet=wallet,
        date_from=date_from,
        date_to=date_to,
        entry_type=entry_type,
        limit=limit,
    )
    return [_to_entry(e) for e in entries]


@router.post("/transfers", response_model=list[WalletLedgerEntryResponse], status_code=status.HTTP_201_CREATED)
async def transfer_funds(
    body: WalletTransferCreate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    await wl.ensure_backfill()
    out_e, in_e = await wl.create_transfer(
        from_wallet=body.from_wallet,
        to_wallet=body.to_wallet,
        amount=body.amount,
        date=body.date,
        remarks=body.remarks,
        created_by=current_user.name,
    )
    await log_audit(
        module=AuditModule.accounts,
        action="wallet_transfer",
        user=current_user,
        request=request,
        entity_type="wallet_transfer",
        entity_id=out_e.transfer_id or str(out_e.id),
        new=wallet_transfer_snapshot(
            from_wallet=body.from_wallet,
            to_wallet=body.to_wallet,
            amount=body.amount,
            date=body.date,
            remarks=body.remarks,
        ),
    )
    return [_to_entry(out_e), _to_entry(in_e)]


@router.post("/adjustments", response_model=WalletLedgerEntryResponse, status_code=status.HTTP_201_CREATED)
async def adjust_wallet(
    body: WalletAdjustmentCreate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    await wl.ensure_backfill()
    entry = await wl.create_adjustment(
        wallet=body.wallet,
        amount=body.amount,
        direction=body.direction,
        date=body.date,
        remarks=body.remarks,
        created_by=current_user.name,
    )
    await log_audit(
        module=AuditModule.accounts,
        action="wallet_adjustment",
        user=current_user,
        request=request,
        entity_type="wallet_adjustment",
        entity_id=str(entry.id),
        new=wallet_adjustment_snapshot(
            wallet=body.wallet,
            amount=body.amount,
            direction=body.direction,
            date=body.date,
            remarks=body.remarks,
        ),
    )
    return _to_entry(entry)


@router.post("/backfill", status_code=status.HTTP_200_OK)
async def run_backfill(current_user: User = Depends(require_manager_or_above)):
    result = await wl.ensure_backfill(created_by=current_user.name)
    return result
