"""End-of-day cash close / till reconciliation."""

from beanie import Document
from pydantic import Field
from datetime import datetime, timezone
from typing import Optional, Literal
from enum import Enum
from pymongo import IndexModel, ASCENDING


class DayCloseStatus(str, Enum):
    open = "open"
    closed = "closed"


class DayClose(Document):
    date: str  # YYYY-MM-DD unique
    opening_cash: float = Field(default=0.0, ge=0)
    closing_cash: float = Field(default=0.0, ge=0)
    # Statement closings for digital wallets (None = not reconciled yet)
    closing_bank: Optional[float] = Field(default=None, ge=0)
    closing_esewa: Optional[float] = Field(default=None, ge=0)
    notes: str = ""
    status: DayCloseStatus = DayCloseStatus.open
    closed_at: Optional[datetime] = None
    closed_by: str = ""
    created_by: str = ""
    updated_by: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "day_closes"
        indexes = [
            IndexModel([("date", ASCENDING)], unique=True),
        ]
