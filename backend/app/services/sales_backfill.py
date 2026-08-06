"""Admin Excel backfill of historical sales — full stock/wallet side effects, no loyalty/promos."""

from __future__ import annotations

from collections import OrderedDict, defaultdict
from datetime import date as date_cls

from fastapi import HTTPException, status

from app.models.customer import Customer
from app.models.product import Product, product_is_billable, billable_rejection_detail
from app.models.transaction import PaymentMethod, TransactionItem
from app.schemas.transaction import (
    BackfillSaleError,
    BackfillSaleLine,
    BackfillSalesResponse,
    BackfillValidateResponse,
    BackfillVarianceRequest,
    BackfillVarianceResponse,
    TransactionCreate,
    TransactionResponse,
)
from app.services.payment_methods import normalize_payment_method
from app.services.sales import _base_quantity, _resolve_server_line_pricing, record_sale
from app.services.stock import check_stock_available

MAX_BACKFILL_LINES = 2000
MAX_BACKFILL_GROUPS = 500


def _parse_payment_method(raw: str) -> PaymentMethod:
    normalized = normalize_payment_method(raw)
    if normalized not in ("cash", "bank", "esewa", "khalti"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid payment method '{raw}'. Use cash, bank, or esewa.",
        )
    if normalized == "khalti":
        return PaymentMethod.esewa
    return PaymentMethod(normalized)


async def _find_product(sku: str | None, barcode: str | None) -> Product:
    sku_key = (sku or "").strip()
    barcode_key = (barcode or "").strip()
    if not sku_key and not barcode_key:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="SKU or Barcode is required",
        )

    by_sku: Product | None = None
    by_barcode: Product | None = None
    if sku_key:
        by_sku = await Product.find_one({"sku": {"$regex": f"^{sku_key}$", "$options": "i"}})
    if barcode_key:
        by_barcode = await Product.find_one(
            {"barcode": {"$regex": f"^{barcode_key}$", "$options": "i"}}
        )

    if sku_key and barcode_key:
        if not by_sku and not by_barcode:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail=f"No product for SKU '{sku_key}' / Barcode '{barcode_key}'",
            )
        if by_sku and by_barcode and str(by_sku.id) != str(by_barcode.id):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"SKU '{sku_key}' and Barcode '{barcode_key}' resolve to different products",
            )
        product = by_sku or by_barcode
    else:
        product = by_sku or by_barcode

    if not product:
        label = f"SKU '{sku_key}'" if sku_key else f"Barcode '{barcode_key}'"
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"No product for {label}")
    return product


def _first_non_blank(values: list[str | None]) -> str:
    for v in values:
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def _agree_or_fail(field: str, values: list[str], transaction_no: str) -> str:
    nonempty = [str(v).strip() for v in values if v is not None and str(v).strip()]
    if not nonempty:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Transaction '{transaction_no}': {field} is required",
        )
    if field == "Sale Date":
        uniq = set(nonempty)
    else:
        uniq = {v.casefold() for v in nonempty}
    if len(uniq) > 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Transaction '{transaction_no}': conflicting {field} values",
        )
    return nonempty[0]


def _agree_discount(values: list[float | None], transaction_no: str) -> float:
    present = [float(v) for v in values if v is not None]
    if not present:
        return 0.0
    first = round(present[0], 2)
    for v in present[1:]:
        if abs(round(v, 2) - first) > 0.001:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Transaction '{transaction_no}': conflicting Discount Amount values",
            )
    return max(0.0, first)


def _group_lines(lines: list[BackfillSaleLine]) -> OrderedDict[str, list[BackfillSaleLine]]:
    if len(lines) > MAX_BACKFILL_LINES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Too many lines ({len(lines)}). Maximum is {MAX_BACKFILL_LINES} per request.",
        )

    groups: OrderedDict[str, list[BackfillSaleLine]] = OrderedDict()
    for ln in lines:
        key = (ln.transaction_no or "").strip()
        if not key:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Row {ln.row}: Transaction No is required",
            )
        groups.setdefault(key, []).append(ln)

    if len(groups) > MAX_BACKFILL_GROUPS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Too many transactions ({len(groups)}). "
                f"Maximum is {MAX_BACKFILL_GROUPS} per request."
            ),
        )
    return groups


async def _assert_aggregated_stock(items: list[TransactionItem]) -> None:
    """Sum base qty per product so multi-line same SKU is checked once."""
    needed: dict[str, int] = defaultdict(int)
    names: dict[str, str] = {}
    for item in items:
        qty = _base_quantity(item)
        needed[item.product_id] += qty
        names[item.product_id] = item.name or item.sku or item.product_id
    for product_id, qty in needed.items():
        try:
            await check_stock_available(product_id, qty)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"{names.get(product_id, product_id)}: {detail}",
            ) from exc


