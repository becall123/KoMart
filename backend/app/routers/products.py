from fastapi import APIRouter, HTTPException, status, Depends, Query, Request
from datetime import datetime, timezone
from math import ceil
import re

from app.auth.dependencies import get_current_user, require_manager_or_above
from app.models.user import User
from app.models.product import Product, ProductStatus, SellMode, product_is_sellable
from app.models.price_history import PriceHistory
from app.models.supplier import Supplier
from app.schemas.product import (
    ProductCreate,
    ProductUpdate,
    ProductResponse,
    ProductBulkUpdateRequest,
    ProductBulkUpdateResponse,
    ProductBulkUpdateError,
    ProductBulkCreateRequest,
    ProductBulkCreateResponse,
    ProductBulkCreateError,
    SkuSuggestRequest,
    SkuSuggestResponse,
    pack_selling_price_required,
    normalize_product_uoms,
)
from app.schemas.common import PaginatedResponse
from app.models.audit_log import AuditModule
from app.services.audit import log_audit, product_snapshot
from app.services.category_sync import resolve_category_fields, propagate_category_rename
from app.services.product_pricing import compute_product_pricing, apply_pricing_to_dict
from app.services.sku import generate_unique_sku, peek_unique_sku
from app.services.store_settings import get_store_settings
from app.services.product_list import to_list_lean

router = APIRouter(prefix="/products", tags=["Products"])


async def _resolve_supplier(supplier_id: str) -> Supplier:
    supplier = await Supplier.get(supplier_id)
    if not supplier:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Supplier not found")
    return supplier


async def _assert_unique_product_name(
    name: str,
    *,
    exclude_id: str | None = None,
) -> None:
    """Case-insensitive unique name among active products."""
    key = (name or "").strip()
    if not key:
        return
    escaped = re.escape(key)
    existing = await Product.find_one(
        Product.is_active == True,  # noqa: E712
        {"name": {"$regex": f"^{escaped}$", "$options": "i"}},
    )
    if existing and (not exclude_id or str(existing.id) != str(exclude_id)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Product name '{key}' already exists",
        )


async def _resolve_product_sku(
    sku: str,
    brand: str,
    category: str,
    *,
    exclude: set[str] | None = None,
    allow_auto: bool,
) -> str:
    normalized = sku.strip()
    if normalized:
        return normalized
    if not allow_auto:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="SKU is required")
    return await generate_unique_sku(brand, category, exclude=exclude)


def _pricing_sources(body_fields: set[str]) -> tuple[str, str]:
    unit_source = "offered" if "offered_price" in body_fields and "discount_percent" not in body_fields else (
        "percent" if "discount_percent" in body_fields else "auto"
    )
    pack_source = "offered" if "pack_offered_price" in body_fields and "pack_discount_percent" not in body_fields else (
        "percent" if "pack_discount_percent" in body_fields else "auto"
    )
    return unit_source, pack_source


async def _apply_product_update(
    product: Product,
    body: ProductUpdate,
    *,
    body_field_names: set[str] | None = None,
) -> dict:
    """Merge update onto product, resolve FKs, recompute pricing. Returns update_data dict."""
    fields = body_field_names or {k for k, v in body.model_dump().items() if v is not None}
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}

    buy = update_data.get("buy_uom", product.buy_uom)
    uom = update_data.get("uom", product.uom)
    units = update_data.get("units_per_buy_uom", product.units_per_buy_uom)
    mode = update_data.get("sell_mode", product.sell_mode)
    buy, uom, units, mode = normalize_product_uoms(buy, uom, units, mode)
    update_data["buy_uom"] = buy
    update_data["uom"] = uom
    update_data["units_per_buy_uom"] = units
    if mode is not None:
        update_data["sell_mode"] = mode

    eff_sell_mode = update_data.get("sell_mode", product.sell_mode)
    eff_units = update_data.get("units_per_buy_uom", product.units_per_buy_uom)
    eff_pack_price = update_data.get("pack_selling_price", product.pack_selling_price)
    if not pack_selling_price_required(eff_sell_mode, eff_units, eff_pack_price):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Pack selling price is required when selling whole packs/boxes.",
        )

    if "category_id" in update_data or "category" in update_data:
        cat_id, cat_name = await resolve_category_fields(
            category_id=update_data.pop("category_id", None),
            category=update_data.get("category"),
        )
        update_data["category_id"] = cat_id
        update_data["category"] = cat_name

    if "supplier_id" in update_data:
        sid = update_data["supplier_id"]
        if sid:
            supplier = await _resolve_supplier(sid)
            update_data["supplier_name"] = supplier.name
        else:
            update_data["supplier_name"] = ""

    if "name" in update_data:
        await _assert_unique_product_name(
            update_data["name"],
            exclude_id=str(product.id),
        )

    merged = {**product.model_dump(), **update_data}
    unit_src, pack_src = _pricing_sources(fields)
    pricing = apply_pricing_to_dict(
        merged,
        unit_discount_source=unit_src,  # type: ignore[arg-type]
        pack_discount_source=pack_src,  # type: ignore[arg-type]
    )
    update_data.update(pricing)
    update_data["updated_at"] = datetime.now(timezone.utc)
    return update_data


