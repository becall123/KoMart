"""PO receive syncs product cost_price like manual inventory receive."""

import uuid

import pytest

from app.database import init_db
from app.models.product import Product
from app.services.inventory_sync import apply_receive_product_updates
from app.services.reporting import aggregate_product_inventory_stats
from app.services.stock import get_current_stock, receive_stock


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


@pytest.mark.asyncio
async def test_apply_receive_product_updates_cost_price():
    sku = f"PO-SYNC-{uuid.uuid4().hex[:8]}"
    product = Product(
        name="PO Sync Product",
        sku=sku,
        barcode=sku,
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=100.0,
        selling_price=150.0,
        low_stock_threshold=2,
        is_active=True,
    )
    await product.insert()

    updated, price_changed = await apply_receive_product_updates(
        product,
        unit_cost=120.0,
    )
    assert price_changed is True
    assert updated.cost_price == 120.0
    assert updated.selling_price == 150.0

    await receive_stock(
        str(product.id),
        "PO-TEST-001",
        5,
        unit_cost=120.0,
        created_by="Test",
    )
    refreshed = await Product.get(str(product.id))
    assert refreshed is not None
    assert await get_current_stock(str(product.id)) == 5
    assert refreshed.cost_price == 120.0

    stats = await aggregate_product_inventory_stats()
    assert stats["inventory_value"] >= 5 * refreshed.cost_price

    await product.delete()
