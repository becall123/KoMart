from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional

from app.models.product import ProductStatus, SellMode


def pack_selling_price_required(
    sell_mode: SellMode,
    units_per_buy_uom: int,
    pack_selling_price: float,
) -> bool:
    """Pack price must be set when saving a product that sells whole packs/boxes."""
    if sell_mode in (SellMode.unit, SellMode.both) and units_per_buy_uom > 1:
        return pack_selling_price > 0
    return True


def normalize_product_uoms(
    buy_uom: str,
    uom: str,
    units_per_buy_uom: int,
    sell_mode: SellMode | None = None,
) -> tuple[str, str, int, SellMode | None]:
    """When no conversion, Secondary mirrors Primary and factor is 1."""
    buy = (buy_uom or "").strip()
    units = max(1, int(units_per_buy_uom or 1))
    if units <= 1:
        mode = SellMode.unit if sell_mode is not None else None
        return buy, buy, 1, mode
    secondary = (uom or "").strip() or buy
    return buy, secondary, units, sell_mode


class ProductCreate(BaseModel):
    name: str
    sku: str = ""
    barcode: str = ""
    brand: str = ""
    country_of_origin: str = ""
    category: str = ""
    category_id: str = ""
    supplier_id: str = ""
    description: str = ""
    buy_uom: str = ""
    uom: str = ""
    units_per_buy_uom: int = Field(default=1, ge=1)
    sell_mode: SellMode = SellMode.unit
    cost_price: float = Field(ge=0)
    selling_price: float = Field(ge=0)
    pack_selling_price: float = Field(default=0.0, ge=0)
    discount_percent: float = Field(default=0.0, ge=0, le=100)
    offered_price: float = Field(default=0.0, ge=0)
    pack_discount_percent: float = Field(default=0.0, ge=0, le=100)
    pack_offered_price: float = Field(default=0.0, ge=0)
    images: list[str] = Field(default_factory=list)
    nutrition_info: Optional[str] = None
    allergen_info: Optional[str] = None
    low_stock_threshold: int = Field(ge=0, default=10)
    status: ProductStatus = ProductStatus.active
    tags: list[str] = Field(default_factory=list)
    is_popular: bool = False
    is_trending: bool = False
    cost_price_effective_from: Optional[str] = None
    selling_price_effective_from: Optional[str] = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: object) -> list[str]:
        if not value:
            return []
        seen: set[str] = set()
        out: list[str] = []
        for raw in value if isinstance(value, list) else []:
            tag = str(raw).strip()
            key = tag.lower()
            if tag and key not in seen:
                seen.add(key)
                out.append(tag)
        return out

    @model_validator(mode="after")
    def normalize_uoms(self) -> "ProductCreate":
        buy, secondary, units, mode = normalize_product_uoms(
            self.buy_uom,
            self.uom,
            self.units_per_buy_uom,
            self.sell_mode,
        )
        if not buy:
            raise ValueError("Primary Unit is required.")
        if units > 1 and not secondary:
            raise ValueError("Secondary Unit is required when conversion is used.")
        self.buy_uom = buy
        self.uom = secondary
        self.units_per_buy_uom = units
        if mode is not None:
            self.sell_mode = mode
        return self

    @model_validator(mode="after")
    def validate_pack_price(self) -> "ProductCreate":
        if not pack_selling_price_required(
            self.sell_mode,
            self.units_per_buy_uom,
            self.pack_selling_price,
        ):
            raise ValueError("Pack selling price is required when selling whole packs/boxes.")
        return self

    @model_validator(mode="after")
    def default_effective_from(self) -> "ProductCreate":
        from datetime import datetime, timezone

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self.cost_price > 0 and not (self.cost_price_effective_from or "").strip():
            self.cost_price_effective_from = today
        if self.selling_price > 0 and not (self.selling_price_effective_from or "").strip():
            self.selling_price_effective_from = today
        return self


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    country_of_origin: Optional[str] = None
    category: Optional[str] = None
    category_id: Optional[str] = None
    supplier_id: Optional[str] = None
    barcode: Optional[str] = None
    description: Optional[str] = None
    buy_uom: Optional[str] = None
    uom: Optional[str] = None
    units_per_buy_uom: Optional[int] = Field(default=None, ge=1)
    sell_mode: Optional[SellMode] = None
    cost_price: Optional[float] = Field(default=None, ge=0)
    selling_price: Optional[float] = Field(default=None, ge=0)
    pack_selling_price: Optional[float] = Field(default=None, ge=0)
    discount_percent: Optional[float] = Field(default=None, ge=0, le=100)
    offered_price: Optional[float] = Field(default=None, ge=0)
    pack_discount_percent: Optional[float] = Field(default=None, ge=0, le=100)
    pack_offered_price: Optional[float] = Field(default=None, ge=0)
    images: Optional[list[str]] = None
    nutrition_info: Optional[str] = None
    allergen_info: Optional[str] = None
    low_stock_threshold: Optional[int] = Field(default=None, ge=0)
    status: Optional[ProductStatus] = None
    tags: Optional[list[str]] = None
    is_popular: Optional[bool] = None
    is_trending: Optional[bool] = None
    cost_price_effective_from: Optional[str] = None
    selling_price_effective_from: Optional[str] = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: object) -> list[str] | None:
        if value is None:
            return None
        seen: set[str] = set()
        out: list[str] = []
        for raw in value if isinstance(value, list) else []:
            tag = str(raw).strip()
            key = tag.lower()
            if tag and key not in seen:
                seen.add(key)
                out.append(tag)
        return out


