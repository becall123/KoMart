"""Inventory movement ledger API tests."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.database import init_db
from app.models.user import User, UserRole
from app.models.product import Product
from app.models.inventory import AdjustmentType, StockAdjustment
from app.auth.jwt import hash_password


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
    email = "ledger-manager@komart.com"
    existing = await User.find_one(User.email == email)
    if existing:
        await existing.delete()
    user = User(
        email=email,
        name="Ledger Manager",
        hashed_password=hash_password("managerpass123"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


@pytest.fixture
async def sample_movement(manager_user: User):
    product = Product(
        name="Ledger Test Product",
        sku="LEDGER-SKU-001",
        barcode="LEDGER-BAR-001",
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=10.0,
        selling_price=20.0,
        is_active=True,
    )
    await product.insert()
    entry = StockAdjustment(
        product_id=str(product.id),
        product_name=product.name,
        product_sku=product.sku,
        type=AdjustmentType.receive,
        quantity=5,
        stock_before=0,
        stock_after=5,
        reason="Test receive",
        created_by=manager_user.name,
        reference_type="receive",
        reference_id="batch-test",
    )
    await entry.insert()
    yield entry, product
    await entry.delete()
    await product.delete()


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.mark.asyncio
async def test_list_movements(client: AsyncClient, manager_user: User, sample_movement):
    entry, _ = sample_movement
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.get(
        "/api/v1/inventory/movements",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    row = next(r for r in body["data"] if r["id"] == str(entry.id))
    assert row["direction"] == "in"
    assert row["product_sku"] == "LEDGER-SKU-001"
    assert row["movement_label"] == "Stock In"


@pytest.mark.asyncio
async def test_movement_summary(client: AsyncClient, manager_user: User, sample_movement):
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.get(
        "/api/v1/inventory/movements/summary",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["movement_count"] >= 1
    assert body["total_in"] >= 5


@pytest.mark.asyncio
async def test_filter_movements_by_direction_out(
    client: AsyncClient,
    manager_user: User,
    sample_movement,
):
    entry, product = sample_movement
    sale = StockAdjustment(
        product_id=str(product.id),
        product_name=product.name,
        product_sku=product.sku,
        type=AdjustmentType.sale,
        quantity=-2,
        stock_before=5,
        stock_after=3,
        reason="Test sale",
        created_by=manager_user.name,
        reference_type="sale",
        reference_id="txn-test",
    )
    await sale.insert()
    try:
        token = await _login(client, manager_user.email, "managerpass123")
        res = await client.get(
            "/api/v1/inventory/movements",
            params={"direction": "out"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        assert all(r["direction"] == "out" for r in res.json()["data"])
    finally:
        await sale.delete()
