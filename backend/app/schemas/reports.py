from pydantic import BaseModel, Field

from app.schemas.dashboard import RevenueDataPoint, TopProduct, SalesByCategory


class SalesSummary(BaseModel):
    total_revenue: float
    transaction_count: int
    avg_basket: float
    total_units_sold: int
    total_discount: float


class SalesByPaymentMethod(BaseModel):
    payment_method: str
    revenue: float
    count: int


class InventoryCategoryBreakdown(BaseModel):
    category: str
    sku_count: int
    total_stock: int
    stock_value: float


class InventoryReportSummary(BaseModel):
    total_skus: int
    low_stock: int
    out_of_stock: int
    expiring: int
    inventory_value: float
    by_category: list[InventoryCategoryBreakdown]


class ExpiringProductRow(BaseModel):
    product_id: str
    product_name: str
    sku: str
    category: str
    batch_number: str
    quantity: int
    expiry_date: str
    days_until_expiry: int


class LowStockProductRow(BaseModel):
    product_id: str
    product_name: str
    sku: str
    category: str
    stock: int
    low_stock_threshold: int
    status: str
    product_status: str = "active"


class ProfitDataPoint(BaseModel):
    date: str
    revenue: float
    cogs: float
    gross_profit: float


class ProfitSummary(BaseModel):
    total_revenue: float
    total_cogs: float
    gross_profit: float
    gross_margin_pct: float
    total_discount: float
    daily: list[ProfitDataPoint]


class MarginByCategory(BaseModel):
    category: str
    revenue: float
    cogs: float
    gross_profit: float
    gross_margin_pct: float


class PurchasingBySupplier(BaseModel):
    supplier_id: str
    supplier_name: str
    total_amount: float
    order_count: int


class PurchaseOrderStatusCount(BaseModel):
    status: str
    count: int


class PurchaseOrdersSummary(BaseModel):
    total_orders: int
    total_amount: float
    by_status: list[PurchaseOrderStatusCount]


class TopCustomer(BaseModel):
    customer_id: str
    customer_name: str
    transaction_count: int
    total_spent: float


class LoyaltySummary(BaseModel):
    points_redeemed: int
    active_members: int
    new_customers: int
    total_members: int


class SalesByHour(BaseModel):
    hour: int
    label: str
    revenue: float
    transaction_count: int


class SalesByDayOfWeek(BaseModel):
    day: int
    label: str
    revenue: float
    transaction_count: int


class SalesByCashier(BaseModel):
    cashier: str
    revenue: float
    transaction_count: int


class DeadStockProduct(BaseModel):
    product_id: str
    product_name: str
    sku: str
    category: str
    stock: int
    stock_value: float
    days_without_sale: int
    product_status: str = "active"


class ExpenseByCategory(BaseModel):
    category: str
    amount: float
    count: int


class ExpenseDataPoint(BaseModel):
    date: str
    amount: float


class ExpenseSummary(BaseModel):
    total_expenses: float
    setup_investment: float
    operating_expenses: float = 0.0
    by_category: list[ExpenseByCategory]
    daily: list[ExpenseDataPoint]


class DailySalesBlock(BaseModel):
    total_revenue: float
    transaction_count: int


class DailyExpensesBlock(BaseModel):
    total: float
    setup_investment: float
    operating: float


class DailyCashBlock(BaseModel):
    opening: float
    cash_sales: float
    cash_expenses: float
    transfers_in: float = 0.0
    transfers_out: float = 0.0
    adjustments_in: float = 0.0
    adjustments_out: float = 0.0
    expected: float
    closing: float
    variance: float


class WalletDayBookBlock(BaseModel):
    wallet: str
    opening: float
    sales_in: float = 0.0
    expenses_out: float = 0.0
    transfers_in: float = 0.0
    transfers_out: float = 0.0
    adjustments_in: float = 0.0
    adjustments_out: float = 0.0
    custody_in: float = 0.0
    custody_out: float = 0.0
    expected: float
    closing: float | None = None
    variance: float | None = None
    variance_posted: bool = False


class DayCloseBlock(BaseModel):
    date: str
    opening_cash: float
    closing_cash: float
    closing_bank: float | None = None
    closing_esewa: float | None = None
    notes: str = ""
    status: str = "open"
    closed_at: str | None = None
    closed_by: str = ""
    updated_by: str = ""
    updated_at: str = ""


class DailySummary(BaseModel):
    date: str
    sales: DailySalesBlock
    expenses: DailyExpensesBlock
    by_payment_method: list[SalesByPaymentMethod]
    cash: DailyCashBlock
    wallets: list[WalletDayBookBlock] = Field(default_factory=list)
    day_close: DayCloseBlock | None = None


class DayCloseUpsert(BaseModel):
    opening_cash: float = Field(ge=0)
    closing_cash: float = Field(ge=0)
    closing_bank: float | None = Field(default=None, ge=0)
    closing_esewa: float | None = Field(default=None, ge=0)
    notes: str = ""


# Re-export dashboard shapes used by reports endpoints
__all__ = [
    "SalesSummary",
    "SalesByPaymentMethod",
    "RevenueDataPoint",
    "TopProduct",
    "SalesByCategory",
    "InventoryReportSummary",
    "ExpiringProductRow",
    "LowStockProductRow",
    "ProfitSummary",
    "MarginByCategory",
    "PurchasingBySupplier",
    "PurchaseOrdersSummary",
    "TopCustomer",
    "LoyaltySummary",
    "SalesByHour",
    "SalesByDayOfWeek",
    "SalesByCashier",
    "DeadStockProduct",
    "ExpenseByCategory",
    "ExpenseDataPoint",
    "ExpenseSummary",
    "DailySummary",
    "DayCloseUpsert",
    "DayCloseBlock",
]