class ProductResponse(BaseModel):
    id: str
    name: str
    sku: str
    barcode: str
    brand: str
    country_of_origin: str
    category: str
    category_id: str = ""
    supplier_id: str
    supplier_name: str
    description: str
    buy_uom: str
    uom: str
    units_per_buy_uom: int
    sell_mode: SellMode
    cost_price: float
    selling_price: float
    pack_selling_price: float = 0.0
    margin_percent: float = 0.0
    discounted_amount: float = 0.0
    discount_percent: float = 0.0
    offered_price: float = 0.0
    pack_discount_percent: float = 0.0
    pack_offered_price: float = 0.0
    images: list[str]
    nutrition_info: Optional[str]
    allergen_info: Optional[str]
    stock: int
    low_stock_threshold: int
    status: ProductStatus
    tags: list[str] = Field(default_factory=list)
    is_popular: bool = False
    is_trending: bool = False
    cost_price_effective_from: Optional[str] = None
    selling_price_effective_from: Optional[str] = None
    created_at: str
    updated_at: str


class ProductBulkUpdateItem(ProductUpdate):
    id: str


class ProductBulkUpdateRequest(BaseModel):
    updates: list[ProductBulkUpdateItem] = Field(min_length=1, max_length=100)


class ProductBulkCreateItem(ProductCreate):
    """A create row paired with its spreadsheet row number for error reporting."""
    row: int = Field(ge=1)


class ProductBulkCreateRequest(BaseModel):
    products: list[ProductBulkCreateItem] = Field(min_length=1, max_length=100)


class ProductBulkCreateError(BaseModel):
    row: int
    sku: str
    detail: str


class ProductBulkCreateResponse(BaseModel):
    created: int
    errors: list[ProductBulkCreateError] = Field(default_factory=list)


class SkuSuggestItem(BaseModel):
    brand: str = ""
    category: str = ""


class SkuSuggestRequest(BaseModel):
    items: list[SkuSuggestItem] = Field(min_length=1, max_length=100)
    exclude: list[str] = Field(default_factory=list)


class SkuSuggestResponse(BaseModel):
    skus: list[str]


class ProductBulkUpdateError(BaseModel):
    id: str
    detail: str


class ProductBulkUpdateResponse(BaseModel):
    updated: int
    errors: list[ProductBulkUpdateError] = Field(default_factory=list)
