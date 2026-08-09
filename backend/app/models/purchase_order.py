from beanie import Document
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Any, Optional
from enum import Enum
from datetime import datetime, timezone
from pymongo import IndexModel, ASCENDING, DESCENDING


class POStatus(str, Enum):
    draft = "draft"
    ordered = "ordered"
    partial = "partial"
    received = "received"
    cancelled = "cancelled"


class LineStatus(str, Enum):
    pending = "pending"
    partial = "partial"
    received = "received"


class PaymentStatus(str, Enum):
    unpaid = "unpaid"
    partial = "partial"
    paid = "paid"


def _coerce_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


class PurchaseOrderPayment(BaseModel):
    amount: float = Field(gt=0)
    date: str
    payment_method: str = "cash"
    bill_no: Optional[str] = None
    notes: str = ""
    expense_id: str = ""
    created_by: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("payment_method", mode="before")
    @classmethod
    def _coerce_payment_method(cls, v: Any) -> str:
        return _coerce_str(v, "cash") or "cash"

    @field_validator("notes", "expense_id", "created_by", mode="before")
    @classmethod
    def _coerce_optional_strings(cls, v: Any) -> str:
        return _coerce_str(v, "")

    @field_validator("bill_no", mode="before")
    @classmethod
    def _coerce_bill_no(cls, v: Any) -> Optional[str]:
        if v is None:
            return None
        text = str(v).strip()
        return text or None

    @field_validator("created_at", mode="before")
    @classmethod
    def _coerce_created_at(cls, v: Any) -> Any:
        if v is None:
            return datetime.now(timezone.utc)
        return v


class PurchaseOrderItem(BaseModel):
    product_id: str
    product_name: str
    quantity: int = Field(ge=1)
    unit_cost: float = Field(ge=0)
    received_quantity: int = Field(default=0, ge=0)
    order_uom: str = "pcs"
    base_uom: str = "pcs"
    units_per_buy_uom: int = Field(default=1, ge=1)

    @field_validator("product_id", "product_name", mode="before")
    @classmethod
    def _coerce_required_strings(cls, v: Any) -> str:
        return _coerce_str(v, "")

    @field_validator("quantity", mode="before")
    @classmethod
    def _coerce_quantity(cls, v: Any) -> Any:
        if v is None:
            return 1
        try:
            n = int(float(v))
        except (TypeError, ValueError):
            return 1
        return n if n >= 1 else 1

    @field_validator("unit_cost", mode="before")
    @classmethod
    def _coerce_unit_cost(cls, v: Any) -> Any:
        if v is None:
            return 0.0
        try:
            n = float(v)
        except (TypeError, ValueError):
            return 0.0
        return n if n >= 0 else 0.0

    @field_validator("received_quantity", mode="before")
    @classmethod
    def _coerce_received_quantity(cls, v: Any) -> Any:
        if v is None:
            return 0
        try:
            n = int(float(v))
        except (TypeError, ValueError):
            return 0
        return n if n >= 0 else 0

    @field_validator("units_per_buy_uom", mode="before")
    @classmethod
    def _coerce_units_per_buy_uom(cls, v: Any) -> Any:
        if v is None:
            return 1
        try:
            n = int(float(v))
        except (TypeError, ValueError):
            return 1
        return n if n >= 1 else 1

    @field_validator("order_uom", "base_uom", mode="before")
    @classmethod
    def _coerce_uom(cls, v: Any) -> str:
        return _coerce_str(v, "pcs") or "pcs"

    @property
    def base_quantity_ordered(self) -> int:
        return self.quantity * self.units_per_buy_uom


def line_status(item: PurchaseOrderItem) -> LineStatus:
    if item.received_quantity <= 0:
        return LineStatus.pending
    if item.received_quantity >= item.quantity:
        return LineStatus.received
    return LineStatus.partial


def compute_po_status(items: list[PurchaseOrderItem]) -> POStatus:
    if not items:
        return POStatus.ordered
    if all(i.received_quantity >= i.quantity for i in items):
        return POStatus.received
    if any(i.received_quantity > 0 for i in items):
        return POStatus.partial
    return POStatus.ordered


