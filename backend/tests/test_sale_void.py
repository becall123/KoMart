"""Sale void restores stock and excludes transaction from revenue."""

import pytest
from datetime import datetime, timezone

from app.database import init_db
from app.models.inventory import InventoryBatch
from app.models.product import Product
from app.models.transaction import Transaction, TransactionItem, PaymentMethod, TransactionStatus, BatchAllocation
from app.services.sales import void_sale
from app.services.reporting import aggregate_sales_total
from fastapi import HTTPException


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


@pytest.mark.asyncio
async def test_void_sale_restores_stock():
    product = Product(
        name="Void Test Product",
        sku="VOID-001",
        barcode="VOID-001",
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
    batch = InventoryBatch(
        product_id=str(product.id),
        batch_number="VOID-B1",
        quantity=0,
        unit_cost=10.0,
    )
    await batch.insert()
    batch_id = str(batch.id)

    txn = Transaction(
        transaction_number="VOID-TXN-001",
        items=[
            TransactionItem(
                product_id=str(product.id),
                name=product.name,
                sku=product.sku,
                price=20.0,
                quantity=2,
                unit_cost=10.0,
                batch_allocations=[
                    BatchAllocation(batch_id=batch_id, quantity=2, unit_cost=10.0),
                ],
            ),
        ],
        subtotal=40.0,
        tax=0.0,
        total=40.0,
        payment_method=PaymentMethod.cash,
        created_by="Test",
    )
    await txn.insert()

    await void_sale(str(txn.id), "Wrong item rung up", "Manager")
    refreshed_batch = await InventoryBatch.get(batch_id)
    assert refreshed_batch is not None
    assert refreshed_batch.quantity == 2

    refreshed_txn = await Transaction.get(str(txn.id))
    assert refreshed_txn is not None
    assert refreshed_txn.status == TransactionStatus.voided

    with pytest.raises(HTTPException):
        await void_sale(str(txn.id), "Again", "Manager")

    await txn.delete()
    await batch.delete()
    await product.delete()


@pytest.mark.asyncio
async def test_aggregate_sales_total_excludes_voided():
    from datetime import timedelta

    now = datetime(2099, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    completed = Transaction(
        transaction_number="VOID-TXN-C-2099",
        items=[],
        subtotal=100.0,
        tax=0.0,
        total=100.0,
        payment_method=PaymentMethod.cash,
        created_by="Test",
        created_at=now,
        status=TransactionStatus.completed,
    )
    voided = Transaction(
        transaction_number="VOID-TXN-V-2099",
        items=[],
        subtotal=50.0,
        tax=0.0,
        total=50.0,
        payment_method=PaymentMethod.cash,
        created_by="Test",
        created_at=now,
        status=TransactionStatus.voided,
    )
    await completed.insert()
    await voided.insert()

    total = await aggregate_sales_total(now - timedelta(seconds=1), now + timedelta(seconds=1))
    assert total == 100.0

    await completed.delete()
    await voided.delete()
