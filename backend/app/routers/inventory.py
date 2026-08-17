from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from math import ceil

from app.auth.dependencies import get_current_user, require_manager_or_above
from app.models.user import User
from app.models.product import Product
from app.models.inventory import AdjustmentType, InventoryBatch, StockAdjustment
from app.schemas.inventory import (
    BatchCreate,
    StockAdjustmentCreate,
    StockAdjustmentResponse,
    InventoryItemResponse,
    InventoryListResponse,
    InventoryStatsResponse,
    InventoryMovementResponse,
    MovementSummaryResponse,
    BatchResponse,
)
from app.schemas.common import PaginatedResponse, MessageResponse
from app.services.stock import (
    adjust_stock,
    expiring_product_ids,
    get_batches_for_products,
    get_current_stock,
    get_current_stock_batch,
    get_sorted_batches,
    nearest_expiry,
    receive_stock,
)
from app.models.audit_log import AuditModule
from app.services.audit import log_audit
from app.services.reporting import aggregate_product_inventory_stats
from app.services.response_cache import (
    INVENTORY_STATS_KEY,
    get_cached,
    set_cached,
)
from app.services.inventory_sync import apply_receive_product_updates, log_receive_price_change
from app.services.inventory_movements import (
    aggregate_movement_summary,
    build_movement_row,
    load_batch_po_map,
    load_sku_cache,
    load_txn_numbers,
    parse_movement_date_filters,
    product_ids_for_search,
)

router = APIRouter(prefix="/inventory", tags=["Inventory"])


def _adjustment_source(adj_type: AdjustmentType) -> str:
    return "sale" if adj_type == AdjustmentType.sale else "manual"


def _adjustment_response(adj: StockAdjustment) -> StockAdjustmentResponse:
    return StockAdjustmentResponse(
        id=str(adj.id),
        product_id=adj.product_id,
        product_name=adj.product_name,
        batch_id=adj.batch_id,
        transaction_id=adj.transaction_id,
        type=adj.type,
        quantity=adj.quantity,
        stock_before=adj.stock_before,
        stock_after=adj.stock_after,
        unit_cost=adj.unit_cost,
        extended_cost=adj.extended_cost,
        unit_selling_price=adj.unit_selling_price,
        extended_revenue=adj.extended_revenue,
        source=_adjustment_source(adj.type),
        reason=adj.reason,
        created_by=adj.created_by,
        created_at=adj.created_at.isoformat(),
    )


def _batch_response(batch: InventoryBatch) -> BatchResponse:
    return BatchResponse(
        id=str(batch.id),
        product_id=batch.product_id,
        batch_number=batch.batch_number,
        quantity=batch.quantity,
        unit_cost=getattr(batch, "unit_cost", 0.0) or 0.0,
        expiry_date=batch.expiry_date,
        purchase_order_id=batch.purchase_order_id,
        received_at=batch.received_at.isoformat(),
    )


async def _item_response(product: Product, batches: list[InventoryBatch]) -> InventoryItemResponse:
    active_batches = [batch for batch in batches if batch.quantity > 0]
    stock = sum(b.quantity for b in batches)
    return InventoryItemResponse(
        id=str(product.id),
        name=product.name,
        sku=product.sku,
        barcode=product.barcode,
        category=product.category,
        supplier_id=product.supplier_id,
        supplier_name=product.supplier_name,
        stock=stock,
        low_stock_threshold=product.low_stock_threshold,
        cost_price=product.cost_price,
        selling_price=product.selling_price,
        uom=product.uom or "pcs",
        buy_uom=getattr(product, "buy_uom", None) or product.uom or "pcs",
        units_per_buy_uom=getattr(product, "units_per_buy_uom", None) or 1,
        batches=[_batch_response(batch) for batch in batches],
        batch_count=len(active_batches),
        nearest_expiry=nearest_expiry(batches),
    )


@router.get("/stats", response_model=InventoryStatsResponse)
async def inventory_stats(response: Response, _: User = Depends(get_current_user)):
    cached = await get_cached(INVENTORY_STATS_KEY)
    if cached is not None:
        response.headers["X-Cache"] = "HIT"
        return InventoryStatsResponse(**cached)

    stats = await aggregate_product_inventory_stats()
    expiring_ids = await expiring_product_ids()

    result = InventoryStatsResponse(
        total_skus=int(stats["total_products"]),
        low_stock=int(stats["low_stock"]),
        out_of_stock=int(stats["out_of_stock"]),
        expiring=len(expiring_ids),
        inventory_value=round(float(stats["inventory_value"]), 2),
    )
    await set_cached(INVENTORY_STATS_KEY, result.model_dump())
    response.headers["X-Cache"] = "MISS"
    return result


