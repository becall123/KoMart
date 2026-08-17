"""Reporting aggregation and batch-loading tests."""

import pytest
from datetime import datetime, timezone, timedelta

from app.database import init_db
from app.models.product import Product
from app.models.inventory import InventoryBatch
from app.models.transaction import Transaction, PaymentMethod, TransactionItem
from app.services.reporting import (
    aggregate_product_inventory_stats,
    aggregate_batch_inventory_value,
    aggregate_sales_by_day,
    aggregate_sales_total,
    build_product_cache,
)


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


@pytest.fixture
async def sample_products():
    created: list[Product] = []
    for idx in range(3):
        product = Product(
            name=f"Perf Product {idx}",
            sku=f"PERF-SKU-{idx}",
            barcode=f"PERF-BAR-{idx}",
            brand="Test",
            country_of_origin="Nepal",
            category="Snacks",
            supplier_id="sup-1",
            supplier_name="Supplier",
            cost_price=10.0,
            selling_price=20.0,
            low_stock_threshold=1,
            is_active=True,
        )
        await product.insert()
        created.append(product)
    yield created
    for product in created:
        await product.delete()


@pytest.mark.asyncio
async def test_build_product_cache_single_query(sample_products: list[Product]):
    ids = {str(p.id) for p in sample_products}
    cache = await build_product_cache(ids)
    assert len(cache) == 3
    assert all(str(pid) in cache for pid in ids)


@pytest.mark.asyncio
async def test_aggregate_product_inventory_stats(sample_products: list[Product]):
    stats = await aggregate_product_inventory_stats()
    assert stats["total_products"] >= 3
    assert stats["out_of_stock"] >= 1
    assert stats["inventory_value"] >= 0


@pytest.mark.asyncio
async def test_aggregate_batch_inventory_value_weighted():
    product = Product(
        name="Batch Val Product",
        sku="BVAL-001",
        barcode="BVAL-001",
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=100.0,
        selling_price=150.0,
        low_stock_threshold=1,
        is_active=True,
    )
    await product.insert()
    pid = str(product.id)
    await InventoryBatch(
        product_id=pid,
        batch_number="B1",
        quantity=100,
        unit_cost=165.0,
    ).insert()
    await InventoryBatch(
        product_id=pid,
        batch_number="B2",
        quantity=50,
        unit_cost=170.0,
    ).insert()

    value = await aggregate_batch_inventory_value()
    assert value >= 100 * 165 + 50 * 170

    await product.delete()
    for batch in await InventoryBatch.find(InventoryBatch.product_id == pid).to_list():
        await batch.delete()


@pytest.mark.asyncio
async def test_aggregate_sales_total(sample_products: list[Product]):
    now = datetime.now(timezone.utc)
    txn = Transaction(
        transaction_number=f"PERF-TXN-{int(now.timestamp())}",
        items=[
            TransactionItem(
                product_id=str(sample_products[0].id),
                name=sample_products[0].name,
                sku=sample_products[0].sku,
                price=20.0,
                quantity=1,
            ),
        ],
        subtotal=20.0,
        tax=2.6,
        total=22.6,
        payment_method=PaymentMethod.cash,
        created_by="Perf Test",
        created_at=now,
    )
    await txn.insert()
    try:
        total = await aggregate_sales_total(now - timedelta(hours=1))
        assert total >= 22.6
        daily = await aggregate_sales_by_day(now - timedelta(days=1), now + timedelta(hours=1))
        assert sum(daily.values()) >= 22.6
    finally:
        await txn.delete()