def _to_response(p: Product, *, lean: bool = False, include_images: bool = True) -> ProductResponse:
    # List endpoints omit long text; optionally keep first image for POS/Products cards.
    if lean:
        images = list(p.images or [])[:1] if include_images else []
        description = ""
        nutrition_info = ""
        allergen_info = ""
    else:
        images = list(p.images or [])
        description = p.description
        nutrition_info = p.nutrition_info
        allergen_info = p.allergen_info
    return ProductResponse(
        id=str(p.id),
        name=p.name,
        sku=p.sku,
        barcode=p.barcode,
        brand=p.brand,
        country_of_origin=p.country_of_origin,
        category=p.category,
        category_id=getattr(p, "category_id", "") or "",
        supplier_id=p.supplier_id,
        supplier_name=p.supplier_name,
        description=description,
        buy_uom=getattr(p, "buy_uom", None) or p.uom or "",
        uom=getattr(p, "uom", None) or getattr(p, "buy_uom", None) or "",
        units_per_buy_uom=getattr(p, "units_per_buy_uom", None) or 1,
        sell_mode=getattr(p, "sell_mode", None) or SellMode.unit,
        cost_price=p.cost_price,
        selling_price=p.selling_price,
        pack_selling_price=getattr(p, "pack_selling_price", 0.0) or 0.0,
        margin_percent=getattr(p, "margin_percent", 0.0) or 0.0,
        discounted_amount=getattr(p, "discounted_amount", 0.0) or 0.0,
        discount_percent=getattr(p, "discount_percent", 0.0) or 0.0,
        offered_price=getattr(p, "offered_price", 0.0) or 0.0,
        pack_discount_percent=getattr(p, "pack_discount_percent", 0.0) or 0.0,
        pack_offered_price=getattr(p, "pack_offered_price", 0.0) or 0.0,
        images=images,
        nutrition_info=nutrition_info,
        allergen_info=allergen_info,
        stock=p.stock,
        low_stock_threshold=p.low_stock_threshold,
        status=p.status if hasattr(p, "status") and p.status else ProductStatus.active,
        tags=p.tags if hasattr(p, "tags") and p.tags else [],
        is_popular=bool(getattr(p, "is_popular", False)),
        is_trending=bool(getattr(p, "is_trending", False)),
        cost_price_effective_from=getattr(p, "cost_price_effective_from", None),
        selling_price_effective_from=getattr(p, "selling_price_effective_from", None),
        created_at=p.created_at.isoformat(),
        updated_at=p.updated_at.isoformat(),
    )


