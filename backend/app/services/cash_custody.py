"""Cash custody — cash held by staff outside till / before banking."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.models.cash_custody import CashCustody, CashCustodyStatus
from app.models.user import User
from app.models.wallet_ledger import Wallet, WalletDirection, WalletEntryType
from app.services import wallet_ledger as wl


def _require_date(day: str) -> str:
    day = (day or "").strip()[:10]
    if len(day) != 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="date must be YYYY-MM-DD")
    return day


async def take_custody(
    *,
    amount: float,
    held_by_user_id: str,
    taken_date: str,
    remarks: str,
    created_by: str,
) -> CashCustody:
    amount = round(float(amount), 2)
    if amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Amount must be greater than zero")
    remarks = (remarks or "").strip()
    if not remarks:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Remarks are required")
    day = _require_date(taken_date)

    holder = await User.get(held_by_user_id)
    if not holder or not holder.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Holder user not found or inactive")

    entry = await wl.post_entry(
        wallet=Wallet.cash,
        direction=WalletDirection.outflow,
        amount=amount,
        entry_type=WalletEntryType.custody,
        date=day,
        remarks=f"Cash with {holder.name}: {remarks}",
        reference_type="cash_custody",
        reference_id="pending",
        created_by=created_by,
    )

    doc = CashCustody(
        amount=amount,
        held_by_user_id=str(holder.id),
        held_by_name=holder.name,
        status=CashCustodyStatus.held,
        taken_date=day,
        remarks=remarks,
        taken_ledger_id=str(entry.id),
        created_by=created_by,
        updated_by=created_by,
    )
    await doc.insert()
    await entry.set({"reference_id": str(doc.id)})
    return doc


async def list_custodies(
    *,
    status_filter: str | None = None,
    held_by_user_id: str | None = None,
) -> list[CashCustody]:
    match: dict = {}
    if status_filter:
        match["status"] = status_filter
    if held_by_user_id:
        match["held_by_user_id"] = held_by_user_id
    return (
        await CashCustody.find(match)
        .sort([("taken_date", -1), ("created_at", -1)])
        .to_list()
    )


async def custody_summary() -> dict:
    held = await CashCustody.find(CashCustody.status == CashCustodyStatus.held).to_list()
    by_holder: dict[str, dict] = {}
    for row in held:
        key = row.held_by_user_id
        if key not in by_holder:
            by_holder[key] = {
                "user_id": key,
                "name": row.held_by_name,
                "amount": 0.0,
            }
        by_holder[key]["amount"] = round(by_holder[key]["amount"] + max(float(row.amount or 0), 0), 2)
    total = round(sum(v["amount"] for v in by_holder.values()), 2)
    return {
        "total_held": total,
        "by_holder": sorted(by_holder.values(), key=lambda x: (-x["amount"], x["name"])),
    }


async def return_custody(
    custody_id: str,
    *,
    resolved_date: str,
    remarks: str,
    updated_by: str,
) -> CashCustody:
    doc = await CashCustody.get(custody_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Custody record not found")
    if doc.status != CashCustodyStatus.held:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Custody is not open")
    day = _require_date(resolved_date)
    note = (remarks or "").strip() or f"Returned from {doc.held_by_name}"

    entry = await wl.post_entry(
        wallet=Wallet.cash,
        direction=WalletDirection.inflow,
        amount=float(doc.amount),
        entry_type=WalletEntryType.custody,
        date=day,
        remarks=f"Return from {doc.held_by_name}: {note}",
        reference_type="cash_custody",
        reference_id=str(doc.id),
        created_by=updated_by,
    )
    now = datetime.now(timezone.utc)
    await doc.set({
        "status": CashCustodyStatus.returned,
        "resolved_date": day,
        "resolved_at": now,
        "resolve_ledger_id": str(entry.id),
        "updated_by": updated_by,
        "updated_at": now,
    })
    refreshed = await CashCustody.get(custody_id)
    assert refreshed is not None
    return refreshed


async def deposit_custody(
    custody_id: str,
    *,
    wallet: str,
    resolved_date: str,
    remarks: str,
    updated_by: str,
) -> CashCustody:
    doc = await CashCustody.get(custody_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Custody record not found")
    if doc.status != CashCustodyStatus.held:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Custody is not open")

    w = (wallet or "").strip().lower()
    if w not in ("bank", "esewa"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Deposit wallet must be bank or esewa")
    day = _require_date(resolved_date)
    note = (remarks or "").strip() or f"Deposit from {doc.held_by_name}"

    entry = await wl.post_entry(
        wallet=w,
        direction=WalletDirection.inflow,
        amount=float(doc.amount),
        entry_type=WalletEntryType.custody,
        date=day,
        remarks=f"Deposit from {doc.held_by_name} to {w}: {note}",
        reference_type="cash_custody",
        reference_id=str(doc.id),
        created_by=updated_by,
    )
    now = datetime.now(timezone.utc)
    await doc.set({
        "status": CashCustodyStatus.deposited,
        "deposit_wallet": w,
        "resolved_date": day,
        "resolved_at": now,
        "resolve_ledger_id": str(entry.id),
        "updated_by": updated_by,
        "updated_at": now,
    })
    refreshed = await CashCustody.get(custody_id)
    assert refreshed is not None
    return refreshed
