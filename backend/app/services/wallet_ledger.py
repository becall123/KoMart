"""Wallet ledger posting and balance helpers."""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from app.models.day_close import DayClose
from app.models.expense import Expense
from app.models.settings import StoreSettings
from app.models.transaction import Transaction, TransactionStatus
from app.models.wallet_ledger import (
    Wallet,
    WalletDirection,
    WalletEntryType,
    WalletLedgerEntry,
)
from app.services.payment_methods import normalize_payment_method
from app.services.store_settings import get_store_settings

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WALLETS = (Wallet.cash, Wallet.bank, Wallet.esewa)


def _safe_amount(value: float | int | None) -> float:
    """Coerce ledger/balance amounts; null/NaN → 0."""
    if value is None:
        return 0.0
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    if n != n:  # NaN
        return 0.0
    return round(n, 2)


def _parse_wallet(value: str) -> Wallet:
    normalized = normalize_payment_method(value)
    try:
        return Wallet(normalized)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid wallet; use cash, bank, or esewa",
        ) from exc


def _require_date(day: str) -> str:
    if not _ISO_DATE_RE.match(day or ""):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="date must be YYYY-MM-DD")
    return day


def signed_amount(entry: WalletLedgerEntry) -> float:
    amt = float(entry.amount or 0)
    return amt if entry.direction == WalletDirection.inflow else -amt


async def post_entry(
    *,
    wallet: Wallet | str,
    direction: WalletDirection | str,
    amount: float,
    entry_type: WalletEntryType | str,
    date: str,
    remarks: str = "",
    reference_type: str = "",
    reference_id: str = "",
    transfer_id: str = "",
    created_by: str = "",
) -> WalletLedgerEntry:
    day = _require_date(date)
    w = wallet if isinstance(wallet, Wallet) else _parse_wallet(str(wallet))
    d = direction if isinstance(direction, WalletDirection) else WalletDirection(direction)
    et = entry_type if isinstance(entry_type, WalletEntryType) else WalletEntryType(entry_type)
    amt = round(float(amount), 2)
    if amt <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Amount must be greater than zero")

    entry = WalletLedgerEntry(
        date=day,
        wallet=w,
        direction=d,
        amount=amt,
        entry_type=et,
        remarks=(remarks or "").strip(),
        reference_type=reference_type or "",
        reference_id=reference_id or "",
        transfer_id=transfer_id or "",
        created_by=created_by or "",
    )
    await entry.insert()
    return entry


async def find_by_reference(reference_type: str, reference_id: str) -> list[WalletLedgerEntry]:
    return await WalletLedgerEntry.find({
        "reference_type": reference_type,
        "reference_id": reference_id,
    }).to_list()


async def delete_reference(reference_type: str, reference_id: str) -> int:
    entries = await find_by_reference(reference_type, reference_id)
    for e in entries:
        await e.delete()
    return len(entries)


def _has_active_post(entries: list[WalletLedgerEntry]) -> bool:
    """True if unreverted sale/expense/po_payment lines remain."""
    primary = [
        e for e in entries
        if e.entry_type in (
            WalletEntryType.sale,
            WalletEntryType.expense,
            WalletEntryType.po_payment,
        )
    ]
    reversals = [e for e in entries if e.entry_type == WalletEntryType.void_reversal]
    return len(primary) > len(reversals)


