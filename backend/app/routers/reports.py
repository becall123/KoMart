from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_user, require_manager_or_above
from app.models.customer import Customer
from app.models.expense import Expense as ExpenseDoc
from app.models.inventory import InventoryBatch
from app.models.product import Product, ProductStatus
from app.models.purchase_order import POStatus, PurchaseOrder
from app.models.day_close import DayClose
from app.models.transaction import Transaction, TransactionStatus
from app.models.user import User
from app.services.payment_methods import normalize_payment_method
from app.services.expense_helpers import is_setup_investment
import re
from app.schemas.common import PaginatedResponse
from app.schemas.dashboard import RevenueDataPoint, SalesByCategory, TopProduct
from app.schemas.reports import (
    DeadStockProduct,
    DailySummary,
    DailySalesBlock,
    DailyExpensesBlock,
    DailyCashBlock,
    WalletDayBookBlock,
    DayCloseBlock,
    ExpenseByCategory,
    ExpenseDataPoint,
    ExpenseSummary,
    ExpiringProductRow,
    InventoryCategoryBreakdown,
    InventoryReportSummary,
    LowStockProductRow,
    LoyaltySummary,
    MarginByCategory,
    ProfitDataPoint,
    ProfitSummary,
    PurchaseOrderStatusCount,
    PurchaseOrdersSummary,
    PurchasingBySupplier,
    SalesByCashier,
    SalesByDayOfWeek,
    SalesByHour,
    SalesByPaymentMethod,
    SalesSummary,
    TopCustomer,
)
from app.services.reporting import (
    aggregate_inventory_by_category,
    aggregate_last_sale_before,
    aggregate_product_inventory_stats,
    aggregate_sales_by_day,
    aggregate_sold_product_ids,
    build_product_cache,
    collect_product_ids,
    days_until,
    fetch_transactions,
    fill_daily_revenue,
    line_cogs,
    line_revenue,
    parse_date_range,
)
from app.services.stock import expiring_product_ids, get_current_stock, get_current_stock_batch

router = APIRouter(prefix="/reports", tags=["Reports"])

DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


