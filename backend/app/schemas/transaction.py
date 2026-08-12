from pydantic import BaseModel, Field
from typing import Optional
from app.models.transaction import PaymentMethod, TransactionItem, AppliedPromotion, TransactionStatus


class TransactionCreate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    items: list[TransactionItem]
    subtotal: float
    discount: float = Field(ge=0, default=0.0)
    promotion_discount: float = Field(ge=0, default=0.0)
    manual_discount: float = Field(ge=0, default=0.0)
    applied_promotions: list[AppliedPromotion] = Field(default_factory=list)
    coupon_code: str = ""
    tax: float = Field(ge=0)
    round_off: float = 0.0
    loyalty_points_redeemed: int = Field(ge=0, default=0)
    total: float
    payment_method: PaymentMethod
    created_by: str
    notes: str = Field(default="", max_length=500)
    sale_date: Optional[str] = None


class TransactionResponse(BaseModel):
    id: str
    transaction_number: str
    customer_id: Optional[str]
    customer_name: Optional[str]
    items: list[TransactionItem]
    subtotal: float
    discount: float
    promotion_discount: float = 0.0
    manual_discount: float = 0.0
    applied_promotions: list[AppliedPromotion] = Field(default_factory=list)
    coupon_code: str = ""
    tax: float
    round_off: float = 0.0
    loyalty_points_redeemed: int
    total: float
    total_cost: float = 0.0
    payment_method: PaymentMethod
    status: TransactionStatus = TransactionStatus.completed
    void_reason: str = ""
    notes: str = ""
    created_by: str
    cashier_id: Optional[str] = None
    created_at: str


class TransactionItemUpdate(BaseModel):
    product_id: str
    quantity: int = Field(ge=0)
    unit_price: Optional[float] = Field(None, ge=0)
    line_discount: float = Field(default=0.0, ge=0)


class TransactionUpdate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    payment_method: Optional[PaymentMethod] = None
    notes: Optional[str] = Field(None, max_length=500)
    manual_discount: Optional[float] = Field(None, ge=0)
    loyalty_points_redeemed: Optional[int] = Field(None, ge=0)
    tax: Optional[float] = Field(None, ge=0)
    round_off: Optional[float] = Field(None)
    items: Optional[list[TransactionItemUpdate]] = None
    expected_version: Optional[int] = Field(None, ge=1)


class TransactionVoidRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class TransactionItemResponse(TransactionItem):
    pass


class BackfillSaleLine(BaseModel):
    row: int = Field(ge=1)
    transaction_no: str
    sale_date: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    quantity: int = Field(ge=1)
    unit_price: Optional[float] = Field(default=None, ge=0)
    discount_amount: Optional[float] = Field(default=None, ge=0)
    payment_method: str
    customer_phone: Optional[str] = None
    customer_name: Optional[str] = None
    notes: Optional[str] = None


class BackfillSalesRequest(BaseModel):
    lines: list[BackfillSaleLine] = Field(min_length=1)
    expected_total: float = Field(ge=0)
    actual_total: float = Field(ge=0)


class BackfillSaleError(BaseModel):
    transaction_no: str
    rows: list[int] = Field(default_factory=list)
    detail: str


class BackfillSalesResponse(BaseModel):
    created: list[TransactionResponse] = Field(default_factory=list)
    errors: list[BackfillSaleError] = Field(default_factory=list)
    created_count: int = 0
    error_count: int = 0
    expected_total: float = 0.0
    actual_total: float = 0.0
    difference: float = 0.0


class BackfillValidateRequest(BaseModel):
    lines: list[BackfillSaleLine] = Field(min_length=1)


class BackfillValidateResponse(BaseModel):
    ok: bool = False
    errors: list[BackfillSaleError] = Field(default_factory=list)
    error_count: int = 0


class BackfillVarianceRequest(BaseModel):
    expected_total: float
    actual_total: float
    difference: float
    date: Optional[str] = None
    wallet: str = "cash"


class BackfillVarianceResponse(BaseModel):
    id: str
    wallet: str
    amount: float
    direction: str
    date: str
    remarks: str
    expected_total: float
    actual_total: float
    difference: float
