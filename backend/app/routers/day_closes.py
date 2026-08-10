from datetime import datetime, timezone, timedelta
import re

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, Field

from app.auth.dependencies import require_manager_or_above, get_current_user
from app.models.day_close import DayClose, DayCloseStatus
from app.models.user import User
from app.models.audit_log import AuditModule
from app.models.wallet_ledger import WalletLedgerEntry
from app.schemas.reports import DayCloseUpsert, DayCloseBlock
from app.schemas.wallet import WalletLedgerEntryResponse
from app.services.audit import (
    log_audit,
    day_close_snapshot,
    cash_custody_snapshot,
    wallet_transfer_snapshot,
    wallet_adjustment_snapshot,
)
from app.services import wallet_ledger as wl

router = APIRouter(prefix="/day-closes", tags=["Day Closes"])

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class PostVarianceBody(BaseModel):
    wallet: str = Field(description="cash | bank | esewa")


class OpeningSuggestion(BaseModel):
    date: str
    suggested_opening_cash: float
    yesterday_closing_cash: float | None = None
    yesterday_date: str | None = None


def _round_optional(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 2)


def _status_value(doc: DayClose) -> str:
    raw = getattr(doc, "status", None) or DayCloseStatus.open
    return raw.value if hasattr(raw, "value") else str(raw)


def _to_block(doc: DayClose) -> DayCloseBlock:
    closed_at = getattr(doc, "closed_at", None)
    return DayCloseBlock(
        date=doc.date,
        opening_cash=doc.opening_cash,
        closing_cash=doc.closing_cash,
        closing_bank=getattr(doc, "closing_bank", None),
        closing_esewa=getattr(doc, "closing_esewa", None),
        notes=doc.notes or "",
        status=_status_value(doc),
        closed_at=closed_at.isoformat() if closed_at else None,
        closed_by=getattr(doc, "closed_by", "") or "",
        updated_by=doc.updated_by or doc.created_by or "",
        updated_at=doc.updated_at.isoformat(),
    )


def _snapshot(doc: DayClose) -> dict:
    return day_close_snapshot(doc)


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


def _assert_editable(doc: DayClose | None) -> None:
    if doc and _status_value(doc) == DayCloseStatus.closed.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Day is closed. Reopen before editing.",
        )


@router.get("/{day}/opening-suggestion", response_model=OpeningSuggestion)
async def opening_suggestion(day: str, _: User = Depends(get_current_user)):
    if not _ISO_DATE_RE.match(day):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="date must be YYYY-MM-DD")
    y, m, d = [int(x) for x in day.split("-")]
    yesterday = (datetime(y, m, d, tzinfo=timezone.utc) - timedelta(days=1)).date().isoformat()
    prev = await DayClose.find_one(DayClose.date == yesterday)
    suggested = round(float(getattr(prev, "closing_cash", 0) or 0), 2) if prev else 0.0
    yesterday_closing = round(float(getattr(prev, "closing_cash", 0) or 0), 2) if prev else None
    return OpeningSuggestion(
        date=day,
        suggested_opening_cash=suggested,
        yesterday_closing_cash=yesterday_closing,
        yesterday_date=yesterday if prev else None,
    )


@router.put("/{day}", response_model=DayCloseBlock)
async def upsert_day_close(
    day: str,
    body: DayCloseUpsert,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    if not _ISO_DATE_RE.match(day):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="date must be YYYY-MM-DD")
    if body.opening_cash < 0 or body.closing_cash < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cash amounts cannot be negative")
    if body.closing_bank is not None and body.closing_bank < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Bank closing cannot be negative")
    if body.closing_esewa is not None and body.closing_esewa < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="eSewa closing cannot be negative")

    closing_bank = _round_optional(body.closing_bank)
    closing_esewa = _round_optional(body.closing_esewa)

    existing = await DayClose.find_one(DayClose.date == day)
    _assert_editable(existing)
    now = datetime.now(timezone.utc)
    if existing:
        before = _snapshot(existing)
        await existing.set({
            "opening_cash": round(body.opening_cash, 2),
            "closing_cash": round(body.closing_cash, 2),
            "closing_bank": closing_bank,
            "closing_esewa": closing_esewa,
            "notes": (body.notes or "").strip(),
            "updated_by": current_user.name,
            "updated_at": now,
        })
        refreshed = await DayClose.find_one(DayClose.date == day)
        assert refreshed is not None
        await log_audit(
            module=AuditModule.accounts,
            action="day_close_update",
            user=current_user,
            request=request,
            entity_type="day_close",
            entity_id=str(refreshed.id),
            previous=before,
            new=_snapshot(refreshed),
        )
        return _to_block(refreshed)

    doc = DayClose(
        date=day,
        opening_cash=round(body.opening_cash, 2),
        closing_cash=round(body.closing_cash, 2),
        closing_bank=closing_bank,
        closing_esewa=closing_esewa,
        notes=(body.notes or "").strip(),
        status=DayCloseStatus.open,
        created_by=current_user.name,
        updated_by=current_user.name,
        created_at=now,
        updated_at=now,
    )
    await doc.insert()
    await log_audit(
        module=AuditModule.accounts,
        action="day_close_create",
        user=current_user,
        request=request,
        entity_type="day_close",
        entity_id=str(doc.id),
        new=_snapshot(doc),
    )
    return _to_block(doc)