async def reverse_reference(
    *,
    reference_type: str,
    reference_id: str,
    reason: str,
    created_by: str = "",
    date: str | None = None,
) -> list[WalletLedgerEntry]:
    """Post reversing entries for active ledger lines of a reference."""
    existing = await find_by_reference(reference_type, reference_id)
    if not existing or not _has_active_post(existing):
        return []
    day = date or datetime.now(timezone.utc).date().isoformat()
    created: list[WalletLedgerEntry] = []
    primary = [
        e for e in existing
        if e.entry_type in (
            WalletEntryType.sale,
            WalletEntryType.expense,
            WalletEntryType.po_payment,
        )
    ]
    # Reverse each primary that isn't already paired (len primary > reversals means some need reverse)
    already_reversed = len([e for e in existing if e.entry_type == WalletEntryType.void_reversal])
    to_reverse = primary[already_reversed:]
    for e in to_reverse:
        opposite = (
            WalletDirection.outflow
            if e.direction == WalletDirection.inflow
            else WalletDirection.inflow
        )
        created.append(
            await post_entry(
                wallet=e.wallet,
                direction=opposite,
                amount=e.amount,
                entry_type=WalletEntryType.void_reversal,
                date=day,
                remarks=reason or "Reversal",
                reference_type=reference_type,
                reference_id=reference_id,
                created_by=created_by,
            )
        )
    return created


async def post_sale(txn: Transaction, *, created_by: str = "") -> WalletLedgerEntry | None:
    method = normalize_payment_method(
        txn.payment_method.value if hasattr(txn.payment_method, "value") else str(txn.payment_method)
    )
    if method not in {w.value for w in WALLETS}:
        return None
    txn_id = str(txn.id)
    if _has_active_post(await find_by_reference("transaction", txn_id)):
        return None
    day = (txn.created_at.astimezone(timezone.utc) if txn.created_at.tzinfo else txn.created_at.replace(tzinfo=timezone.utc)).date().isoformat()
    return await post_entry(
        wallet=method,
        direction=WalletDirection.inflow,
        amount=float(txn.total or 0),
        entry_type=WalletEntryType.sale,
        date=day,
        remarks=f"Sale {txn.transaction_number}",
        reference_type="transaction",
        reference_id=txn_id,
        created_by=created_by or getattr(txn, "created_by", "") or "",
    )


async def post_expense(expense: Expense, *, created_by: str = "", entry_type: WalletEntryType | None = None) -> WalletLedgerEntry | None:
    method = normalize_payment_method(expense.payment_method)
    if method not in {w.value for w in WALLETS}:
        return None
    exp_id = str(expense.id)
    if _has_active_post(await find_by_reference("expense", exp_id)):
        return None
    et = entry_type or (
        WalletEntryType.po_payment
        if (getattr(expense, "category", None) and str(expense.category) == "purchase_order")
        else WalletEntryType.expense
    )
    return await post_entry(
        wallet=method,
        direction=WalletDirection.outflow,
        amount=float(expense.amount or 0),
        entry_type=et,
        date=expense.date,
        remarks=expense.title or "Expense",
        reference_type="expense",
        reference_id=exp_id,
        created_by=created_by,
    )


async def create_transfer(
    *,
    from_wallet: str,
    to_wallet: str,
    amount: float,
    date: str,
    remarks: str,
    created_by: str = "",
) -> tuple[WalletLedgerEntry, WalletLedgerEntry]:
    src = _parse_wallet(from_wallet)
    dst = _parse_wallet(to_wallet)
    if src == dst:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot transfer to the same wallet")
    remarks = (remarks or "").strip()
    if not remarks:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Remarks are required for transfers")
    transfer_id = str(uuid4())
    out_e = await post_entry(
        wallet=src,
        direction=WalletDirection.outflow,
        amount=amount,
        entry_type=WalletEntryType.transfer,
        date=date,
        remarks=remarks,
        transfer_id=transfer_id,
        created_by=created_by,
    )
    in_e = await post_entry(
        wallet=dst,
        direction=WalletDirection.inflow,
        amount=amount,
        entry_type=WalletEntryType.transfer,
        date=date,
        remarks=remarks,
        transfer_id=transfer_id,
        created_by=created_by,
    )
    return out_e, in_e