@router.get("", response_model=PaginatedResponse[ProductResponse])
async def list_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    search: str = Query(""),
    exact_code: str = Query(""),
    category: str = Query(""),
    supplier_id: str = Query(""),
    status: str = Query("", pattern="^(|active|discontinued|seasonal)$"),
    sellable_only: bool = Query(False),
    is_popular: bool | None = Query(None),
    is_trending: bool | None = Query(None),
    sort_by: str = Query("", pattern="^(|name|sku|selling_price|sellingPrice|created_at|createdAt)$"),
    sort_order: str = Query("", pattern="^(|asc|desc)$"),
    include_images: bool = Query(True),
    lean: bool = Query(True),
    _: User = Depends(get_current_user),
):
    query = Product.find(Product.is_active == True)  # noqa: E712
    if sellable_only:
        # POS catalog: active/seasonal with a billable price path (piece or pack).
        query = query.find(Product.status != ProductStatus.discontinued)
        query = query.find({"$or": [
            {"selling_price": {"$gt": 0}},
            {"$and": [
                {"pack_selling_price": {"$gt": 0}},
                {"sell_mode": {"$in": [SellMode.unit.value, SellMode.both.value]}},
                {"units_per_buy_uom": {"$gt": 1}},
            ]},
        ]})
    elif status:
        query = query.find(Product.status == ProductStatus(status))
    code = exact_code.strip()
    if code:
        escaped = re.escape(code)
        query = query.find({"$or": [
            {"sku": {"$regex": f"^{escaped}$", "$options": "i"}},
            {"barcode": {"$regex": f"^{escaped}$", "$options": "i"}},
        ]})
    elif search:
        query = query.find({"$or": [
            {"name": {"$regex": search, "$options": "i"}},
            {"sku": {"$regex": search, "$options": "i"}},
            {"barcode": {"$regex": search, "$options": "i"}},
        ]})
    if category:
        query = query.find(Product.category == category)
    if supplier_id:
        query = query.find(Product.supplier_id == supplier_id)
    if is_popular is True:
        query = query.find(Product.is_popular == True)  # noqa: E712
    if is_trending is True:
        query = query.find(Product.is_trending == True)  # noqa: E712

    if sort_by and sort_order:
        direction = 1 if sort_order == "asc" else -1
        db_sort_field = {
            "sellingPrice": "selling_price",
            "createdAt": "created_at",
        }.get(sort_by, sort_by)
        query = query.sort((db_sort_field, direction))

    total = await query.count()
    skip = (page - 1) * page_size
    if lean:
        products = await to_list_lean(
            query,
            skip=skip,
            limit=page_size,
            include_images=include_images,
        )
        data = [_to_response(p, lean=True, include_images=include_images) for p in products]
    else:
        # Full documents for Excel / Bulk Add round-trip (all images + text fields).
        products = await query.skip(skip).limit(page_size).to_list()
        data = [_to_response(p, lean=False, include_images=True) for p in products]

    return PaginatedResponse(
        data=data,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 1,
    )


@router.post("/suggest-skus", response_model=SkuSuggestResponse)
async def suggest_skus(
    body: SkuSuggestRequest,
    _: User = Depends(get_current_user),
):
    """Suggest unique SKUs for preview without burning next_sku_seq (allocate on create only)."""
    exclude = {value.strip() for value in body.exclude if value.strip()}
    # Per-category cursor so multiple peeks in one request stay consecutive without $inc.
    next_seq_by_category: dict[str, int] = {}
    skus: list[str] = []
    for item in body.items:
        cat_key = (item.category or "").strip().lower()
        sku, next_seq = await peek_unique_sku(
            item.brand,
            item.category,
            exclude=exclude,
            start_seq=next_seq_by_category.get(cat_key),
        )
        next_seq_by_category[cat_key] = next_seq
        exclude.add(sku)
        skus.append(sku)
    return SkuSuggestResponse(skus=skus)


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: ProductCreate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    settings = await get_store_settings()
    try:
        sku = await _resolve_product_sku(
            body.sku,
            body.brand,
            body.category,
            allow_auto=settings.auto_sku or bool((body.category or "").strip()),
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    if await Product.find_one(Product.sku == sku):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="SKU already exists")
    await _assert_unique_product_name(body.name)
    supplier_name = ""
    if body.supplier_id:
        supplier = await _resolve_supplier(body.supplier_id)
        supplier_name = supplier.name
    data = body.model_dump()
    data["sku"] = sku
    data.pop("stock", None)
    category = data.pop("category", None)
    cat_id, cat_name = await resolve_category_fields(
        category_id=data.pop("category_id", None) or None,
        category=category,
    )
    product = Product(
        **data,
        category=cat_name,
        category_id=cat_id,
        supplier_name=supplier_name,
        stock=0,
    )
    pricing = compute_product_pricing(product)
    for key, value in pricing.items():
        setattr(product, key, value)
    await product.insert()

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cost_eff = (body.cost_price_effective_from or "").strip() or today
    sell_eff = (body.selling_price_effective_from or "").strip() or today
    history_rows = []
    if body.cost_price > 0:
        history_rows.append(PriceHistory(
            product_id=str(product.id),
            field="cost_price",
            old_value=0.0,
            new_value=body.cost_price,
            effective_from=cost_eff,
            changed_by=str(current_user.id),
        ))
    if body.selling_price > 0:
        history_rows.append(PriceHistory(
            product_id=str(product.id),
            field="selling_price",
            old_value=0.0,
            new_value=body.selling_price,
            effective_from=sell_eff,
            changed_by=str(current_user.id),
        ))
    if history_rows:
        await PriceHistory.insert_many(history_rows)

    await log_audit(
        module=AuditModule.products,
        action="create",
        user=current_user,
        request=request,
        entity_type="product",
        entity_id=str(product.id),
        new=product_snapshot(product),
    )
    return _to_response(product)