@router.post("/{day}/close", response_model=DayCloseBlock)
async def close_day(
    day: str,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    if not _ISO_DATE_RE.match(day):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="date must be YYYY-MM-DD")
    doc = await DayClose.find_one(DayClose.date == day)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Save day close before closing the day")
    if _status_value(doc) == DayCloseStatus.closed.value:
        return _to_block(doc)
    before = _snapshot(doc)
    now = datetime.now(timezone.utc)
    await doc.set({
        "status": DayCloseStatus.closed,
        "closed_at": now,
        "closed_by": current_user.name,
        "updated_by": current_user.name,
        "updated_at": now,
    })
    refreshed = await DayClose.find_one(DayClose.date == day)
    assert refreshed is not None
    await log_audit(
        module=AuditModule.accounts,
        action="day_close_close",
        user=current_user,
        request=request,
        entity_type="day_close",
        entity_id=str(refreshed.id),
        previous=before,
        new=_snapshot(refreshed),
    )
    return _to_block(refreshed)


@router.post("/{day}/reopen", response_model=DayCloseBlock)
async def reopen_day(
    day: str,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    if not _ISO_DATE_RE.match(day):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="date must be YYYY-MM-DD")
    doc = await DayClose.find_one(DayClose.date == day)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Day close not found")
    before = _snapshot(doc)
    now = datetime.now(timezone.utc)
    await doc.set({
        "status": DayCloseStatus.open,
        "closed_at": None,
        "closed_by": "",
        "updated_by": current_user.name,
        "updated_at": now,
    })
    refreshed = await DayClose.find_one(DayClose.date == day)
    assert refreshed is not None
    await log_audit(
        module=AuditModule.accounts,
        action="day_close_reopen",
        user=current_user,
        request=request,
        entity_type="day_close",
        entity_id=str(refreshed.id),
        previous=before,
        new=_snapshot(refreshed),
    )
    return _to_block(refreshed)


@router.post("/{day}/post-variance", response_model=WalletLedgerEntryResponse, status_code=status.HTTP_201_CREATED)
async def post_variance(
    day: str,
    body: PostVarianceBody,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    if not _ISO_DATE_RE.match(day):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="date must be YYYY-MM-DD")

    await wl.ensure_backfill()
    entry = await wl.post_day_close_variance(
        day=day,
        wallet=body.wallet,
        created_by=current_user.name,
    )
    await log_audit(
        module=AuditModule.accounts,
        action="day_close_post_variance",
        user=current_user,
        request=request,
        entity_type="wallet_adjustment",
        entity_id=str(entry.id),
        new={
            "date": day,
            "wallet": body.wallet,
            "amount": round(float(entry.amount), 2),
            "direction": entry.direction.value if hasattr(entry.direction, "value") else str(entry.direction),
            "remarks": entry.remarks,
            "reference_type": entry.reference_type,
            "reference_id": entry.reference_id,
        },
    )
    return _to_entry(entry)


@router.get("/{day}", response_model=DayCloseBlock)
async def get_day_close(day: str, _: User = Depends(require_manager_or_above)):
    if not _ISO_DATE_RE.match(day):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="date must be YYYY-MM-DD")
    doc = await DayClose.find_one(DayClose.date == day)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Day close not found")
    return _to_block(doc)