@router.get("", response_model=InventoryListResponse)
async def list_inventory(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    search: str = Query(""),
    stock_filter: str = Query("all", alias="filter", pattern="^(all|low|out|expiring)$"),
    supplier_id: str = Query(""),
    category: str = Query(""),
    _: User = Depends(get_current_user),
):
    match: dict = {"is_active": True}
    if supplier_id:
        match["supplier_id"] = supplier_id
    if category:
        match["category"] = category
    if search:
        match["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"sku": {"$regex": search, "$options": "i"}},
        ]

    if stock_filter == "low":
        match["$expr"] = {
            "$and": [
                {"$gt": ["$stock", 0]},
                {"$lte": ["$stock", "$low_stock_threshold"]},
            ],
        }
    elif stock_filter == "out":
        match["stock"] = 0
    elif stock_filter == "expiring":
        expiring_ids = await expiring_product_ids()
        if not expiring_ids:
            return InventoryListResponse(
                data=[], total=0, page=page, page_size=page_size, total_pages=1,
                total_stock_value=0.0,
            )
        from beanie import PydanticObjectId
        match["_id"] = {"$in": [PydanticObjectId(pid) for pid in expiring_ids]}

    col = Product.get_motor_collection()
    total = await col.count_documents(match)
    products = await Product.find(match).sort("name").skip((page - 1) * page_size).limit(page_size).to_list()

    product_ids = [str(product.id) for product in products]
    batches_by_product = await get_batches_for_products(product_ids)
    stock_map = await get_current_stock_batch(product_ids)

    total_stock_value = 0.0
    for pid in product_ids:
        product = next((p for p in products if str(p.id) == pid), None)
        if product:
            total_stock_value += stock_map.get(pid, 0) * product.cost_price
    total_stock_value = round(total_stock_value, 2)

    items = []
    for product in products:
        item = await _item_response(product, batches_by_product.get(str(product.id), []))
        items.append(item)

    return InventoryListResponse(
        data=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 1,
        total_stock_value=total_stock_value,
    )


@router.get("/items/{product_id}", response_model=InventoryItemResponse)
async def get_inventory_item(
    product_id: str,
    _: User = Depends(get_current_user),
):
    product = await Product.get(product_id)
    if not product or not product.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
    batches = await get_sorted_batches(product_id)
    return await _item_response(product, batches)


