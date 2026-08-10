"""Cash held by staff (not in till, not yet banked)."""

from enum import Enum
from datetime import datetime, timezone
from typing import Optional

from beanie import Document
from pydantic import Field
from pymongo import IndexModel, ASCENDING


class CashCustodyStatus(str, Enum):
    held = "held"
    returned = "returned"
    deposited = "deposited"


class CashCustody(Document):
    amount: float = Field(gt=0)
    held_by_user_id: str
    held_by_name: str
    status: CashCustodyStatus = CashCustodyStatus.held
    taken_date: str  # YYYY-MM-DD
    taken_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    resolved_date: Optional[str] = None
    resolved_at: Optional[datetime] = None
    deposit_wallet: Optional[str] = None  # bank | esewa
    remarks: str = ""
    taken_ledger_id: str = ""
    resolve_ledger_id: str = ""
    created_by: str = ""
    updated_by: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "cash_custodies"
        indexes = [
            IndexModel([("status", ASCENDING)]),
            IndexModel([("held_by_user_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("taken_date", ASCENDING)]),
        ]
