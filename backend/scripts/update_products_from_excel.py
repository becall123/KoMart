#!/usr/bin/env python3
"""
Update existing products from an Excel workbook.

Stock rule: never write product.stock directly — reconcile via receive_stock / adjust_stock.
Match key: SKU preferred, name fallback (case-insensitive).

Usage (from backend/):
  python scripts/update_products_from_excel.py "../product list.xlsx" --dry-run
  python scripts/update_products_from_excel.py "../product list.xlsx" --confirm
  python scripts/update_products_from_excel.py "../product list.xlsx" --confirm --skip-stock
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import init_db  # noqa: E402
from app.models.inventory import AdjustmentType  # noqa: E402
from app.models.product import Product  # noqa: E402
from app.services.stock import adjust_stock, get_current_stock, receive_stock  # noqa: E402

# Reuse workbook parsing from import script
from scripts.import_products_from_excel import (  # noqa: E402
    _as_float,
    _as_int,
    _parse_workbook,
)


async def _find_product(
    *,
    sku: str,
    name: str,
    match_by: str,
) -> Product | None:
    if match_by == "sku" and sku:
        found = await Product.find_one(Product.sku == sku)
        if found:
            return found
    if name:
        return await Product.find_one(
            {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
        )
    return None


async def update_from_excel(
    file_path: Path,
    *,
    dry_run: bool = False,
    confirm: bool = False,
    skip_stock: bool = False,
    match_by: str = "sku",
    created_by: str = "Excel Update",
) -> list[dict]:
    if not dry_run and not confirm:
        raise SystemExit("Live run requires --confirm (use --dry-run to preview).")

    records = _parse_workbook(file_path)
    await init_db()

    report: list[dict] = []
    updated = skipped = errors = 0

    for rec in records:
        name = rec["name"]
        sku = str(rec.get("sku") or "").strip()
        row = rec.get("_row", "?")

        product = await _find_product(sku=sku, name=name, match_by=match_by)
        if not product:
            report.append({
                "row": row,
                "sku": sku,
                "name": name,
                "status": "skipped",
                "detail": "no matching product",
            })
            skipped += 1
            continue

        cost_price = _as_float(rec.get("cost_price"))
        selling_price = _as_float(rec.get("selling_price"))
        target_qty = _as_int(rec.get("quantity"))

        changes: list[str] = []
        if cost_price is not None and cost_price != product.cost_price:
            changes.append(f"cost {product.cost_price} -> {cost_price}")
        if selling_price is not None and selling_price != product.selling_price:
            changes.append(f"sell {product.selling_price} -> {selling_price}")

        stock_delta: int | None = None
        if target_qty is not None and not skip_stock:
            current_stock = await get_current_stock(str(product.id))
            stock_delta = target_qty - current_stock
            if stock_delta != 0:
                changes.append(f"stock {current_stock} -> {target_qty} (delta {stock_delta:+d})")

        if not changes:
            report.append({
                "row": row,
                "sku": product.sku,
                "name": product.name,
                "status": "unchanged",
                "detail": "",
            })
            skipped += 1
            continue

        if dry_run:
            report.append({
                "row": row,
                "sku": product.sku,
                "name": product.name,
                "status": "would_update",
                "detail": "; ".join(changes),
            })
            updated += 1
            continue

        try:
            product_updates: dict = {"updated_at": datetime.now(timezone.utc)}
            if cost_price is not None:
                product_updates["cost_price"] = cost_price
            if selling_price is not None:
                product_updates["selling_price"] = selling_price
            if len(product_updates) > 1:
                await product.set(product_updates)
                product = await Product.get(str(product.id))
                if not product:
                    raise RuntimeError("product missing after update")

            if stock_delta is not None and stock_delta != 0 and product:
                pid = str(product.id)
                if stock_delta > 0:
                    batch_no = f"XL-RECON-{product.sku}-{datetime.now(timezone.utc):%Y%m%d}"
                    await receive_stock(
                        pid,
                        batch_no,
                        stock_delta,
                        unit_cost=product.cost_price,
                        created_by=created_by,
                    )
                else:
                    await adjust_stock(
                        pid,
                        stock_delta,
                        AdjustmentType.correction,
                        "Stock count correction (Excel reconcile)",
                        created_by,
                    )

            report.append({
                "row": row,
                "sku": product.sku,
                "name": product.name,
                "status": "updated",
                "detail": "; ".join(changes),
            })
            updated += 1
        except Exception as exc:
            report.append({
                "row": row,
                "sku": sku,
                "name": name,
                "status": "error",
                "detail": str(exc),
            })
            errors += 1

    print(f"Updated: {updated} | Skipped/unchanged: {skipped} | Errors: {errors}")
    return report


def _write_report(report: list[dict], out_path: Path) -> None:
    if not report:
        return
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["row", "sku", "name", "status", "detail"])
        writer.writeheader()
        writer.writerows(report)
    print(f"Change report written to {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Update existing products from Excel")
    parser.add_argument("file", type=Path, help="Path to .xlsx workbook")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes only")
    parser.add_argument("--confirm", action="store_true", help="Required for live writes")
    parser.add_argument("--skip-stock", action="store_true", help="Update prices only")
    parser.add_argument(
        "--match-by",
        choices=("sku", "name"),
        default="sku",
        help="Primary match key (SKU with name fallback)",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=None,
        help="CSV path for change report (default: beside workbook)",
    )
    args = parser.parse_args()

    report_path = args.report or args.file.with_suffix(".update-report.csv")
    report = asyncio.run(
        update_from_excel(
            args.file,
            dry_run=args.dry_run,
            confirm=args.confirm,
            skip_stock=args.skip_stock,
            match_by=args.match_by,
        ),
    )
    _write_report(report, report_path)


if __name__ == "__main__":
    main()
