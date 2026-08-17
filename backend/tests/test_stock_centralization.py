"""Stock centralization validation tests.

Verifies that inventory_batches is the single source of truth for stock quantity,
and that all API endpoints return synchronized, computed stock values.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.database import init_db
from app.models.user import User, UserRole
from app.models.product import Product, ProductStatus
from app.models.inventory import InventoryBatch, StockAdjustment, AdjustmentType
from app.models.transaction import Transaction, TransactionItem, PaymentMethod
from app.auth.jwt import hash_password
from app.services.stock import get_current_stock, get_current_stock_batch
from app.services.sales import record_sale
from app.services.stock import receive_stock, adjust_stock


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def manager_user():
    email = "stock-mgr@komart.com"
    existing = await User.find_one(User.email == email)
    if existing:
        await existing.delete()
    user = User(
        email=email,
        name="Stock Manager",
        hashed_password=hash_password("mgrpass123"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


@pytest.fixture
async def stock_product(manager_user: User):
    product = Product(
        name="Centralized Stock Product",
        sku="STOCK-CENTRAL-001",
        barcode="STOCK-CENTRAL-BAR",
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=10.0,
        selling_price=20.0,
        low_stock_threshold=5,
        status=ProductStatus.active,
        is_active=True,
    )
    await product.insert()
    yield product
    await product.delete()


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.mark.asyncio
async def test_no_batches_means_zero_stock(stock_product: Product):
    assert await get_current_stock(str(stock_product.id)) == 0


@pytest.mark.asyncio
async def test_receive_stock_increases_batches_only(stock_product: Product):
    await receive_stock(
        str(stock_product.id),
        "BATCH-001",
        10,
        unit_cost=10.0,
        created_by="test",
    )
    assert await get_current_stock(str(stock_product.id)) == 10

    batches = await InventoryBatch.find(
        InventoryBatch.product_id == str(stock_product.id),
    ).to_list()
    assert len(batches) == 1
    assert batches[0].quantity == 10


@pytest.mark.asyncio
async def test_multiple_receives_sum_correctly(stock_product: Product):
    await receive_stock(str(stock_product.id), "B1", 5, unit_cost=10.0, created_by="test")
    await receive_stock(str(stock_product.id), "B2", 3, unit_cost=12.0, created_by="test")
    assert await get_current_stock(str(stock_product.id)) == 8


@pytest.mark.asyncio
async def test_sale_deducts_from_batches(stock_product: Product):
    await receive_stock(str(stock_product.id), "B1", 10, unit_cost=10.0, created_by="test")
    assert await get_current_stock(str(stock_product.id)) == 10

    txn = await record_sale(
        body=_make_sale_body(str(stock_product.id), 3),
        cashier_id="test-cashier",
        apply_loyalty=False,
        skip_server_pricing=True,
    )
    assert await get_current_stock(str(stock_product.id)) == 7


@pytest.mark.asyncio
async def test_void_restores_batches(stock_product: Product):
    await receive_stock(str(stock_product.id), "B1", 10, unit_cost=10.0, created_by="test")
    txn = await record_sale(
        body=_make_sale_body(str(stock_product.id), 4),
        cashier_id="test-cashier",
        apply_loyalty=False,
        skip_server_pricing=True,
    )
    assert await get_current_stock(str(stock_product.id)) == 6

    from app.services.sales import void_sale
    await void_sale(txn.id, "test void", "test-user")
    assert await get_current_stock(str(stock_product.id)) == 10


@pytest.mark.asyncio
async def test_adjust_stock_modifies_batches(stock_product: Product):
    await receive_stock(str(stock_product.id), "B1", 10, unit_cost=10.0, created_by="test")
    await adjust_stock(
        str(stock_product.id),
        -2,
        AdjustmentType.adjustment,
        "test adjust",
        "test-user",
    )
    assert await get_current_stock(str(stock_product.id)) == 8


@pytest.mark.asyncio
async def test_batch_stock_aggregation(stock_product: Product):
    await receive_stock(str(stock_product.id), "B1", 5, unit_cost=10.0, created_by="test")
    await receive_stock(str(stock_product.id), "B2", 7, unit_cost=12.0, created_by="test")

    stock_map = await get_current_stock_batch([str(stock_product.id)])
    assert stock_map[str(stock_product.id)] == 12


@pytest.mark.asyncio
async def test_api_products_returns_computed_stock(client: AsyncClient, manager_user: User, stock_product: Product):
    token = await _login(client, manager_user.email, "mgrpass123")
    await receive_stock(str(stock_product.id), "B1", 5, unit_cost=10.0, created_by="test")

    res = await client.get(
        f"/api/v1/products/{stock_product.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["stock"] == 5


@pytest.mark.asyncio
async def test_api_inventory_returns_computed_stock(client: AsyncClient, manager_user: User, stock_product: Product):
    token = await _login(client, manager_user.email, "mgrpass123")
    await receive_stock(str(stock_product.id), "B1", 7, unit_cost=10.0, created_by="test")

    res = await client.get(
        f"/api/v1/inventory/items/{stock_product.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["stock"] == 7


@pytest.mark.asyncio
async def test_api_catalog_in_stock_matches_batches(client: AsyncClient, manager_user: User, stock_product: Product):
    token = await _login(client, manager_user.email, "mgrpass123")
    await receive_stock(str(stock_product.id), "B1", 3, unit_cost=10.0, created_by="test")

    res = await client.get(
        f"/api/v1/catalog/{stock_product.id}",
    )
    assert res.status_code == 200
    assert res.json()["in_stock"] is True


@pytest.mark.asyncio
async def test_stock_consistency_across_endpoints(client: AsyncClient, manager_user: User, stock_product: Product):
    token = await _login(client, manager_user.email, "mgrpass123")
    await receive_stock(str(stock_product.id), "B1", 4, unit_cost=10.0, created_by="test")
    await receive_stock(str(stock_product.id), "B2", 2, unit_cost=12.0, created_by="test")

    product_res = await client.get(
        f"/api/v1/products/{stock_product.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    inventory_res = await client.get(
        f"/api/v1/inventory/items/{stock_product.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    catalog_res = await client.get(
        f"/api/v1/catalog/{stock_product.id}",
    )

    assert product_res.json()["stock"] == 6
    assert inventory_res.json()["stock"] == 6
    assert catalog_res.json()["in_stock"] is True


def _make_sale_body(product_id: str, qty: int):
    from app.schemas.transaction import TransactionCreate, TransactionItem
    return TransactionCreate(
        items=[
            TransactionItem(
                product_id=product_id,
                name="Test",
                sku="TEST",
                price=20.0,
                quantity=qty,
                discount=0.0,
            )
        ],
        subtotal=20.0 * qty,
        discount=0.0,
        promotion_discount=0.0,
        manual_discount=0.0,
        applied_promotions=[],
        coupon_code="",
        tax=0.0,
        round_off=0.0,
        loyalty_points_redeemed=0,
        total=20.0 * qty,
        payment_method=PaymentMethod.cash,
        created_by="test",
    )
