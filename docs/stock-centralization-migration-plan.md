# Stock Centralization Migration Plan

## Executive Summary

The KoMart backend currently maintains stock quantities in two places:
- **`products.stock`** — a denormalized integer cached on the product document
- **`inventory_batches`** — the true source of truth, with per-batch quantities

This dual-write pattern creates consistency risk. A PO receive (`po_receive.py:_commit_writes`) directly `$inc`'s `products.stock`, while sales and adjustments go through `inventory_batches` then call `refresh_product_stock()`. If a batch write succeeds but the product cache refresh fails (or vice versa), the two sources diverge.

This plan eliminates the redundancy by making `inventory_batches` the single source of truth and removing `stock` from the products collection. All read paths will compute stock from batches via a shared service layer.

---

## 1. Decoupling Strategy: Remove `stock` from Products

### 1.1 Model Change
- **Remove** the `stock` field from `app/models/product.py` (`Product` model, line 108).
- **Remove** the `stock` index from `Product.Settings.indexes` (line 125: `IndexModel([("is_active", ASCENDING), ("stock", ASCENDING)])`).
- **Remove** `stock` from `ProductResponse` in `app/schemas/product.py` (line 198).
- **Remove** `stock` from `ProductCreate` in `app/schemas/product.py` (line 58).
- **Remove** `stock` from `ProductUpdate` if present (currently absent, but verify no downstream writes).

### 1.2 Service Layer: Centralized Stock Resolution
Add a new function `app/services/stock.py::get_current_stock(product_id: str) -> int` that sums positive `inventory_batches.quantity` for the product. This is the only function that reads stock quantity.

```python
async def get_current_stock(product_id: str) -> int:
    batches = await InventoryBatch.find(
        InventoryBatch.product_id == product_id,
        InventoryBatch.quantity > 0,
    ).to_list()
    return sum(batch.quantity for batch in batches)
```

Refactor `refresh_product_stock()` to use this same logic (it already does), but ensure **no other code writes to `product.stock`**.

### 1.3 Eliminate All Direct Product.stock Writes
Audit every location that sets `product.stock` or `$inc`'s it:

| File | Line(s) | Current Behavior | Required Change |
|------|---------|------------------|-----------------|
| `stock.py` | 52 | `refresh_product_stock()` writes `stock` | **Keep** — this is the cache refresh. After decoupling, this function is removed entirely (no cache to refresh). |
| `stock.py` | 145 | `deduct_stock_fefo()` calls `refresh_product_stock()` | Remove the call. |
| `stock.py` | 163 | `restock_from_deductions()` calls `refresh_product_stock()` | Remove the call. |
| `stock.py` | 290 | `receive_stock()` calls `refresh_product_stock()` | Remove the call. |
| `stock.py` | 352, 365 | `adjust_stock()` calls `refresh_product_stock()` | Remove the call. |
| `po_receive.py` | 97 | `$inc: {"stock": ctx.stock_delta[pid]}` | **Remove** the `$inc` on stock. Only update `cost_price`, `selling_price`, `supplier_id`, `supplier_name`, `updated_at`. |
| `products.py` | 357, 464 | `Product(..., stock=0)` on create | Remove `stock=0` from constructor. |
| `products.py` | 346 | `data.pop("stock", None)` on create | Remove — no longer needed. |
| `products.py` | 453 | `data.pop("stock", None)` on bulk create | Remove. |
| `products.py` | 196 | `_to_response()` returns `stock=p.stock` | Replace with computed value from `get_current_stock()`. |
| `inventory.py` | 101 | `_item_response()` returns `stock=product.stock` | Replace with computed value. |
| `catalog.py` | 93 | `in_stock=p.stock > 0` | Replace with `get_current_stock(p.id) > 0`. |
| `reports.py` | 402, 423, 431, 732, 759-760 | Various `product.stock` reads | Replace with computed stock. |
| `notifications.py` | 51-76 | Pipeline reads `$stock` from products | Replace with batch aggregation. |
| `dashboard_kpi.py` | — | No direct stock reads (good) | No change needed. |
| `inventory_movements.py` | — | No stock reads | No change needed. |

### 1.4 Response Schema Changes
All API responses that include `stock` must compute it dynamically:

- **`ProductResponse`**: Add a `stock: int` field computed by `get_current_stock(product_id)`.
- **`InventoryItemResponse`**: Already has `stock`; source from `get_current_stock()`.
- **`CatalogProductResponse`**: Add `stock` or keep `in_stock` computed from `get_current_stock()`.
- **`InventoryStatsResponse`**: Aggregations (`low_stock`, `out_of_stock`) must query `inventory_batches` instead of `products.stock`.
- **`LowStockProductRow`**, **`DeadStockProduct`**: Compute stock from batches.

---

## 2. Step-by-Step Implementation Guide

### Phase 0: Preparation (No Production Impact)

**Step 0.1 — Add the centralized stock reader**
Create `app/services/stock.py::get_current_stock()` as specified above. This becomes the single function for reading stock quantity.

**Step 0.2 — Add a consistency checker utility**
Create `app/services/stock.py::verify_stock_consistency(product_id: str) -> dict` that returns:
```python
{
    "product_id": str,
    "cached_stock": int,      # current product.stock value (pre-removal)
    "computed_stock": int,    # sum of positive batches
    "delta": int,             # cached - computed
    "is_consistent": bool,
}
```
This will be used during migration validation.

### Phase 1: Write-Path Fixes (Make All Writes Batch-Centric)

**Step 1.1 — Fix PO receive (`po_receive.py`)**
In `_commit_writes()`, remove the `$inc` on `stock`:
```python
# REMOVE:
if pid in ctx.stock_delta:
    update["$inc"] = {"stock": ctx.stock_delta[pid]}
```
Keep the batch inserts and product field updates (`cost_price`, `supplier_id`, etc.). After this change, PO receive only writes to `inventory_batches` and updates product metadata — never `stock`.

**Step 1.2 — Remove cache refresh calls from stock service**
In `stock.py`, remove `refresh_product_stock()` calls from:
- `deduct_stock_fefo()` (line 145)
- `restock_from_deductions()` (lines 161-163)
- `receive_stock()` (line 290)
- `adjust_stock()` (lines 352, 365)

The function `refresh_product_stock()` itself can be deprecated or kept as a no-op during transition.

**Step 1.3 — Remove stock from product creation**
In `products.py`:
- `create_product()`: Remove `data.pop("stock", None)` (line 346) and `stock=0` (line 357).
- `bulk_create_products()`: Remove `data.pop("stock", None)` (line 453) and `stock=0` (line 464).

### Phase 2: Read-Path Migration (Compute Stock from Batches)

**Step 2.1 — Update response mappers**

In `products.py::_to_response()`:
```python
# BEFORE:
stock=p.stock,
# AFTER:
stock=await get_current_stock(str(p.id)),
```

In `inventory.py::_item_response()`:
```python
# BEFORE:
stock=product.stock,
# AFTER:
stock=await get_current_stock(str(product.id)),
```

In `catalog.py::_to_catalog()`:
```python
# BEFORE:
in_stock=p.stock > 0,
# AFTER:
in_stock=await get_current_stock(str(p.id)) > 0,
```

**Step 2.2 — Update inventory stats aggregation**
In `reporting.py::aggregate_product_inventory_stats()`:
- Replace `$stock`-based `$group` with a pipeline that joins `inventory_batches`.
- Example approach: aggregate batch totals per product, then join with active products to compute `low_stock` and `out_of_stock` from computed values.

Alternative (simpler, slightly less performant): fetch all active products, compute stock for each via `get_current_stock()`, then aggregate in Python. Acceptable for stats endpoint which is already cached (30s TTL).

**Step 2.3 — Update low-stock / dead-stock / expiring reports**
In `reports.py`:
- `low_stock_report()`: Instead of `Product.find(Product.stock == 0)`, fetch active products and filter by `await get_current_stock(pid)`.
- `dead_stock_report()`: Same — compute stock per product from batches.
- `expiring_products_report()`: Already uses `inventory_batches` for expiry; add computed stock.

**Step 2.4 — Update notifications**
In `notifications.py::sync_notifications()`:
- Replace the `$match` pipeline on `$stock` with a pipeline that aggregates `inventory_batches` per product.
- Example:
```python
batch_pipeline = [
    {"$match": {"quantity": {"$gt": 0}}},
    {"$group": {"_id": "$product_id", "total": {"$sum": "$quantity"}}},
]
batch_totals = {row["_id"]: row["total"] async for row in await InventoryBatch.aggregate(batch_pipeline).to_list()}
# Then iterate active products and filter by batch_totals.get(pid, 0)
```