async def create_adjustment(
    *,
    wallet: str,
    amount: float,
    direction: str,
    date: str,
    remarks: str,
    created_by: str = "",
    reference_type: str = "",
    reference_id: str = "",
) -> WalletLedgerEntry:
    remarks = (remarks or "").strip()
    if not remarks:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Remarks are required for adjustments")
    d = direction.strip().lower()
    if d not in ("in", "out"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="direction must be 'in' or 'out'")
    return await post_entry(
        wallet=wallet,
        direction=WalletDirection.inflow if d == "in" else WalletDirection.outflow,
        amount=amount,
        entry_type=WalletEntryType.adjustment,
        date=date,
        remarks=remarks,
        reference_type=reference_type,
        reference_id=reference_id,
        created_by=created_by,
    )


DAY_CLOSE_VARIANCE_REF = "day_close_variance"


def day_close_variance_ref_id(day: str, wallet: str) -> str:
    return f"{day}:{wallet}"


async def find_day_close_variance_entry(day: str, wallet: str) -> WalletLedgerEntry | None:
    rows = await find_by_reference(DAY_CLOSE_VARIANCE_REF, day_close_variance_ref_id(day, wallet))
    return rows[0] if rows else None


async def post_day_close_variance(
    *,
    day: str,
    wallet: str,
    created_by: str = "",
) -> WalletLedgerEntry:
    """Post |variance| as an adjustment so Expected aligns with counted/statement Closing."""
    _require_date(day)
    w = _parse_wallet(wallet)
    existing = await find_day_close_variance_entry(day, w.value)
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Variance already posted for this wallet/day. Reverse the adjustment in Accounts to re-post.",
        )

    blocks = await build_day_book(day)
    block = next((b for b in blocks if b["wallet"] == w.value), None)
    if not block:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wallet day book not found")
    if block.get("closing") is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Save closing (counted/statement) before posting variance",
        )
    variance = block.get("variance")
    if variance is None or abs(float(variance)) < 0.01:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No variance to post")

    amount = abs(round(float(variance), 2))
    direction = "in" if float(variance) > 0 else "out"
    return await create_adjustment(
        wallet=w.value,
        amount=amount,
        direction=direction,
        date=day,
        remarks=f"Day close variance {day} ({w.value})",
        created_by=created_by,
        reference_type=DAY_CLOSE_VARIANCE_REF,
        reference_id=day_close_variance_ref_id(day, w.value),
    )


async def ledger_net(
    wallet: Wallet | str,
    *,
    date_gte: str | None = None,
    date_lte: str | None = None,
    date_lt: str | None = None,
    exclude_types: set[WalletEntryType] | None = None,
) -> float:
    w = wallet if isinstance(wallet, Wallet) else _parse_wallet(str(wallet))
    match: dict[str, Any] = {"wallet": w.value}
    if date_gte or date_lte or date_lt:
        match["date"] = {}
        if date_gte:
            match["date"]["$gte"] = date_gte
        if date_lte:
            match["date"]["$lte"] = date_lte
        if date_lt:
            match["date"]["$lt"] = date_lt
    if exclude_types:
        match["entry_type"] = {"$nin": [et.value if hasattr(et, "value") else str(et) for et in exclude_types]}

    col = WalletLedgerEntry.get_motor_collection()
    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": None,
                "net": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$direction", WalletDirection.inflow.value]},
                            "$amount",
                            {"$multiply": ["$amount", -1]},
                        ]
                    }
                },
            }
        },
    ]
    rows = await col.aggregate(pipeline).to_list(1)
    if not rows:
        return 0.0
    return round(float(rows[0].get("net") or 0), 2)


