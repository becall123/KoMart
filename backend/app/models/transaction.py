from beanie import Document, Indexed
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
from datetime import datetime, timezone
from pymongo import IndexModel, ASCENDING, DESCENDING


class PaymentMethod(str, Enum):
    cash = "cash"
    bank = "bank"
    esewa = "esewa"
    # Legacy — no longer offered in UI; normalize_payment_method maps to esewa
    khalti = "khalti"


class TransactionStatus(str, Enum):
    completed = "completed"
    voided = "voided"


class BatchAllocation(BaseModel):
    batch_id: str
    quantity: int
    unit_cost: float = 0.0


class TransactionItem(BaseModel):
    product_id: str
    name: str
    sku: str
    price: float = Field(ge=0)
    quantity: int = Field(ge=1)
    discount: float = Field(default=0.0, ge=0)
    list_price: float = 0.0
    unit_cost: float = 0.0
    category: str = ""
    sell_uom: str = ""
    unit_factor: int = Field(default=1, ge=1)
    batch_allocations: list[BatchAllocation] = Field(default_factory=list)


class AppliedPromotion(BaseModel):
    rule_id: str
    name: str
    amount: float


class Transaction(Document):
    transaction_number: Indexed(str, unique=True)  # type: ignore[valid-type]
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    items: list[TransactionItem] = Field(default_factory=list)
    subtotal: float = Field(ge=0)
    discount: float = Field(default=0.0, ge=0)
    promotion_discount: float = Field(default=0.0, ge=0)
    manual_discount: float = Field(default=0.0, ge=0)
    applied_promotions: list[AppliedPromotion] = Field(default_factory=list)
    coupon_code: str = ""
    tax: float = Field(ge=0)
    round_off: float = 0.0
    loyalty_points_redeemed: int = Field(default=0, ge=0)
    total: float = Field(ge=0)
    total_cost: float = Field(default=0.0, ge=0)
    payment_method: PaymentMethod
    status: TransactionStatus = TransactionStatus.completed
    void_reason: str = ""
    notes: str = ""
    voided_at: Optional[datetime] = None
    voided_by: Optional[str] = None
    created_by: str
    cashier_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    version: int = Field(default=1, ge=1)

    class Settings:
        name = "transactions"
        indexes = [
            IndexModel([("customer_id", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel([("created_at", DESCENDING)]),
            IndexModel([("payment_method", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel([("cashier_id", ASCENDING), ("created_at", DESCENDING)]),
        ]