@router.get("/sales-summary", response_model=SalesSummary)
async def sales_summary(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    total_revenue = sum(t.total for t in txns)
    count = len(txns)
    units = sum(item.quantity for t in txns for item in t.items)
    discount = sum(t.discount for t in txns)
    return SalesSummary(
        total_revenue=round(total_revenue, 2),
        transaction_count=count,
        avg_basket=round(total_revenue / count, 2) if count else 0.0,
        total_units_sold=units,
        total_discount=round(discount, 2),
    )


@router.get("/sales-by-payment-method", response_model=list[SalesByPaymentMethod])
async def sales_by_payment_method(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    stats: dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "count": 0})
    for txn in txns:
        method = normalize_payment_method(
            txn.payment_method.value if hasattr(txn.payment_method, "value") else str(txn.payment_method)
        )
        stats[method]["revenue"] += txn.total
        stats[method]["count"] += 1
    return [
        SalesByPaymentMethod(
            payment_method=method,
            revenue=round(v["revenue"], 2),
            count=v["count"],
        )
        for method, v in sorted(stats.items(), key=lambda x: x[1]["revenue"], reverse=True)
    ]


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@router.get("/daily-summary", response_model=DailySummary)
async def daily_summary_report(
    date: str = Query(..., description="Calendar day YYYY-MM-DD"),
    _: User = Depends(require_manager_or_above),
):
    if not _ISO_DATE_RE.match(date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")

    start = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    end = start.replace(hour=23, minute=59, second=59, microsecond=999999)

    txns = await Transaction.find({
        "created_at": {"$gte": start, "$lte": end},
        "status": {"$ne": TransactionStatus.voided.value},
    }).to_list()

    total_revenue = round(sum(t.total for t in txns), 2)
    payment_stats: dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "count": 0})
    cash_sales = 0.0
    for txn in txns:
        method = normalize_payment_method(
            txn.payment_method.value if hasattr(txn.payment_method, "value") else str(txn.payment_method)
        )
        payment_stats[method]["revenue"] += txn.total
        payment_stats[method]["count"] += 1
        if method == "cash":
            cash_sales += txn.total
    cash_sales = round(cash_sales, 2)

    expenses = await ExpenseDoc.find({"date": date}).to_list()
    total_expenses = round(sum(e.amount for e in expenses), 2)
    setup_investment = round(sum(e.amount for e in expenses if is_setup_investment(e)), 2)
    operating = round(total_expenses - setup_investment, 2)
    cash_expenses = round(
        sum(
            e.amount
            for e in expenses
            if normalize_payment_method(e.payment_method) == "cash"
        ),
        2,
    )

    day_close = await DayClose.find_one(DayClose.date == date)

    from app.services.wallet_ledger import ensure_backfill, build_day_book
    await ensure_backfill()
    wallet_blocks = await build_day_book(date)
    cash_block_data = next((b for b in wallet_blocks if b["wallet"] == "cash"), None)
    if cash_block_data:
        opening = cash_block_data["opening"]
        cash_sales = cash_block_data["sales_in"]
        cash_expenses = cash_block_data["expenses_out"]
        expected = cash_block_data["expected"]
        closing = float(cash_block_data["closing"] or 0)
        variance = float(cash_block_data["variance"] or 0) if cash_block_data["variance"] is not None else round(closing - expected, 2)
        transfers_in = cash_block_data["transfers_in"]
        transfers_out = cash_block_data["transfers_out"]
        adjustments_in = cash_block_data["adjustments_in"]
        adjustments_out = cash_block_data["adjustments_out"]
    else:
        opening = float(day_close.opening_cash) if day_close else 0.0
        closing = float(day_close.closing_cash) if day_close else 0.0
        expected = round(opening + cash_sales - cash_expenses, 2)
        variance = round(closing - expected, 2)
        transfers_in = transfers_out = adjustments_in = adjustments_out = 0.0

    by_payment = [
        SalesByPaymentMethod(
            payment_method=method,
            revenue=round(v["revenue"], 2),
            count=v["count"],
        )
        for method, v in sorted(payment_stats.items(), key=lambda x: x[1]["revenue"], reverse=True)
    ]

    day_close_block = None
    if day_close:
        closed_at = getattr(day_close, "closed_at", None)
        status_raw = getattr(day_close, "status", None) or "open"
        status_val = status_raw.value if hasattr(status_raw, "value") else str(status_raw)
        day_close_block = DayCloseBlock(
            date=day_close.date,
            opening_cash=day_close.opening_cash,
            closing_cash=day_close.closing_cash,
            closing_bank=getattr(day_close, "closing_bank", None),
            closing_esewa=getattr(day_close, "closing_esewa", None),
            notes=day_close.notes or "",
            status=status_val,
            closed_at=closed_at.isoformat() if closed_at else None,
            closed_by=getattr(day_close, "closed_by", "") or "",
            updated_by=day_close.updated_by or day_close.created_by or "",
            updated_at=day_close.updated_at.isoformat(),
        )

    return DailySummary(
        date=date,
        sales=DailySalesBlock(total_revenue=total_revenue, transaction_count=len(txns)),
        expenses=DailyExpensesBlock(
            total=total_expenses,
            setup_investment=setup_investment,
            operating=operating,
        ),
        by_payment_method=by_payment,
        cash=DailyCashBlock(
            opening=opening,
            cash_sales=cash_sales,
            cash_expenses=cash_expenses,
            transfers_in=transfers_in,
            transfers_out=transfers_out,
            adjustments_in=adjustments_in,
            adjustments_out=adjustments_out,
            expected=expected,
            closing=closing,
            variance=variance,
        ),
        wallets=[WalletDayBookBlock(**b) for b in wallet_blocks],
        day_close=day_close_block,
    )


@router.get("/revenue", response_model=list[RevenueDataPoint])
async def revenue_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    daily_totals = await aggregate_sales_by_day(start, end)
    return [
        RevenueDataPoint(date=day, revenue=round(revenue, 2))
        for day, revenue in fill_daily_revenue(start, end, daily_totals)
    ]


