import re

from beanie import Document
from pydantic import Field, field_validator
from typing import Optional
from datetime import datetime, timezone
from enum import Enum
from pymongo import DESCENDING, ASCENDING, IndexModel


class ExpenseCategory(str, Enum):
    """Named codes kept for internal references (PO payment, setup helpers)."""
    setup_investment = "setup_investment"
    purchase_order = "purchase_order"
    rent = "rent"
    utilities = "utilities"
    salaries = "salaries"
    marketing = "marketing"
    supplies = "supplies"
    maintenance = "maintenance"
    equipment = "equipment"
    other = "other"


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class Expense(Document):
    title: str
    description: Optional[str] = None
    amount: float = Field(ge=0)
    category: str  # expense_categories.code
    date: str  # ISO date "YYYY-MM-DD"
    paid_to: Optional[str] = None
    bill_no: Optional[str] = None
    payment_method: Optional[str] = None
    is_setup_cost: bool = False
    purchase_order_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("date")
    @classmethod
    def _validate_date_format(cls, v: str) -> str:
        if not _ISO_DATE_RE.match(v):
            raise ValueError("date must be in YYYY-MM-DD format")
        return v

    @field_validator("category", mode="before")
    @classmethod
    def _coerce_category(cls, v) -> str:
        if isinstance(v, Enum):
            return str(v.value)
        return str(v).strip()

    class Settings:
        name = "expenses"
        indexes = [
            IndexModel([("date", DESCENDING)]),
            IndexModel([("category", ASCENDING), ("date", DESCENDING)]),
            IndexModel([("is_setup_cost", ASCENDING)]),
            IndexModel([("purchase_order_id", ASCENDING)]),
        ]