### Phase 3: Model Cleanup

**Step 3.1 — Remove `stock` from Product model**
In `app/models/product.py`:
- Delete `stock: int = Field(default=0, ge=0)` (line 108).
- Delete the stock index from `Settings.indexes` (line 125).

**Step 3.2 — Remove `stock` from schemas**
In `app/schemas/product.py`:
- Remove `stock` from `ProductCreate` (line 58).
- Remove `stock` from `ProductResponse` (line 198).

**Step 3.3 — Update any remaining references**
Run a repo-wide grep for `.stock` on `Product` objects and replace with `get_current_stock()`.

### Phase 4: Performance Optimization (Optional but Recommended)

Batch stock computation for list endpoints to avoid N+1 queries.

**Step 4.1 — Add `get_current_stock_batch()`**
```python
async def get_current_stock_batch(product_ids: list[str]) -> dict[str, int]:
    pipeline = [
        {"$match": {"product_id": {"$in": product_ids}, "quantity": {"$gt": 0}}},
        {"$group": {"_id": "$product_id", "total": {"$sum": "$quantity"}}},
    ]
    rows = await InventoryBatch.aggregate(pipeline).to_list()
    return {row["_id"]: row["total"] for row in rows}
```

**Step 4.2 — Use batch computation in list endpoints**
In `products.py::list_products()`, after fetching products:
```python
product_ids = [str(p.id) for p in products]
stock_map = await get_current_stock_batch(product_ids)
for p in products:
    p._computed_stock = stock_map.get(str(p.id), 0)
```
Then use `p._computed_stock` in `_to_response()`.

---

## 3. Data Migration Strategy

### 3.1 Pre-Migration Baseline
Run a one-time consistency check to identify any existing divergence between `products.stock` and `inventory_batches` sums:

```python
async def baseline_stock_audit() -> list[dict]:
    products = await Product.find(Product.is_active == True).to_list()
    results = []
    for p in products:
        computed = await get_current_stock(str(p.id))
        delta = p.stock - computed
        if delta != 0:
            results.append({
                "product_id": str(p.id),
                "sku": p.sku,
                "cached_stock": p.stock,
                "computed_stock": computed,
                "delta": delta,
            })
    return results
```

If `results` is non-empty, investigate root cause (likely the PO receive direct `$inc` path). Fix any discrepancies **before** proceeding.

### 3.2 Zero-Downtime Migration (Recommended)

Because the system is already using `inventory_batches` as the source of truth for most paths, the migration is primarily a **read-path and model cleanup**:

1. **Deploy write-path fixes** (Phase 1) — ensures all future mutations only touch `inventory_batches`.
2. **Deploy read-path changes with dual-read** — for one release cycle, read from `inventory_batches` but **do not remove** `products.stock` yet. Log any discrepancies.
3. **Deploy model cleanup** (Phase 3) — once dual-read shows zero deltas for a stable period (e.g., 48 hours), remove `stock` from the model and schema.
4. **Run backfill reconciliation** — for any products with stale `stock` values, run `refresh_product_stock()` one final time before removing the field.

### 3.3 Backfill Script (If Needed)
If baseline audit reveals inconsistencies, run:

```python
# backend/scripts/reconcile_stock.py
async def reconcile_all():
    products = await Product.find(Product.is_active == True).to_list()
    for p in products:
        computed = await get_current_stock(str(p.id))
        if p.stock != computed:
            await p.set({"stock": computed, "updated_at": datetime.now(timezone.utc)})
```

Execute this once before deploying write-path fixes to establish a clean baseline.

---

## 4. Validation Strategy

### 4.1 Automated Consistency Check (CI / Post-Deploy)
Add an endpoint or management command:

```python
# GET /api/v1/admin/stock-consistency
async def stock_consistency_check():
    products = await Product.find(Product.is_active == True).to_list()
    mismatches = []
    for p in products:
        computed = await get_current_stock(str(p.id))
        if hasattr(p, 'stock') and p.stock != computed:
            mismatches.append({
                "product_id": str(p.id),
                "sku": p.sku,
                "cached_stock": p.stock,
                "computed_stock": computed,
            })
    return {
        "total_products": len(products),
        "mismatches": mismatches,
        "is_consistent": len(mismatches) == 0,
    }
```