async def day_totals(wallet: Wallet | str, day: str) -> dict[str, float]:
    w = wallet if isinstance(wallet, Wallet) else _parse_wallet(str(wallet))
    col = WalletLedgerEntry.get_motor_collection()
    pipeline = [
        {"$match": {"wallet": w.value, "date": day}},
        {
            "$group": {
                "_id": {"entry_type": "$entry_type", "direction": "$direction"},
                "total": {"$sum": "$amount"},
            }
        },
    ]
    rows = await col.aggregate(pipeline).to_list(None)
    out = {
        "sales_in": 0.0,
        "expenses_out": 0.0,
        "transfers_in": 0.0,
        "transfers_out": 0.0,
        "adjustments_in": 0.0,
        "adjustments_out": 0.0,
        "custody_in": 0.0,
        "custody_out": 0.0,
        "other_in": 0.0,
        "other_out": 0.0,
        "net": 0.0,
    }
    for row in rows:
        key = row.get("_id") or {}
        et = key.get("entry_type") or ""
        direction = key.get("direction") or ""
        amt = float(row.get("total") or 0)
        signed = amt if direction == WalletDirection.inflow.value else -amt
        out["net"] += signed

        if et == WalletEntryType.sale.value and direction == WalletDirection.inflow.value:
            out["sales_in"] += amt
        elif et in (WalletEntryType.expense.value, WalletEntryType.po_payment.value) and direction == WalletDirection.outflow.value:
            out["expenses_out"] += amt
        elif et == WalletEntryType.transfer.value:
            if direction == WalletDirection.inflow.value:
                out["transfers_in"] += amt
            else:
                out["transfers_out"] += amt
        elif et == WalletEntryType.adjustment.value:
            if direction == WalletDirection.inflow.value:
                out["adjustments_in"] += amt
            else:
                out["adjustments_out"] += amt
        elif et == WalletEntryType.custody.value:
            if direction == WalletDirection.inflow.value:
                out["custody_in"] += amt
            else:
                out["custody_out"] += amt
        elif direction == WalletDirection.inflow.value:
            out["other_in"] += amt
        else:
            out["other_out"] += amt

    for k in out:
        out[k] = round(out[k], 2)
    return out


async def opening_baseline(wallet: Wallet, settings: StoreSettings | None = None) -> float:
    settings = settings or await get_store_settings()
    if wallet == Wallet.cash:
        return _safe_amount(getattr(settings, "opening_cash_balance", 0))
    if wallet == Wallet.bank:
        return _safe_amount(getattr(settings, "opening_bank_balance", 0))
    if wallet == Wallet.esewa:
        return _safe_amount(getattr(settings, "opening_esewa_balance", 0))
    return 0.0


async def till_expected_cash(*, today: date | None = None) -> float:
    """Today's till expected = DayClose opening (or 0) + today's cash ledger net."""
    today = today or date.today()
    day_str = today.isoformat()
    day_close = await DayClose.find_one(DayClose.date == day_str)
    opening = _safe_amount(getattr(day_close, "opening_cash", 0)) if day_close else 0.0
    net = await ledger_net(Wallet.cash, date_gte=day_str, date_lte=day_str)
    return round(opening + net, 2)


async def open_custody_total() -> float:
    from app.models.cash_custody import CashCustody, CashCustodyStatus

    rows = await CashCustody.find(CashCustody.status == CashCustodyStatus.held).to_list()
    return round(sum(_safe_amount(r.amount) for r in rows), 2)


async def current_wallet_balance(wallet: Wallet | str, *, today: date | None = None) -> float:
    """
    Cash (Accounts Total Cash): settings opening_cash_balance + all-time cash ledger net
    (+ open custody is added in all_balances, not here for single-wallet callers).
    Bank/eSewa: settings opening + all ledger net.
    """
    today = today or date.today()
    w = wallet if isinstance(wallet, Wallet) else _parse_wallet(str(wallet))
    settings = await get_store_settings()

    if w == Wallet.cash:
        baseline = await opening_baseline(Wallet.cash, settings)
        net = await ledger_net(Wallet.cash)
        return round(baseline + net, 2)

    baseline = await opening_baseline(w, settings)
    net = await ledger_net(w)
    return round(baseline + net, 2)


async def all_balances(*, today: date | None = None) -> dict[str, float]:
    today = today or date.today()
    cash_ledger = await current_wallet_balance(Wallet.cash, today=today)
    with_staff = await open_custody_total()
    return {
        "cash": round(cash_ledger + with_staff, 2),
        "cash_till_expected": await till_expected_cash(today=today),
        "cash_with_staff": with_staff,
        "bank": await current_wallet_balance(Wallet.bank, today=today),
        "esewa": await current_wallet_balance(Wallet.esewa, today=today),
        "as_of": today.isoformat(),
    }