@router.get("/top-products", response_model=list[TopProduct])
async def top_products_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    limit: int = Query(10, ge=1, le=50),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    product_stats: dict[str, dict] = {}
    for txn in txns:
        for item in txn.items:
            pid = item.product_id
            if pid not in product_stats:
                product_stats[pid] = {"name": item.name, "qty": 0, "revenue": 0.0}
            product_stats[pid]["qty"] += item.quantity
            product_stats[pid]["revenue"] += line_revenue(item)
    return sorted(
        [
            TopProduct(
                product_id=pid,
                name=v["name"],
                quantity_sold=v["qty"],
                revenue=round(v["revenue"], 2),
            )
            for pid, v in product_stats.items()
        ],
        key=lambda x: x.revenue,
        reverse=True,
    )[:limit]


@router.get("/sales-by-category", response_model=list[SalesByCategory])
async def sales_by_category_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    product_ids = collect_product_ids(txns)
    product_cache = await build_product_cache(product_ids)
    category_stats: dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "count": 0})
    for txn in txns:
        for item in txn.items:
            product = product_cache.get(item.product_id)
            cat = product.category if product else "Other"
            category_stats[cat]["revenue"] += line_revenue(item)
            category_stats[cat]["count"] += item.quantity
    return [
        SalesByCategory(category=cat, revenue=round(v["revenue"], 2), count=v["count"])
        for cat, v in category_stats.items()
    ]


@router.get("/inventory-summary", response_model=InventoryReportSummary)
async def inventory_summary_report(_: User = Depends(require_manager_or_above)):
    stats = await aggregate_product_inventory_stats()
    expiring_ids = await expiring_product_ids()
    category_rows = await aggregate_inventory_by_category()

    return InventoryReportSummary(
        total_skus=int(stats["total_products"]),
        low_stock=int(stats["low_stock"]),
        out_of_stock=int(stats["out_of_stock"]),
        expiring=len(expiring_ids),
        inventory_value=round(float(stats["inventory_value"]), 2),
        by_category=[
            InventoryCategoryBreakdown(
                category=row["_id"] or "Other",
                sku_count=int(row["sku_count"]),
                total_stock=int(row["total_stock"]),
                stock_value=round(float(row["stock_value"]), 2),
            )
            for row in category_rows
        ],
    )


@router.get("/expiring-products", response_model=PaginatedResponse[ExpiringProductRow])
async def expiring_products_report(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    within_days: int = Query(30, ge=1, le=365),
    _: User = Depends(require_manager_or_above),
):
    today = date.today().isoformat()
    cutoff = (date.today() + timedelta(days=within_days)).isoformat()
    batch_query = InventoryBatch.find(
        InventoryBatch.quantity > 0,
        {"expiry_date": {"$gte": today, "$lte": cutoff}},
    )
    total = await batch_query.count()
    batches = (
        await batch_query.sort("+expiry_date")
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )

    product_cache = await build_product_cache({batch.product_id for batch in batches})
    rows: list[ExpiringProductRow] = []
    for batch in batches:
        if not batch.expiry_date:
            continue
        product = product_cache.get(batch.product_id)
        if not product:
            continue
        rows.append(
            ExpiringProductRow(
                product_id=batch.product_id,
                product_name=product.name,
                sku=product.sku,
                category=product.category,
                batch_number=batch.batch_number,
                quantity=batch.quantity,
                expiry_date=batch.expiry_date,
                days_until_expiry=days_until(batch.expiry_date),
            )
        )

    return PaginatedResponse(
        data=rows,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 1,
    )


