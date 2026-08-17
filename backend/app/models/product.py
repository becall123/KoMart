from beanie import Document, Indexed
from pydantic import Field
from typing import Optional
from datetime import datetime, timezone
from enum import Enum
from pymongo import IndexModel, ASCENDING


class ProductStatus(str, Enum):
    active = "active"
    discontinued = "discontinued"
    seasonal = "seasonal"


class SellMode(str, Enum):
    unit = "unit"    # sell whole sell-uom unit only (e.g. pack)
    piece = "piece"  # sell individual pieces only
    both = "both"    # sell pack or pieces


SELLABLE_PRODUCT_STATUSES = frozenset({ProductStatus.active, ProductStatus.seasonal})


def product_is_sellable(product: "Product") -> bool:
    return product.is_active and product.status in SELLABLE_PRODUCT_STATUSES


def _legacy_pack_price(product: "Product") -> float:
    """POS fallback when pack_selling_price is unset (legacy catalog rows only)."""
    units = getattr(product, "units_per_buy_uom", 1) or 1
    if units <= 1:
        return 0.0
    mode = getattr(product, "sell_mode", SellMode.unit)
    if mode == SellMode.piece or product.selling_price <= 0:
        return 0.0
    return product.selling_price * units


def _pack_billable_price(product: "Product") -> float:
    pack = getattr(product, "pack_selling_price", 0.0) or 0.0
    if pack > 0:
        return pack
    return _legacy_pack_price(product)


def product_is_billable(product: "Product") -> bool:
    """Sellable in POS — requires a positive price on at least one sell path."""
    if not product_is_sellable(product):
        return False

    mode = getattr(product, "sell_mode", SellMode.unit) or SellMode.unit
    units = getattr(product, "units_per_buy_uom", 1) or 1

    if mode == SellMode.piece:
        return product.selling_price > 0
    if mode == SellMode.unit:
        if units <= 1:
            return product.selling_price > 0
        return _pack_billable_price(product) > 0

    piece_ok = product.selling_price > 0
    pack_ok = units > 1 and _pack_billable_price(product) > 0
    return piece_ok or pack_ok


def billable_rejection_detail(product: "Product") -> str:
    if product.status == ProductStatus.discontinued:
        return f"Product '{product.name}' is discontinued and cannot be sold"

    mode = getattr(product, "sell_mode", SellMode.unit) or SellMode.unit
    units = getattr(product, "units_per_buy_uom", 1) or 1
    if mode == SellMode.unit and units > 1:
        return f"Product '{product.name}' has no pack selling price and cannot be sold"
    if mode == SellMode.both and units > 1 and product.selling_price <= 0:
        pack = _pack_billable_price(product)
        if pack <= 0:
            return f"Product '{product.name}' has no pack selling price and cannot be sold"
    return f"Product '{product.name}' has no selling price and cannot be sold"


class Product(Document):
    name: str
    sku: Indexed(str, unique=True)  # type: ignore[valid-type]
    barcode: str = ""
    brand: str = ""
    country_of_origin: str = ""
    category: Indexed(str) = ""     # type: ignore[valid-type]
    category_id: str = ""  # canonical FK; category string kept for search/display
    supplier_id: str = ""
    supplier_name: str = ""
    description: str = ""
    buy_uom: str = ""             # Primary Unit (purchase)
    uom: str = ""                 # Secondary Unit (stock); mirrors Primary when no conversion
    units_per_buy_uom: int = Field(default=1, ge=1)
    sell_mode: SellMode = SellMode.unit
    cost_price: float = Field(ge=0)
    selling_price: float = Field(ge=0)
    pack_selling_price: float = Field(default=0.0, ge=0)
    margin_percent: float = Field(default=0.0)
    discounted_amount: float = Field(default=0.0, ge=0)
    discount_percent: float = Field(default=0.0, ge=0, le=100)
    offered_price: float = Field(default=0.0, ge=0)
    pack_discount_percent: float = Field(default=0.0, ge=0, le=100)
    pack_offered_price: float = Field(default=0.0, ge=0)
    images: list[str] = Field(default_factory=list)
    nutrition_info: Optional[str] = None
    allergen_info: Optional[str] = None
    low_stock_threshold: int = 10
    status: ProductStatus = ProductStatus.active
    tags: list[str] = Field(default_factory=list)
    is_popular: bool = False
    is_trending: bool = False
    cost_price_effective_from: Optional[str] = None  # AD YYYY-MM-DD
    selling_price_effective_from: Optional[str] = None  # AD YYYY-MM-DD
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "products"
        indexes = [
            IndexModel([("supplier_id", ASCENDING)]),
            IndexModel([("is_active", ASCENDING), ("name", ASCENDING)]),
            IndexModel([("is_active", ASCENDING), ("category", ASCENDING)]),
            IndexModel([("is_active", ASCENDING), ("status", ASCENDING), ("name", ASCENDING)]),
            IndexModel([("tags", ASCENDING)]),
        ]