async def prepare_backfill_sale(
    *,
    lines: list[BackfillSaleLine],
    transaction_no: str,
    created_by: str,
) -> TransactionCreate:
    """Build a TransactionCreate without promos/loyalty; honor Excel unit prices."""
    sale_date = _agree_or_fail("Sale Date", [ln.sale_date for ln in lines], transaction_no)
    payment_raw = _agree_or_fail(
        "Payment Method",
        [ln.payment_method for ln in lines],
        transaction_no,
    )
    payment_method = _parse_payment_method(payment_raw)
    manual = _agree_discount([ln.discount_amount for ln in lines], transaction_no)
    notes = _first_non_blank([ln.notes for ln in lines])
    customer_phone = _first_non_blank([ln.customer_phone for ln in lines])
    customer_name = _first_non_blank([ln.customer_name for ln in lines]) or "Walk-In Customer"

    customer_id: str | None = None
    if customer_phone:
        customer = await Customer.find_one(Customer.phone == customer_phone)
        if customer:
            customer_id = str(customer.id)
            if not _first_non_blank([ln.customer_name for ln in lines]):
                customer_name = customer.name

    items: list[TransactionItem] = []
    for ln in lines:
        product = await _find_product(ln.sku, ln.barcode)
        if not product_is_billable(product):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=billable_rejection_detail(product),
            )
        catalog_price, factor, sell_uom = _resolve_server_line_pricing(product, "")
        price = round(float(ln.unit_price), 2) if ln.unit_price is not None else catalog_price
        if price < 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid unit price for product {product.sku}",
            )
        items.append(
            TransactionItem(
                product_id=str(product.id),
                name=product.name,
                sku=product.sku,
                price=price,
                quantity=int(ln.quantity),
                discount=0.0,
                sell_uom=sell_uom,
                unit_factor=factor,
            )
        )

    await _assert_aggregated_stock(items)

    subtotal = round(sum(i.price * i.quantity for i in items), 2)
    manual = min(manual, subtotal)
    total = round(max(0.0, subtotal - manual), 2)

    return TransactionCreate(
        customer_id=customer_id,
        customer_name=customer_name,
        items=items,
        subtotal=subtotal,
        discount=manual,
        promotion_discount=0.0,
        manual_discount=manual,
        applied_promotions=[],
        coupon_code="",
        tax=0.0,
        round_off=0.0,
        loyalty_points_redeemed=0,
        total=total,
        payment_method=payment_method,
        created_by=created_by,
        notes=notes[:500],
        sale_date=sale_date[:10],
    )


async def record_backfill_sale(
    body: TransactionCreate,
    cashier_id: str | None = None,
) -> TransactionResponse:
    return await record_sale(
        body,
        cashier_id=cashier_id,
        apply_loyalty=False,
        skip_server_pricing=True,
    )


async def validate_backfill_sales(lines: list[BackfillSaleLine]) -> BackfillValidateResponse:
    """Dry-run: resolve products + aggregated stock; no writes."""
    groups = _group_lines(lines)
    errors: list[BackfillSaleError] = []

    for txn_no, group_lines in groups.items():
        rows = [ln.row for ln in group_lines]
        try:
            await prepare_backfill_sale(
                lines=group_lines,
                transaction_no=txn_no,
                created_by="validate",
            )
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            errors.append(
                BackfillSaleError(transaction_no=txn_no, rows=rows, detail=detail)
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(
                BackfillSaleError(
                    transaction_no=txn_no,
                    rows=rows,
                    detail=str(exc) or "Unexpected error",
                )
            )

    return BackfillValidateResponse(
        ok=len(errors) == 0,
        errors=errors,
        error_count=len(errors),
    )


async def backfill_sales_from_rows(
    lines: list[BackfillSaleLine],
    *,
    created_by: str,
    cashier_id: str | None,
) -> BackfillSalesResponse:
    groups = _group_lines(lines)

    created: list[TransactionResponse] = []
    errors: list[BackfillSaleError] = []

    for txn_no, group_lines in groups.items():
        rows = [ln.row for ln in group_lines]
        try:
            body = await prepare_backfill_sale(
                lines=group_lines,
                transaction_no=txn_no,
                created_by=created_by,
            )
            result = await record_backfill_sale(body, cashier_id=cashier_id)
            created.append(result)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            errors.append(
                BackfillSaleError(transaction_no=txn_no, rows=rows, detail=detail)
            )
        except Exception as exc:  # noqa: BLE001 — partial success batch
            errors.append(
                BackfillSaleError(
                    transaction_no=txn_no,
                    rows=rows,
                    detail=str(exc) or "Unexpected error",
                )
            )

    return BackfillSalesResponse(
        created=created,
        errors=errors,
        created_count=len(created),
        error_count=len(errors),
    )


async def post_backfill_variance(
    body: BackfillVarianceRequest,
    *,
    created_by: str,
) -> BackfillVarianceResponse:
    expected = round(float(body.expected_total), 2)
    actual = round(float(body.actual_total), 2)
    difference = round(float(body.difference), 2)
    if abs(difference - (expected - actual)) > 0.02:
        difference = round(expected - actual, 2)
    if abs(difference) < 0.01:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Difference is zero — nothing to post",
        )

    wallet = (body.wallet or "cash").strip().lower() or "cash"
    day = (body.date or "").strip()[:10] or date_cls.today().isoformat()
    amount = abs(difference)
    # Expected > Actual → sales overstated vs books → outflow to align cash down
    direction = "out" if difference > 0 else "in"
    remarks = (
        f"Backfill sales variance (Expected {expected:.2f}, Actual {actual:.2f}, "
        f"Diff {difference:.2f})"
    )

    from app.services import wallet_ledger as wl

    entry = await wl.create_adjustment(
        wallet=wallet,
        amount=amount,
        direction=direction,
        date=day,
        remarks=remarks,
        created_by=created_by,
        reference_type="sales_backfill",
        reference_id=f"variance:{day}:{expected}:{actual}",
    )
    return BackfillVarianceResponse(
        id=str(entry.id),
        wallet=wallet,
        amount=amount,
        direction=direction,
        date=day,
        remarks=remarks,
        expected_total=expected,
        actual_total=actual,
        difference=difference,
    )
