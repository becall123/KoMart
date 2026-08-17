"""Inventory list exposes buy/base UOM fields for UI."""

from __future__ import annotations

import uuid

import pytest

from app.database import init_db
from app.models.product import Product
from app.routers.inventory import _item_response


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


@pytest.mark.asyncio
async def test_item_response_includes_buy_and_base_uom_fields():
    sku = f"INV-UOM-{uuid.uuid4().hex[:6]}"
    product = Product(
        name="UOM Inventory Product",
        sku=sku,
        barcode=sku,
        brand="T",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="",
        supplier_name="",
        buy_uom="pack",
        uom="pcs",
        units_per_buy_uom=12,
        cost_price=10.0,
        selling_price=25.0,
        is_active=True,
    )
    await product.insert()

    response = await _item_response(product, [])
    assert response.uom == "pcs"
    assert response.buy_uom == "pack"
    assert response.units_per_buy_uom == 12

    await product.delete()
