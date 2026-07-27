"""SKU generation — 6-digit CCNNNN allocated per category on the server."""

from __future__ import annotations

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from app.models.category import Category
from app.models.product import Product


async def _max_seq_for_code(code: str) -> int:
    """Highest 4-digit product sequence already used for this category code."""
    prefix = code
    rows = await Product.get_motor_collection().find(
        {"sku": {"$regex": f"^{prefix}\\d{{4}}$"}},
        {"sku": 1},
    ).to_list(length=10_000)
    max_seq = 0
    for row in rows:
        sku = str(row.get("sku") or "")
        if len(sku) == 6 and sku[:2] == prefix and sku[2:].isdigit():
            max_seq = max(max_seq, int(sku[2:]))
    return max_seq


async def allocate_sku_for_category(
    category_name: str,
    *,
    exclude: set[str] | None = None,
    max_attempts: int = 25,
) -> str:
    """Atomically allocate next SKU for a category: CC + NNNN."""
    category, code = await _resolve_category_for_sku(category_name)
    name = (category_name or "").strip()

    exclude_lower = {value.lower() for value in (exclude or set()) if value}
    col = Category.get_motor_collection()

    for _ in range(max_attempts):
        updated = await col.find_one_and_update(
            {"_id": category.id},
            {"$inc": {"next_sku_seq": 1}},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Category not found")

        seq = int(updated.get("next_sku_seq", 1)) - 1  # value after inc is next free; use previous
        if seq < 1:
            seq = 1
        if seq > 9999:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Category '{name}' has reached the maximum of 9999 products",
            )

        candidate = f"{code}{seq:04d}"
        key = candidate.lower()
        if key in exclude_lower:
            continue
        if await Product.find_one(Product.sku == candidate):
            continue
        return candidate

    raise HTTPException(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Could not generate a unique SKU",
    )


async def generate_unique_sku(
    brand: str,
    category: str,
    *,
    exclude: set[str] | None = None,
    max_attempts: int = 25,
) -> str:
    """Allocate a 6-digit SKU for the given category name. Brand is ignored."""
    _ = brand
    return await allocate_sku_for_category(
        category,
        exclude=exclude,
        max_attempts=max_attempts,
    )


async def _resolve_category_for_sku(category_name: str) -> tuple[Category, str]:
    """Return (category, 2-digit code) or raise HTTPException."""
    name = (category_name or "").strip()
    if not name:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Category is required to generate SKU",
        )

    category = await Category.find_one(Category.name == name, Category.is_active == True)  # noqa: E712
    if not category:
        category = await Category.find_one(Category.name == name)
    if not category:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Category '{name}' not found — create it in Settings with a 2-digit code",
        )

    code = (getattr(category, "code", None) or "").strip()
    if len(code) != 2 or not code.isdigit():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Category '{name}' has no valid 2-digit code — set it in Settings",
        )
    return category, code


async def peek_sku_for_category(
    category_name: str,
    *,
    exclude: set[str] | None = None,
    start_seq: int | None = None,
    max_attempts: int = 50,
) -> tuple[str, int]:
    """
    Suggest next SKU without incrementing next_sku_seq.

    Returns (sku, next_seq_to_try) so callers can peek multiple without gaps in the preview list.
    Allocation still happens only on create via allocate_sku_for_category.
    """
    category, code = await _resolve_category_for_sku(category_name)
    exclude_lower = {value.lower() for value in (exclude or set()) if value}

    if start_seq is None:
        seq = int(getattr(category, "next_sku_seq", 1) or 1)
    else:
        seq = start_seq
    if seq < 1:
        seq = 1

    for _ in range(max_attempts):
        if seq > 9999:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Category '{category_name}' has reached the maximum of 9999 products",
            )
        candidate = f"{code}{seq:04d}"
        seq += 1
        if candidate.lower() in exclude_lower:
            continue
        if await Product.find_one(Product.sku == candidate):
            continue
        return candidate, seq

    raise HTTPException(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Could not generate a unique SKU",
    )


async def peek_unique_sku(
    brand: str,
    category: str,
    *,
    exclude: set[str] | None = None,
    start_seq: int | None = None,
) -> tuple[str, int]:
    """Dry-run SKU suggestion. Brand is ignored."""
    _ = brand
    return await peek_sku_for_category(
        category,
        exclude=exclude,
        start_seq=start_seq,
    )


async def backfill_category_sku_codes() -> None:
    """Assign missing category codes and seed next_sku_seq from existing products."""
    categories = await Category.find_all().sort("+name").to_list()
    used_codes = {
        (c.code or "").strip()
        for c in categories
        if (c.code or "").strip() and len((c.code or "").strip()) == 2
    }

    next_num = 1
    for cat in categories:
        code = (getattr(cat, "code", None) or "").strip()
        if len(code) == 2 and code.isdigit():
            max_seq = await _max_seq_for_code(code)
            desired_next = max(max_seq + 1, int(getattr(cat, "next_sku_seq", 1) or 1))
            if desired_next != cat.next_sku_seq:
                await cat.set({"next_sku_seq": desired_next})
            continue

        while next_num <= 99:
            candidate = f"{next_num:02d}"
            next_num += 1
            if candidate not in used_codes:
                used_codes.add(candidate)
                max_seq = await _max_seq_for_code(candidate)
                await cat.set({
                    "code": candidate,
                    "next_sku_seq": max(max_seq + 1, 1),
                })
                break
        else:
            # No free 2-digit codes left — leave without code
            pass
