"""Wallet ledger — Cash / Bank / eSewa operating account movements."""

from enum import Enum
from datetime import datetime, timezone
from typing import Optional

from beanie import Document
from pydantic import Field
from pymongo import IndexModel, ASCENDING


class Wallet(str, Enum):
    cash = "cash"
    bank = "bank"
    esewa = "esewa"


class WalletDirection(str, Enum):
    inflow = "in"
    outflow = "out"


class WalletEntryType(str, Enum):
    sale = "sale"
    expense = "expense"
    po_payment = "po_payment"
    transfer = "transfer"
    adjustment = "adjustment"
    custody = "custody"
    opening = "opening"
    void_reversal = "void_reversal"


class WalletLedgerEntry(Document):
    date: str  # YYYY-MM-DD business date
    wallet: Wallet
    direction: WalletDirection
    amount: float = Field(gt=0)
    entry_type: WalletEntryType
    remarks: str = ""
    reference_type: str = ""
    reference_id: str = ""
    transfer_id: str = ""
    created_by: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "wallet_ledger"
        indexes = [
            IndexModel([("wallet", ASCENDING), ("date", ASCENDING)]),
            IndexModel([("date", ASCENDING)]),
            IndexModel([("reference_type", ASCENDING), ("reference_id", ASCENDING)]),
            IndexModel([("transfer_id", ASCENDING)]),
            IndexModel([("entry_type", ASCENDING), ("date", ASCENDING)]),
        ]