def compute_payment_status(amount_paid: float, total_amount: float) -> PaymentStatus:
    paid = round(max(0.0, amount_paid), 2)
    total = round(max(0.0, total_amount), 2)
    if paid <= 0:
        return PaymentStatus.unpaid
    if total > 0 and paid >= total:
        return PaymentStatus.paid
    return PaymentStatus.partial


def _safe_payment(raw: Any) -> PurchaseOrderPayment | None:
    """Parse one payment entry; skip invalid legacy rows instead of failing the PO."""
    try:
        if isinstance(raw, PurchaseOrderPayment):
            return raw
        if not isinstance(raw, dict):
            return None
        return PurchaseOrderPayment.model_validate(raw)
    except Exception:
        return None


class PurchaseOrder(Document):
    order_number: str
    supplier_id: str
    supplier_name: str
    status: POStatus = POStatus.draft
    items: list[PurchaseOrderItem] = Field(default_factory=list)
    total_amount: float = Field(ge=0)
    amount_paid: float = Field(default=0.0, ge=0)
    payment_status: PaymentStatus = PaymentStatus.unpaid
    payments: list[PurchaseOrderPayment] = Field(default_factory=list)
    expected_delivery: Optional[str] = None
    ordered_by: Optional[str] = None
    received_by: Optional[str] = None
    received_date: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("order_number", "supplier_id", "supplier_name", mode="before")
    @classmethod
    def _coerce_required_strings(cls, v: Any) -> str:
        return _coerce_str(v, "")

    @field_validator("status", mode="before")
    @classmethod
    def _coerce_status(cls, v: Any) -> Any:
        if v is None or v == "":
            return POStatus.draft
        if isinstance(v, POStatus):
            return v
        try:
            return POStatus(str(v).strip().lower())
        except ValueError:
            return POStatus.draft

    @field_validator("amount_paid", mode="before")
    @classmethod
    def _coerce_amount_paid(cls, v: Any) -> Any:
        if v is None:
            return 0.0
        try:
            n = float(v)
        except (TypeError, ValueError):
            return 0.0
        return n if n >= 0 else 0.0

    @field_validator("total_amount", mode="before")
    @classmethod
    def _coerce_total_amount(cls, v: Any) -> Any:
        if v is None:
            return 0.0
        try:
            n = float(v)
        except (TypeError, ValueError):
            return 0.0
        return n if n >= 0 else 0.0

    @field_validator("items", mode="before")
    @classmethod
    def _coerce_items(cls, v: Any) -> Any:
        if v is None:
            return []
        if not isinstance(v, list):
            return []
        cleaned: list[Any] = []
        for entry in v:
            try:
                if isinstance(entry, PurchaseOrderItem):
                    item = entry
                elif isinstance(entry, dict):
                    item = PurchaseOrderItem.model_validate(entry)
                else:
                    continue
                if not (item.product_id or item.product_name):
                    continue
                cleaned.append(item)
            except Exception:
                continue
        return cleaned

    @field_validator("payments", mode="before")
    @classmethod
    def _coerce_payments(cls, v: Any) -> list[Any]:
        if v is None:
            return []
        if not isinstance(v, list):
            return []
        cleaned: list[Any] = []
        for entry in v:
            payment = _safe_payment(entry)
            if payment is not None:
                cleaned.append(payment)
        return cleaned

    @field_validator("payment_status", mode="before")
    @classmethod
    def _coerce_payment_status(cls, v: Any) -> Any:
        if v is None or v == "":
            return PaymentStatus.unpaid
        if isinstance(v, PaymentStatus):
            return v
        try:
            return PaymentStatus(str(v).strip().lower())
        except ValueError:
            return PaymentStatus.unpaid

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _coerce_timestamps(cls, v: Any) -> Any:
        if v is None:
            return datetime.now(timezone.utc)
        return v

    @model_validator(mode="after")
    def _reconcile_payment_status(self) -> "PurchaseOrder":
        expected = compute_payment_status(self.amount_paid, self.total_amount)
        if self.payment_status != expected and self.payment_status == PaymentStatus.unpaid and self.amount_paid > 0:
            self.payment_status = expected
        return self

    class Settings:
        name = "purchase_orders"
        indexes = [
            IndexModel([("status", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel([("supplier_id", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel([("order_number", ASCENDING)], unique=True),
            IndexModel([("payment_status", ASCENDING), ("created_at", DESCENDING)]),
        ]
