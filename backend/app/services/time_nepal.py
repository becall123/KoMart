"""Nepal (Asia/Kathmandu) datetime helpers for sale timestamps."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

NPT = ZoneInfo("Asia/Kathmandu")


def resolve_sale_created_at(sale_date: str | None) -> datetime:
    """
    Build transaction created_at in UTC.

    - No sale_date → now (UTC).
    - Date-only (YYYY-MM-DD or midnight) → that calendar day in NPT + current NPT clock.
    - Datetime with non-midnight time → parse and normalize to UTC.
    """
    if not sale_date or not str(sale_date).strip():
        return datetime.now(timezone.utc)

    raw = str(sale_date).strip()
    try:
        if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
            d = date.fromisoformat(raw)
            return _combine_npt_date_with_now(d)
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Invalid sale_date; use YYYY-MM-DD",
        ) from exc

    if parsed.tzinfo is None:
        # Naive full datetime: treat as NPT wall time if it has a clock, else date-only path.
        if parsed.hour == 0 and parsed.minute == 0 and parsed.second == 0 and parsed.microsecond == 0:
            return _combine_npt_date_with_now(parsed.date())
        parsed = parsed.replace(tzinfo=NPT)
        return parsed.astimezone(timezone.utc)

    if (
        parsed.hour == 0
        and parsed.minute == 0
        and parsed.second == 0
        and parsed.microsecond == 0
    ):
        # Midnight in any tz from a date-only client payload → use NPT calendar date + now.
        return _combine_npt_date_with_now(parsed.astimezone(NPT).date())

    return parsed.astimezone(timezone.utc)


def _combine_npt_date_with_now(d: date) -> datetime:
    now_npt = datetime.now(NPT)
    local = datetime.combine(d, time(
        now_npt.hour,
        now_npt.minute,
        now_npt.second,
        now_npt.microsecond,
    ), tzinfo=NPT)
    return local.astimezone(timezone.utc)
