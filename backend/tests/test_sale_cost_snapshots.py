"""Sale-time cost snapshot and per-batch inventory ledger tests."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.database import init_db
from app.models.user import User, UserRole
from app.models.product import Product, ProductStatus
from app.models.inventory import InventoryBatch, StockAdjustment, AdjustmentType
from app.models.transaction import PaymentMethod
from app.schemas.transaction import TransactionCreate, TransactionItem
from app.auth.jwt import hash_password
from app.services.sales import record_sale
from app.services.reporting import line_cogs
from app.services.stock import receive_stock


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def cashier_user():
    email = "cost-cashier@komart.com"
    existing = await User.find_one(User.email == email)
    if existing:
        await existing.delete()
    user = User(
        email=email,
        name="Cost Cashier",
        hashed_password=hash_password("cashierpass123"),
        role=UserRole.cashier,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


@pytest.fixture
async def cost_product():
    product = Product(
        name="Cost Snapshot Snack",
        sku="COST-SNACK-001",
        barcode="COST-SNACK-BAR",
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=80.0,
        selling_price=120.0,
        low_stock_threshold=5,
        status=ProductStatus.active,
        is_active=True,
    )
    await product.insert()
    yield product
    await product.delete()
    for batch in await InventoryBatch.find(InventoryBatch.product_id == str(product.id)).to_list():
        await batch.delete()
    for adj in await StockAdjustment.find(StockAdjustment.product_id == str(product.id)).to_list():
        await adj.delete()


@pytest.mark.asyncio
async def test_sale_snapshots_batch_cost_on_transaction_and_ledger(
    cost_product: Product,
    cashier_user: User,
):
    product_id = str(cost_product.id)
    await receive_stock(
        product_id,
        "BATCH-COST-001",
        10,
        unit_cost=55.0,
        created_by="Test",
    )

    body = TransactionCreate(
        customer_name="Walk-In",
        items=[
            TransactionItem(
                product_id=product_id,
                name=cost_product.name,
                sku=cost_product.sku,
                price=120.0,
                quantity=3,
            ),
        ],
        subtotal=360.0,
        tax=0.0,
        total=360.0,
        payment_method=PaymentMethod.cash,
        created_by=cashier_user.name,
    )

    result = await record_sale(body, cashier_id=str(cashier_user.id))
    txn_id = result.id

    try:
        assert result.total_cost == pytest.approx(165.0, rel=1e-3)
        assert len(result.items) == 1
        line = result.items[0]
        assert line.unit_cost == pytest.approx(55.0, rel=1e-3)
        assert line.list_price == pytest.approx(120.0, rel=1e-3)
        assert line.category == "Snacks"
        assert len(line.batch_allocations) == 1
        assert line.batch_allocations[0].unit_cost == pytest.approx(55.0, rel=1e-3)

        assert line_cogs(line, cost_product) == pytest.approx(165.0, rel=1e-3)

        sale_adjustments = await StockAdjustment.find(
            StockAdjustment.transaction_id == txn_id,
            StockAdjustment.type == AdjustmentType.sale,
        ).to_list()
        assert len(sale_adjustments) == 1
        adj = sale_adjustments[0]
        assert adj.batch_id is not None
        assert adj.unit_cost == pytest.approx(55.0, rel=1e-3)
        assert adj.extended_cost == pytest.approx(165.0, rel=1e-3)
        assert adj.unit_selling_price == pytest.approx(120.0, rel=1e-3)
        assert adj.quantity == -3
    finally:
        from app.models.transaction import Transaction

        txn = await Transaction.get(txn_id)
        if txn:
            for adj in await StockAdjustment.find(StockAdjustment.transaction_id == txn_id).to_list():
                await adj.delete()
            await txn.delete()


@pytest.mark.asyncio
async def test_po_receive_sets_batch_unit_cost(cost_product: Product):
    product_id = str(cost_product.id)
    batch = await receive_stock(
        product_id,
        "PO-BATCH-001",
        5,
        unit_cost=42.5,
        purchase_order_id="po-test",
        created_by="Receiver",
    )
    receive_adj = None
    try:
        stored = await InventoryBatch.get(batch.id)
        assert stored is not None
        assert stored.unit_cost == pytest.approx(42.5, rel=1e-3)

        receive_adj = await StockAdjustment.find_one(
            StockAdjustment.batch_id == str(batch.id),
            StockAdjustment.type == AdjustmentType.receive,
        )
        assert receive_adj is not None
        assert receive_adj.unit_cost == pytest.approx(42.5, rel=1e-3)
        assert receive_adj.extended_cost == pytest.approx(212.5, rel=1e-3)
    finally:
        await batch.delete()
        if receive_adj:
            await receive_adj.delete()
