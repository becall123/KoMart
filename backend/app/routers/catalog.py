from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response, status, Query
from math import ceil
from pydantic import BaseModel, Field
from typing import Optional

from app.models.product import Product, ProductStatus
from app.models.discount_rule import DiscountRule, DiscountRuleType
from app.schemas.common import PaginatedResponse
from app.services.store_settings import get_store_settings
from app.services.product_list import to_list_lean
from app.services.stock import get_current_stock, get_current_stock_batch
from app.http_cache import set_public_cache

router = APIRouter(prefix="/catalog", tags=["Catalog (Public)"])


# ── Response schemas ─────────────────────────────────────────────────────────

class CatalogProductResponse(BaseModel):
    id: str
    name: str
    sku: str
    barcode: str
    brand: str
    country_of_origin: str
    category: str
    description: str
    uom: str
    selling_price: float
    images: list[str]
    nutrition_info: Optional[str]
    allergen_info: Optional[str]
    status: ProductStatus
    tags: list[str] = Field(default_factory=list)
    is_popular: bool = False
    is_trending: bool = False
    in_stock: bool = True


class StoreInfoResponse(BaseModel):
    store_name: str
    address: str
    phone: str
    email: str
    logo_url: str


class CatalogOfferResponse(BaseModel):
    id: str
    name: str
    rule_type: str
    value: float
    product_ids: list[str] = Field(default_factory=list)
    category: str
    code: str
    starts_at: Optional[str]
    ends_at: Optional[str]


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _to_catalog(p: Product, *, lean: bool = False, stock: int | None = None) -> CatalogProductResponse:
    if stock is None:
        stock = await get_current_stock(str(p.id))
    # List keeps first image for cards; omits long text. Detail keeps full fields.
    if lean:
        images = list(p.images or [])[:1]
        description = ""
        nutrition_info = None
        allergen_info = None
    else:
        images = list(p.images or [])
        description = p.description
        nutrition_info = p.nutrition_info
        allergen_info = p.allergen_info
    return CatalogProductResponse(
        id=str(p.id),
        name=p.name,
        sku=p.sku,
        barcode=p.barcode,
        brand=p.brand,
        country_of_origin=p.country_of_origin,
        category=p.category,
        description=description,
        uom=p.uom if hasattr(p, "uom") and p.uom else "pcs",
        selling_price=p.selling_price,
        images=images,
        nutrition_info=nutrition_info,
        allergen_info=allergen_info,
        status=p.status if hasattr(p, "status") and p.status else ProductStatus.active,
        tags=p.tags if hasattr(p, "tags") and p.tags else [],
        is_popular=bool(getattr(p, "is_popular", False)),
        is_trending=bool(getattr(p, "is_trending", False)),
        in_stock=stock > 0,
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/store-info", response_model=StoreInfoResponse)
async def get_store_info(response: Response):
    """Public store info — no authentication required."""
    set_public_cache(response, max_age=60, s_maxage=300)
    settings = await get_store_settings()
    return StoreInfoResponse(
        store_name=settings.store_name,
        address=settings.address,
        phone=settings.phone,
        email=settings.email,
        logo_url=settings.logo_url,
    )


@router.get("/offers", response_model=list[CatalogOfferResponse])
async def list_offers(response: Response):
    """Public active offers — no authentication required."""
    set_public_cache(response, max_age=30, s_maxage=60)
    now = datetime.now(timezone.utc)
    rules = await DiscountRule.find(
        DiscountRule.is_active == True,  # noqa: E712
    ).sort("-priority", "name").to_list()

    result: list[CatalogOfferResponse] = []
    for rule in rules:
        if rule.starts_at:
            start = rule.starts_at if rule.starts_at.tzinfo else rule.starts_at.replace(tzinfo=timezone.utc)
            if start > now:
                continue
        if rule.ends_at:
            end = rule.ends_at if rule.ends_at.tzinfo else rule.ends_at.replace(tzinfo=timezone.utc)
            if end < now:
                continue
        result.append(CatalogOfferResponse(
            id=str(rule.id),
            name=rule.name,
            rule_type=rule.rule_type.value,
            value=rule.value,
            product_ids=rule.product_ids,
            category=rule.category,
            code=rule.code,
            starts_at=rule.starts_at.isoformat() if rule.starts_at else None,
            ends_at=rule.ends_at.isoformat() if rule.ends_at else None,
        ))
        if len(result) >= 20:
            break

    return result


@router.get("/tags", response_model=list[str])
async def list_tags(response: Response):
    """Public distinct product tags — no authentication required."""
    set_public_cache(response, max_age=60, s_maxage=300)
    pipeline = [
        {"$match": {"is_active": True, "status": {"$ne": ProductStatus.discontinued.value}}},
        {"$unwind": "$tags"},
        {"$group": {"_id": "$tags"}},
        {"$sort": {"_id": 1}},
    ]
    results = await Product.aggregate(pipeline).to_list()
    return [doc["_id"] for doc in results if doc["_id"]]


@router.get("", response_model=PaginatedResponse[CatalogProductResponse])
async def list_catalog(
    response: Response,
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=200),
    search: str = Query(""),
    category: str = Query(""),
    tag: str = Query(""),
    is_popular: bool | None = Query(None),
    is_trending: bool | None = Query(None),
    sort_by: str = Query("", pattern="^(|selling_price)$"),
    sort_order: str = Query("", pattern="^(|asc|desc)$"),
):
    """Public product catalog — no authentication required."""
    set_public_cache(response, max_age=30, s_maxage=60)
    query = Product.find(
        Product.is_active == True,  # noqa: E712
        Product.status != ProductStatus.discontinued,
    )

    if search:
        query = query.find({"$or": [
            {"name": {"$regex": search, "$options": "i"}},
            {"sku": {"$regex": search, "$options": "i"}},
            {"barcode": {"$regex": search, "$options": "i"}},
            {"brand": {"$regex": search, "$options": "i"}},
        ]})
    if category:
        query = query.find(Product.category == category)
    if tag:
        query = query.find({"tags": tag})
    if is_popular is True:
        query = query.find(Product.is_popular == True)  # noqa: E712
    if is_trending is True:
        query = query.find(Product.is_trending == True)  # noqa: E712

    total = await query.count()

    if sort_by and sort_order:
        direction = 1 if sort_order == "asc" else -1
        query = query.sort((sort_by, direction))

    products = await to_list_lean(
        query,
        skip=(page - 1) * page_size,
        limit=page_size,
    )

    product_ids = [str(p.id) for p in products]
    stock_map = await get_current_stock_batch(product_ids)
    data = [
        await _to_catalog(p, lean=True, stock=stock_map.get(str(p.id), 0))
        for p in products
    ]

    return PaginatedResponse(
        data=data,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 1,
    )


@router.get("/{product_id}", response_model=CatalogProductResponse)
async def get_catalog_product(product_id: str, response: Response):
    """Public product detail — no authentication required."""
    set_public_cache(response, max_age=60)
    product = await Product.get(product_id)
    if not product or not product.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
    if hasattr(product, "status") and product.status == ProductStatus.discontinued:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
    return await _to_catalog(product)