@router.get("/low-stock", response_model=PaginatedResponse[LowStockProductRow])
async def low_stock_report(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    stock_filter: str = Query("low", pattern="^(low|out|both)$"),
    product_status: str = Query("", pattern="^(|active|discontinued|seasonal)$"),
    _: User = Depends(require_manager_or_above),
):
    query = Product.find(Product.is_active == True)  # noqa: E712
    if product_status:
        query = query.find(Product.status == ProductStatus(product_status))

    total = await query.count()
    products = (
        await query.sort("name")
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )

    product_ids = [str(p.id) for p in products]
    stock_map = await get_current_stock_batch(product_ids)

    rows: list[LowStockProductRow] = []
    for product in products:
        pid = str(product.id)
        stock = stock_map.get(pid, 0)
        if stock_filter == "out" and stock != 0:
            continue
        elif stock_filter == "low" and (stock == 0 or stock > product.low_stock_threshold):
            continue
        elif stock_filter == "both" and stock > product.low_stock_threshold:
            continue

        stock_status = "out" if stock == 0 else "low"
        prod_status = product.status.value if hasattr(product, "status") and product.status else "active"
        rows.append(
            LowStockProductRow(
                product_id=pid,
                product_name=product.name,
                sku=product.sku,
                category=product.category,
                stock=stock,
                low_stock_threshold=product.low_stock_threshold,
                status=stock_status,
                product_status=prod_status,
            )
        )
    return PaginatedResponse(
        data=rows,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 1,
    )


@router.get("/profit-summary", response_model=ProfitSummary)
async def profit_summary_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    product_cache = await build_product_cache(collect_product_ids(txns))

    total_revenue = 0.0
    total_cogs = 0.0
    total_discount = sum(t.discount for t in txns)
    daily: dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "cogs": 0.0})

    current = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while current <= end:
        daily[current.strftime("%Y-%m-%d")] = {"revenue": 0.0, "cogs": 0.0}
        current += timedelta(days=1)

    for txn in txns:
        day = txn.created_at.strftime("%Y-%m-%d")
        txn_cogs = sum(
            line_cogs(item, product_cache.get(item.product_id)) for item in txn.items
        )
        rev = txn.total
        total_revenue += rev
        total_cogs += txn_cogs
        if day in daily:
            daily[day]["revenue"] += rev
            daily[day]["cogs"] += txn_cogs

    gross_profit = total_revenue - total_cogs
    margin_pct = (gross_profit / total_revenue * 100) if total_revenue else 0.0
    daily_series = [
        ProfitDataPoint(
            date=d,
            revenue=round(v["revenue"], 2),
            cogs=round(v["cogs"], 2),
            gross_profit=round(v["revenue"] - v["cogs"], 2),
        )
        for d, v in sorted(daily.items())
    ]
    return ProfitSummary(
        total_revenue=round(total_revenue, 2),
        total_cogs=round(total_cogs, 2),
        gross_profit=round(gross_profit, 2),
        gross_margin_pct=round(margin_pct, 1),
        total_discount=round(total_discount, 2),
        daily=daily_series,
    )


@router.get("/margin-by-category", response_model=list[MarginByCategory])
async def margin_by_category_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    product_cache = await build_product_cache(collect_product_ids(txns))
    category_stats: dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "cogs": 0.0})

    for txn in txns:
        txn_line_total = sum(line_revenue(item) for item in txn.items)
        revenue_scale = (txn.total / txn_line_total) if txn_line_total else 1.0
        for item in txn.items:
            product = product_cache.get(item.product_id)
            cat = product.category if product else "Other"
            category_stats[cat]["revenue"] += line_revenue(item) * revenue_scale
            category_stats[cat]["cogs"] += line_cogs(item, product)

    result = []
    for cat, v in category_stats.items():
        profit = v["revenue"] - v["cogs"]
        margin = (profit / v["revenue"] * 100) if v["revenue"] else 0.0
        result.append(
            MarginByCategory(
                category=cat,
                revenue=round(v["revenue"], 2),
                cogs=round(v["cogs"], 2),
                gross_profit=round(profit, 2),
                gross_margin_pct=round(margin, 1),
            )
        )
    return sorted(result, key=lambda x: x.revenue, reverse=True)