@router.post("/batches", response_model=BatchResponse, status_code=status.HTTP_201_CREATED)
async def receive_batch(
    body: BatchCreate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    """Receive a new stock batch (sets expiry date and quantity)."""
    product = await Product.get(body.product_id)
    if not product or not product.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")

    stock_before = await get_current_stock(body.product_id)
    before_cost = product.cost_price
    before_sell = product.selling_price
    resolved_selling_price = product.selling_price

    product, _ = await apply_receive_product_updates(
        product,
        unit_cost=body.unit_cost,
        unit_selling_price=body.selling_price,
        supplier_id=body.supplier_id or None,
    )
    if body.selling_price is not None:
        resolved_selling_price = body.selling_price
    else:
        resolved_selling_price = product.selling_price

    await log_receive_price_change(
        product_id=body.product_id,
        before_cost=before_cost,
        before_sell=before_sell,
        product=product,
        current_user=current_user,
        request=request,
        module=AuditModule.inventory,
    )

    batch = await receive_stock(
        body.product_id,
        body.batch_number,
        body.quantity,
        expiry_date=body.expiry_date,
        unit_cost=body.unit_cost,
        unit_selling_price=resolved_selling_price,
        created_by=current_user.name,
    )

    refreshed = await Product.get(body.product_id)
    stock_after = await get_current_stock(body.product_id)
    await log_audit(
        module=AuditModule.inventory,
        action="receive",
        user=current_user,
        request=request,
        entity_type="product",
        entity_id=body.product_id,
        previous={"stock": stock_before},
        new={
            "stock": stock_after,
            "batch_number": body.batch_number,
            "quantity": body.quantity,
            "batch_id": str(batch.id),
        },
    )
    return _batch_response(batch)


@router.get("/history", response_model=PaginatedResponse[StockAdjustmentResponse])
async def inventory_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    product_id: str = Query(""),
    source: str = Query("", pattern="^(|manual|sale)$"),
    _: User = Depends(require_manager_or_above),
):
    """Paginated audit log of all inventory quantity changes."""
    query = StockAdjustment.find()
    if product_id:
        query = query.find(StockAdjustment.product_id == product_id)
    if source == "sale":
        query = query.find(StockAdjustment.type == AdjustmentType.sale)
    elif source == "manual":
        query = query.find(StockAdjustment.type != AdjustmentType.sale)

    total = await query.count()
    rows = (
        await query.sort("-created_at")
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )

    return PaginatedResponse(
        data=[_adjustment_response(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 1,
    )


def _build_movement_filters(
    *,
    product_id: str,
    search: str,
    direction: str,
    movement_type: str,
    start_date: str,
    end_date: str,
) -> dict:
    filters: dict = {}
    if product_id:
        filters["product_id"] = product_id
    if direction == "in":
        filters["quantity"] = {"$gt": 0}
    elif direction == "out":
        filters["quantity"] = {"$lt": 0}
    if movement_type:
        if movement_type == "purchase_order":
            filters["reference_type"] = "purchase_order"
        elif movement_type == "sale":
            filters["type"] = AdjustmentType.sale
        else:
            try:
                filters["type"] = AdjustmentType(movement_type)
            except ValueError:
                pass
    date_filters = parse_movement_date_filters(start_date, end_date)
    if date_filters:
        filters["created_at"] = date_filters
    return filters


async def _query_movements(
    filters: dict,
    search: str,
    page: int,
    page_size: int,
) -> tuple[list[InventoryMovementResponse], int]:
    query = StockAdjustment.find()
    if filters:
        query = query.find(filters)

    if search.strip():
        product_ids = await product_ids_for_search(search)
        if product_ids is not None:
            if not product_ids:
                return [], 0
            query = query.find({"product_id": {"$in": product_ids}})

    total = await query.count()
    rows = (
        await query.sort("-created_at")
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )

    batch_ids = {r.batch_id for r in rows if r.batch_id}
    txn_ids = {r.transaction_id for r in rows if r.transaction_id}
    txn_ids.update({r.reference_id for r in rows if r.reference_type == "sale" and r.reference_id})
    product_ids_set = {r.product_id for r in rows if not r.product_sku}

    batch_po_map = await load_batch_po_map(batch_ids)
    txn_numbers = await load_txn_numbers(txn_ids)
    sku_cache = await load_sku_cache(product_ids_set)

    data = [
        InventoryMovementResponse(**await build_movement_row(
            row,
            txn_numbers=txn_numbers,
            batch_po_map=batch_po_map,
            sku_cache=sku_cache,
        ))
        for row in rows
    ]
    return data, total


@router.get("/movements", response_model=PaginatedResponse[InventoryMovementResponse])
async def list_movements(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    product_id: str = Query(""),
    search: str = Query(""),
    direction: str = Query("", pattern="^(|in|out)$"),
    movement_type: str = Query("", pattern="^(|sale|receive|purchase_order|adjustment|damaged|correction)$"),
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    """Unified inventory movement ledger (all stock in/out events)."""
    filters = _build_movement_filters(
        product_id=product_id,
        search=search,
        direction=direction,
        movement_type=movement_type,
        start_date=start_date,
        end_date=end_date,
    )
    data, total = await _query_movements(filters, search, page, page_size)
    return PaginatedResponse(
        data=data,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 1,
    )


@router.get("/movements/summary", response_model=MovementSummaryResponse)
async def movement_summary(
    product_id: str = Query(""),
    search: str = Query(""),
    direction: str = Query("", pattern="^(|in|out)$"),
    movement_type: str = Query("", pattern="^(|sale|receive|purchase_order|adjustment|damaged|correction)$"),
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    filters = _build_movement_filters(
        product_id=product_id,
        search=search,
        direction=direction,
        movement_type=movement_type,
        start_date=start_date,
        end_date=end_date,
    )
    if search.strip():
        product_ids = await product_ids_for_search(search)
        if product_ids is not None:
            if not product_ids:
                return MovementSummaryResponse(movement_count=0, total_in=0, total_out=0)
            filters = {**filters, "product_id": {"$in": product_ids}}
    summary = await aggregate_movement_summary(filters)
    return MovementSummaryResponse(**summary)  # type: ignore[arg-type]


@router.post("/adjust", response_model=MessageResponse)
async def adjust_stock_endpoint(
    body: StockAdjustmentCreate,
    request: Request,
    current_user: User = Depends(require_manager_or_above),
):
    product = await Product.get(body.product_id)
    stock_before = await get_current_stock(body.product_id) if product else 0

    new_stock = await adjust_stock(
        body.product_id,
        body.quantity,
        body.type,
        body.reason,
        current_user.name,
        batch_id=body.batch_id,
    )

    await log_audit(
        module=AuditModule.inventory,
        action="adjust",
        user=current_user,
        request=request,
        entity_type="product",
        entity_id=body.product_id,
        previous={"stock": stock_before, "type": body.type.value},
        new={
            "stock": new_stock,
            "quantity_change": body.quantity,
            "type": body.type.value,
            "reason": body.reason,
        },
    )
    return MessageResponse(message=f"Stock adjusted. New stock: {new_stock}")