async def list_ledger(
    *,
    wallet: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    entry_type: str | None = None,
    limit: int = 200,
) -> list[WalletLedgerEntry]:
    match: dict[str, Any] = {}
    if wallet:
        match["wallet"] = _parse_wallet(wallet).value
    if entry_type:
        match["entry_type"] = entry_type.strip().lower()
    if date_from or date_to:
        match["date"] = {}
        if date_from:
            _require_date(date_from)
            match["date"]["$gte"] = date_from
        if date_to:
            _require_date(date_to)
            match["date"]["$lte"] = date_to
    return (
        await WalletLedgerEntry.find(match)
        .sort([("date", -1), ("created_at", -1)])
        .limit(min(limit, 500))
        .to_list()
    )


async def build_day_book(day: str) -> list[dict[str, Any]]:
    _require_date(day)
    settings = await get_store_settings()
    day_close = await DayClose.find_one(DayClose.date == day)
    blocks: list[dict[str, Any]] = []

    for w in WALLETS:
        totals = await day_totals(w, day)
        if w == Wallet.cash:
            opening = _safe_amount(getattr(day_close, "opening_cash", 0)) if day_close else 0.0
            expected = round(opening + totals["net"], 2)
            closing_raw = getattr(day_close, "closing_cash", None) if day_close else None
            closing = _safe_amount(closing_raw) if day_close and closing_raw is not None else None
            variance = round(closing - expected, 2) if closing is not None else None
        else:
            baseline = await opening_baseline(w, settings)
            opening = round(baseline + await _ledger_net_before(w, day), 2)
            expected = round(opening + totals["net"], 2)
            statement = None
            if day_close:
                if w == Wallet.bank:
                    statement = getattr(day_close, "closing_bank", None)
                elif w == Wallet.esewa:
                    statement = getattr(day_close, "closing_esewa", None)
            closing = _safe_amount(statement) if statement is not None else None
            variance = round(closing - expected, 2) if closing is not None else None

        posted = await find_day_close_variance_entry(day, w.value)
        blocks.append({
            "wallet": w.value,
            "opening": opening,
            "sales_in": totals["sales_in"],
            "expenses_out": totals["expenses_out"],
            "transfers_in": totals["transfers_in"],
            "transfers_out": totals["transfers_out"],
            "adjustments_in": totals["adjustments_in"],
            "adjustments_out": totals["adjustments_out"],
            "custody_in": totals.get("custody_in", 0.0),
            "custody_out": totals.get("custody_out", 0.0),
            "expected": expected,
            "closing": closing,
            "variance": variance,
            "variance_posted": posted is not None,
        })
    return blocks


async def _ledger_net_before(wallet: Wallet, day: str) -> float:
    return await ledger_net(wallet, date_lt=day)


async def ensure_backfill(*, created_by: str = "system") -> dict[str, int]:
    """Idempotent: if ledger empty of sale/expense posts, seed from history."""
    sample = await WalletLedgerEntry.find({
        "entry_type": {"$in": [
            WalletEntryType.sale.value,
            WalletEntryType.expense.value,
            WalletEntryType.po_payment.value,
        ]},
    }).limit(1).to_list()
    if sample:
        return {"sales": 0, "expenses": 0, "skipped": 1}

    sales_n = 0
    txns = await Transaction.find({
        "status": {"$ne": TransactionStatus.voided.value},
    }).to_list()
    for txn in txns:
        if await post_sale(txn, created_by=created_by or txn.created_by or "system"):
            sales_n += 1

    exp_n = 0
    expenses = await Expense.find_all().to_list()
    for exp in expenses:
        if await post_expense(exp, created_by=created_by):
            exp_n += 1

    return {"sales": sales_n, "expenses": exp_n, "skipped": 0}