@router.post("/bulk-create", response_model=ProductBulkCreateResponse)
async def bulk_create_products(
    body: ProductBulkCreateRequest,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    """Create independent spreadsheet rows, returning row-level errors when needed."""
    created = 0
    errors: list[ProductBulkCreateError] = []
    seen_skus: set[str] = set()
    seen_names: set[str] = set()

    for item in body.products:
        try:
            sku = await _resolve_product_sku(
                item.sku,
                item.brand,
                item.category,
                exclude=seen_skus,
                allow_auto=True,
            )
        except HTTPException as exc:
            errors.append(ProductBulkCreateError(row=item.row, sku=item.sku.strip(), detail=str(exc.detail)))
            continue
        except Exception as exc:
            errors.append(ProductBulkCreateError(row=item.row, sku=item.sku.strip(), detail=str(exc)))
            continue

        if sku in seen_skus:
            errors.append(ProductBulkCreateError(row=item.row, sku=sku, detail="Duplicate SKU in this import"))
            continue
        seen_skus.add(sku)

        name_key = (item.name or "").strip().lower()
        if name_key and name_key in seen_names:
            errors.append(ProductBulkCreateError(row=item.row, sku=sku, detail="Duplicate name in this import"))
            continue

        try:
            if await Product.find_one(Product.sku == sku):
                errors.append(ProductBulkCreateError(row=item.row, sku=sku, detail="SKU already exists"))
                continue
            await _assert_unique_product_name(item.name)
            if name_key:
                seen_names.add(name_key)

            supplier_name = ""
            if item.supplier_id:
                supplier = await _resolve_supplier(item.supplier_id)
                supplier_name = supplier.name
            data = item.model_dump(exclude={"row"})
            data["sku"] = sku
            data.pop("stock", None)
            category = data.pop("category", None)
            cat_id, cat_name = await resolve_category_fields(
                category_id=data.pop("category_id", None) or None,
                category=category,
            )
            product = Product(
                **data,
                category=cat_name,
                category_id=cat_id,
                supplier_name=supplier_name,
                stock=0,
            )
            for key, value in compute_product_pricing(product).items():
                setattr(product, key, value)
            await product.insert()
            await log_audit(
                module=AuditModule.products,
                action="create",
                user=current_user,
                request=request,
                entity_type="product",
                entity_id=str(product.id),
                new=product_snapshot(product),
            )
            created += 1
        except HTTPException as exc:
            errors.append(ProductBulkCreateError(row=item.row, sku=sku, detail=str(exc.detail)))
        except Exception as exc:
            errors.append(ProductBulkCreateError(row=item.row, sku=sku, detail=str(exc)))

    return ProductBulkCreateResponse(created=created, errors=errors)


@router.post("/bulk-update", response_model=ProductBulkUpdateResponse)
async def bulk_update_products(
    body: ProductBulkUpdateRequest,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    updated = 0
    errors: list[ProductBulkUpdateError] = []

    for item in body.updates:
        product = await Product.get(item.id)
        if not product:
            errors.append(ProductBulkUpdateError(id=item.id, detail="Product not found"))
            continue
        before = product_snapshot(product)
        try:
            item_fields = {k for k, v in item.model_dump().items() if v is not None and k != "id"}
            update_body = ProductUpdate(**{k: v for k, v in item.model_dump().items() if k != "id" and v is not None})
            update_data = await _apply_product_update(
                product,
                update_body,
                body_field_names=item_fields,
            )
            await product.set(update_data)
            refreshed = await Product.get(item.id)
            after = product_snapshot(refreshed)  # type: ignore[arg-type]
            await log_audit(
                module=AuditModule.products,
                action="update",
                user=current_user,
                request=request,
                entity_type="product",
                entity_id=item.id,
                previous=before,
                new=after,
            )
            updated += 1
        except HTTPException as exc:
            errors.append(ProductBulkUpdateError(id=item.id, detail=str(exc.detail)))
        except Exception as exc:
            errors.append(ProductBulkUpdateError(id=item.id, detail=str(exc)))

    return ProductBulkUpdateResponse(updated=updated, errors=errors)


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(product_id: str, _: User = Depends(get_current_user)):
    product = await Product.get(product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
    return _to_response(product)


@router.patch("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: str,
    body: ProductUpdate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    product = await Product.get(product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
    before = product_snapshot(product)
    body_fields = {k for k, v in body.model_dump().items() if v is not None}

    if "cost_price" in body_fields and body.cost_price is not None and body.cost_price != product.cost_price:
        if not (body.cost_price_effective_from or "").strip():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Cost price effective from date is required when changing cost price.",
            )
    if "selling_price" in body_fields and body.selling_price is not None and body.selling_price != product.selling_price:
        if not (body.selling_price_effective_from or "").strip():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Selling price effective from date is required when changing selling price.",
            )

    old_cost = product.cost_price
    old_sell = product.selling_price
    update_data = await _apply_product_update(product, body, body_field_names=body_fields)
    await product.set(update_data)
    refreshed = await Product.get(product_id)
    after = product_snapshot(refreshed)  # type: ignore[arg-type]

    history_rows = []
    if "cost_price" in body_fields and body.cost_price is not None and body.cost_price != old_cost:
        history_rows.append(PriceHistory(
            product_id=product_id,
            field="cost_price",
            old_value=old_cost,
            new_value=body.cost_price,
            effective_from=(body.cost_price_effective_from or "").strip(),
            changed_by=str(current_user.id),
        ))
    if "selling_price" in body_fields and body.selling_price is not None and body.selling_price != old_sell:
        history_rows.append(PriceHistory(
            product_id=product_id,
            field="selling_price",
            old_value=old_sell,
            new_value=body.selling_price,
            effective_from=(body.selling_price_effective_from or "").strip(),
            changed_by=str(current_user.id),
        ))
    if history_rows:
        await PriceHistory.insert_many(history_rows)

    price_changed = (
        before.get("cost_price") != after.get("cost_price")
        or before.get("selling_price") != after.get("selling_price")
    )
    if price_changed:
        await log_audit(
            module=AuditModule.products,
            action="price_change",
            user=current_user,
            request=request,
            entity_type="product",
            entity_id=product_id,
            previous={
                "cost_price": before.get("cost_price"),
                "selling_price": before.get("selling_price"),
            },
            new={
                "cost_price": after.get("cost_price"),
                "selling_price": after.get("selling_price"),
                "cost_price_effective_from": getattr(refreshed, "cost_price_effective_from", None),
                "selling_price_effective_from": getattr(refreshed, "selling_price_effective_from", None),
            },
        )

    await log_audit(
        module=AuditModule.products,
        action="update",
        user=current_user,
        request=request,
        entity_type="product",
        entity_id=product_id,
        previous=before,
        new=after,
    )
    return _to_response(refreshed)  # type: ignore[arg-type]


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: str,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    product = await Product.get(product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
    before = product_snapshot(product)
    await product.set({"is_active": False})
    await log_audit(
        module=AuditModule.products,
        action="delete",
        user=current_user,
        request=request,
        entity_type="product",
        entity_id=product_id,
        previous=before,
        new={"is_active": False},
    )
