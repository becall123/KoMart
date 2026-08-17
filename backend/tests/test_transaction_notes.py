"""Transaction notes field round-trip on sale create."""

import pytest

from app.database import init_db
from app.models.product import Product, ProductStatus
from app.models.transaction import PaymentMethod
from app.schemas.transaction import TransactionCreate, TransactionItem
from app.services.sales import record_sale
from app.services.stock import receive_stock


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


@pytest.mark.asyncio
async def test_sale_notes_round_trip():
    product = Product(
        name="Notes Test Product",
        sku="NOTES-001",
        barcode="NOTES-001",
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=10.0,
        selling_price=25.0,
        low_stock_threshold=1,
        status=ProductStatus.active,
        is_active=True,
    )
    await product.insert()
    product_id = str(product.id)

    await receive_stock(product_id, "NOTES-B1", 5, unit_cost=10.0, created_by="Test")

    notes = "Birthday gift wrap requested"
    body = TransactionCreate(
        customer_name="Walk-In",
        items=[
            TransactionItem(
                product_id=product_id,
                name=product.name,
                sku=product.sku,
                price=25.0,
                quantity=1,
            ),
        ],
        subtotal=25.0,
        tax=0.0,
        total=25.0,
        payment_method=PaymentMethod.cash,
        created_by="Cashier",
        notes=notes,
    )

    result = await record_sale(body)
    assert result.notes == notes

    from app.models.transaction import Transaction

    txn = await Transaction.get(result.id)
    assert txn is not None
    assert txn.notes == notes

    await txn.delete()
    await product.delete()
