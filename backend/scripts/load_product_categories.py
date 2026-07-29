#!/usr/bin/env python3
"""
Load KoMart product categories (SKU prefixes 01–11) into MongoDB.

Idempotent:
  - Existing row with same code → update name + description (if changed)
  - Existing row with same name but different code → skip (name is unique)
  - Otherwise → insert

Usage (from backend/):
  python scripts/load_product_categories.py
  python scripts/load_product_categories.py --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import init_db  # noqa: E402
from app.models.category import Category  # noqa: E402

# code, name, description ("why it matters")
PRODUCT_CATEGORIES: list[tuple[str, str, str]] = [
    ("01", "Instant Noodles", "Your core catalog (Shin, Buldak, cups)"),
    ("02", "Snacks", "Chips, crackers, imported snacks"),
    ("03", "Confectionery", "Candy, chocolate, biscuits"),
    ("04", "Beverages", "Soft drinks, tea, coffee drinks"),
    ("05", "Sauces & Condiments", "Gochujang, soy, mayo, sauces"),
    ("06", "Rice & Grains", "Rice bags, flour, pasta"),
    ("07", "Canned & Dry Goods", "Canned fish, beans, shelf staples"),
    ("08", "Frozen Foods", "Dumplings, ice cream, frozen meals"),
    ("09", "Personal Care", "Soap, shampoo, toothpaste"),
    ("10", "Household / Kitchen", "Tissue, detergent, utensils"),
    ("11", "Health & Wellness", "Supplements, OTC basics"),
]


async def load_categories(*, dry_run: bool) -> None:
    await init_db()
    print("Connected to MongoDB.")
    if dry_run:
        print("Dry run — no writes.\n")

    created = updated = skipped = 0
    now = datetime.now(timezone.utc)

    for code, name, description in PRODUCT_CATEGORIES:
        by_code = await Category.find_one(Category.code == code)
        by_name = await Category.find_one(Category.name == name)

        if by_code:
            changes: dict = {}
            if by_code.name != name:
                if by_name and str(by_name.id) != str(by_code.id):
                    print(f"  SKIP  {code} — name '{name}' already used by another category")
                    skipped += 1
                    continue
                changes["name"] = name
            if (by_code.description or "") != description:
                changes["description"] = description
            if not changes:
                print(f"  OK    {code} {name} (unchanged)")
                skipped += 1
                continue
            print(f"  UPD   {code} {name} ({', '.join(changes.keys())})")
            if not dry_run:
                changes["updated_at"] = now
                await by_code.set(changes)
            updated += 1
            continue

        if by_name:
            print(
                f"  SKIP  {code} {name} — name exists with code "
                f"'{getattr(by_name, 'code', '') or '(empty)'}'"
            )
            skipped += 1
            continue

        print(f"  NEW   {code} {name}")
        if not dry_run:
            await Category(
                name=name,
                description=description,
                code=code,
                next_sku_seq=1,
                is_active=True,
            ).insert()
        created += 1

    print(
        f"\nDone. created={created} updated={updated} skipped={skipped}"
        + (" (dry-run)" if dry_run else "")
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Load product categories into MongoDB")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print actions without writing to the database",
    )
    args = parser.parse_args()
    asyncio.run(load_categories(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