This should be called:
- After deployment
- After any PO receive or inventory adjustment
- As a scheduled job (e.g., every 5 minutes during business hours)

### 4.2 Endpoint-Level Validation

For each endpoint that returns stock data, verify the value matches `get_current_stock()`:

| Endpoint | Validation Rule |
|----------|----------------|
| `GET /api/v1/products` | Every item's `stock` == `get_current_stock(item.id)` |
| `GET /api/v1/products/{id}` | `stock` == `get_current_stock(id)` |
| `GET /api/v1/inventory` | Every item's `stock` == `get_current_stock(item.id)` |
| `GET /api/v1/inventory/items/{id}` | `stock` == `get_current_stock(id)` |
| `GET /api/v1/inventory/stats` | `low_stock` + `out_of_stock` <= `total_skus`; spot-check random products |
| `GET /api/v1/catalog` | `in_stock` matches `get_current_stock(id) > 0` |
| `GET /api/v1/reports/low-stock` | Every row's `stock` == `get_current_stock(row.product_id)` |
| `GET /api/v1/reports/dead-stock` | Every row's `stock` == `get_current_stock(row.product_id)` |
| `GET /api/v1/inventory/movements` | `stock_before` and `stock_after` are consistent with batch history |

### 4.3 Integration Test Suite
Add/extend tests to cover the centralized stock model:

```python
# tests/test_stock_centralization.py
import pytest
from app.services.stock import get_current_stock, get_current_stock_batch

@pytest.mark.asyncio
async def test_stock_computed_from_batches():
    product = await Product(...)  # create with stock=0
    await receive_stock(product.id, "B1", 10, ...)
    assert await get_current_stock(product.id) == 10

@pytest.mark.asyncio
async def test_po_receive_does_not_touch_product_stock():
    # After Phase 1 fix, verify Product.stock is unchanged by PO receive
    before = product.stock
    await receive_purchase_order_items(...)
    refreshed = await Product.get(product.id)
    assert refreshed.stock == before  # stock field is no longer written

@pytest.mark.asyncio
async def test_sale_deducts_from_batches_only():
    # Sale should only modify inventory_batches and stock_adjustments
    # Product.stock should never be directly written
    ...
```

### 4.4 Regression Smoke Test
Run the existing test suite to ensure no breakage:
```bash
cd backend && python -m pytest tests/ -v
```

Key tests to watch:
- `test_inventory_movements.py` — movement ledger reads
- `test_po_receive.py` — PO receive stock sync
- `test_po_receive_uom_conversion.py` — batch quantity math
- `test_products_bulk_update.py` — product update paths
- `test_product_status.py` — product listing

### 4.5 Manual Spot Checks
After deployment, verify in the running system:
1. Create a product → `stock` should be `0` (no batches).
2. Receive 5 units → `stock` should be `5`.
3. Receive 3 more → `stock` should be `8`.
4. Sell 2 → `stock` should be `6`.
5. Void the sale → `stock` should be `8`.
6. Check `/api/v1/products`, `/api/v1/inventory`, `/api/v1/catalog` — all should agree.

---

## 5. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| N+1 batch queries on list endpoints | Implement `get_current_stock_batch()` (Section 4.1) |
| Existing stale `products.stock` values | Run `reconcile_stock.py` before removing the field |
| Frontend still expects `stock` on ProductResponse | API schema preserves `stock` field, just computes it dynamically |
| PO receive regression | Extensive test coverage in `test_po_receive.py`; deploy write-path fix first with dual-write monitoring |
| Cache invalidation gaps | `bump_commerce_caches()` already called after all stock mutations; extend to cover new computed reads |

---

## 6. Rollback Plan

If issues arise after deploying Phase 1 (write-path fixes):
- Revert `po_receive.py` to include `$inc` on `stock`.
- Re-add `refresh_product_stock()` calls in `stock.py`.
- The system returns to the previous dual-write behavior.

If issues arise after Phase 3 (model cleanup):
- Re-add `stock: int` to `Product` model and schemas.
- Re-populate it via `reconcile_stock.py`.
- The system returns to the previous cached-stock behavior.

Because the migration is read-path safe (computed stock equals batch sum), rollback is low-risk.