@router.get("/purchasing-by-supplier", response_model=list[PurchasingBySupplier])
async def purchasing_by_supplier_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    pos = await PurchaseOrder.find(
        {
            "created_at": {"$gte": start, "$lte": end},
            "status": {"$nin": [POStatus.draft, POStatus.cancelled]},
        }
    ).to_list()
    stats: dict[str, dict] = defaultdict(
        lambda: {"supplier_name": "", "total": 0.0, "count": 0}
    )
    for po in pos:
        stats[po.supplier_id]["supplier_name"] = po.supplier_name
        stats[po.supplier_id]["total"] += po.total_amount
        stats[po.supplier_id]["count"] += 1
    return [
        PurchasingBySupplier(
            supplier_id=sid,
            supplier_name=v["supplier_name"],
            total_amount=round(v["total"], 2),
            order_count=v["count"],
        )
        for sid, v in sorted(stats.items(), key=lambda x: x[1]["total"], reverse=True)
    ]


@router.get("/purchase-orders-summary", response_model=PurchaseOrdersSummary)
async def purchase_orders_summary_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    pos = await PurchaseOrder.find({"created_at": {"$gte": start, "$lte": end}}).to_list()
    by_status: dict[str, int] = defaultdict(int)
    total_amount = 0.0
    for po in pos:
        by_status[po.status.value] += 1
        if po.status not in (POStatus.draft, POStatus.cancelled):
            total_amount += po.total_amount
    return PurchaseOrdersSummary(
        total_orders=len(pos),
        total_amount=round(total_amount, 2),
        by_status=[
            PurchaseOrderStatusCount(status=status, count=count)
            for status, count in sorted(by_status.items())
        ],
    )


@router.get("/top-customers", response_model=list[TopCustomer])
async def top_customers_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    limit: int = Query(10, ge=1, le=50),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    stats: dict[str, dict] = defaultdict(
        lambda: {"name": "", "count": 0, "spent": 0.0}
    )
    for txn in txns:
        if not txn.customer_id:
            continue
        stats[txn.customer_id]["name"] = txn.customer_name or "Unknown"
        stats[txn.customer_id]["count"] += 1
        stats[txn.customer_id]["spent"] += txn.total
    return sorted(
        [
            TopCustomer(
                customer_id=cid,
                customer_name=v["name"],
                transaction_count=v["count"],
                total_spent=round(v["spent"], 2),
            )
            for cid, v in stats.items()
        ],
        key=lambda x: x.total_spent,
        reverse=True,
    )[:limit]


@router.get("/loyalty-summary", response_model=LoyaltySummary)
async def loyalty_summary_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    points_redeemed = sum(t.loyalty_points_redeemed for t in txns)
    customer_ids_in_period = {t.customer_id for t in txns if t.customer_id}
    new_customers = await Customer.find(
        {"created_at": {"$gte": start, "$lte": end}}
    ).count()
    total_members = await Customer.count()
    active_members = len(customer_ids_in_period)
    return LoyaltySummary(
        points_redeemed=points_redeemed,
        active_members=active_members,
        new_customers=new_customers,
        total_members=total_members,
    )


@router.get("/sales-by-hour", response_model=list[SalesByHour])
async def sales_by_hour_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    stats: dict[int, dict] = {h: {"revenue": 0.0, "count": 0} for h in range(24)}
    for txn in txns:
        hour = txn.created_at.hour
        stats[hour]["revenue"] += txn.total
        stats[hour]["count"] += 1
    return [
        SalesByHour(
            hour=h,
            label=f"{h:02d}:00",
            revenue=round(stats[h]["revenue"], 2),
            transaction_count=stats[h]["count"],
        )
        for h in range(24)
    ]


@router.get("/sales-by-day-of-week", response_model=list[SalesByDayOfWeek])
async def sales_by_day_of_week_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    stats: dict[int, dict] = {d: {"revenue": 0.0, "count": 0} for d in range(7)}
    for txn in txns:
        day = txn.created_at.weekday()
        stats[day]["revenue"] += txn.total
        stats[day]["count"] += 1
    return [
        SalesByDayOfWeek(
            day=d,
            label=DAY_LABELS[d],
            revenue=round(stats[d]["revenue"], 2),
            transaction_count=stats[d]["count"],
        )
        for d in range(7)
    ]


@router.get("/sales-by-cashier", response_model=list[SalesByCashier])
async def sales_by_cashier_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    current_user: User = Depends(require_manager_or_above),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Access restricted to admin and manager")
    start, end = parse_date_range(start_date, end_date)
    txns = await fetch_transactions(start, end)
    stats: dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "count": 0})
    for txn in txns:
        cashier = txn.created_by or "Unknown"
        stats[cashier]["revenue"] += txn.total
        stats[cashier]["count"] += 1
    return [
        SalesByCashier(
            cashier=name,
            revenue=round(v["revenue"], 2),
            transaction_count=v["count"],
        )
        for name, v in sorted(stats.items(), key=lambda x: x[1]["revenue"], reverse=True)
    ]


@router.get("/dead-stock", response_model=list[DeadStockProduct])
async def dead_stock_report(
    days: int = Query(30, ge=1, le=365),
    product_status: str = Query("", pattern="^(|active|discontinued|seasonal)$"),
    _: User = Depends(require_manager_or_above),
):
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    recently_sold = await aggregate_sold_product_ids(cutoff)

    products = await Product.find(
        Product.is_active == True,  # noqa: E712
    ).to_list()

    if product_status:
        products = [p for p in products if p.status.value == product_status]

    product_ids = [str(p.id) for p in products]
    stock_map = await get_current_stock_batch(product_ids)
    products_with_stock = [p for p in products if stock_map.get(str(p.id), 0) > 0]

    dead_pids = [str(p.id) for p in products_with_stock if str(p.id) not in recently_sold]
    if not dead_pids:
        return []

    last_sale = await aggregate_last_sale_before(dead_pids, cutoff)

    dead: list[DeadStockProduct] = []
    for product in products_with_stock:
        pid = str(product.id)
        if pid not in dead_pids:
            continue
        stock = stock_map.get(pid, 0)
        if pid in last_sale:
            actual_days = (now - last_sale[pid]).days
        else:
            actual_days = days
        dead.append(
            DeadStockProduct(
                product_id=pid,
                product_name=product.name,
                sku=product.sku,
                category=product.category,
                stock=stock,
                stock_value=round(stock * product.cost_price, 2),
                days_without_sale=actual_days,
                product_status=product.status.value if hasattr(product, "status") and product.status else "active",
            )
        )
    return sorted(dead, key=lambda x: x.stock_value, reverse=True)


@router.get("/expense-summary", response_model=ExpenseSummary)
async def expense_summary_report(
    start_date: str = Query(""),
    end_date: str = Query(""),
    _: User = Depends(require_manager_or_above),
):
    start, end = parse_date_range(start_date, end_date)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    expenses = await ExpenseDoc.find(
        {"date": {"$gte": start_str, "$lte": end_str}}
    ).to_list()

    total_expenses = 0.0
    setup_investment = 0.0
    category_stats: dict[str, dict] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    daily: dict[str, float] = {}

    current = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while current <= end:
        daily[current.strftime("%Y-%m-%d")] = 0.0
        current += timedelta(days=1)

    for expense in expenses:
        total_expenses += expense.amount
        if is_setup_investment(expense):
            setup_investment += expense.amount
        cat_key = str(getattr(expense.category, "value", expense.category))
        category_stats[cat_key]["amount"] += expense.amount
        category_stats[cat_key]["count"] += 1
        if expense.date in daily:
            daily[expense.date] += expense.amount

    return ExpenseSummary(
        total_expenses=round(total_expenses, 2),
        setup_investment=round(setup_investment, 2),
        operating_expenses=round(total_expenses - setup_investment, 2),
        by_category=[
            ExpenseByCategory(
                category=cat,
                amount=round(v["amount"], 2),
                count=v["count"],
            )
            for cat, v in sorted(category_stats.items(), key=lambda x: x[1]["amount"], reverse=True)
        ],
        daily=[
            ExpenseDataPoint(date=d, amount=round(v, 2))
            for d, v in sorted(daily.items())
        ],
    )
