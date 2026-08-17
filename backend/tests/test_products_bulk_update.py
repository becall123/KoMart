"""Product pricing and bulk-update tests."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.database import init_db
from app.models.user import User, UserRole
from app.models.product import Product, ProductStatus, SellMode
from app.auth.jwt import hash_password
from app.services.product_pricing import compute_product_pricing, margin_percent, pack_savings


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.fixture
async def manager_user():
    email = "bulk-manager@komart.com"
    existing = await User.find_one(User.email == email)
    if existing:
        await existing.delete()
    user = User(
        email=email,
        name="Bulk Manager",
        hashed_password=hash_password("managerpass123"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


@pytest.fixture
async def manager_headers(client: AsyncClient, manager_user: User):
    token = await _login(client, manager_user.email, "managerpass123")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def bulk_product(manager_user: User):
    product = Product(
        name="Bulk Test Noodles",
        sku="BULK-TEST-001",
        barcode="BULK-BAR",
        brand="TestBrand",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="",
        supplier_name="",
        cost_price=25.0,
        selling_price=40.0,
        pack_selling_price=900.0,
        units_per_buy_uom=24,
        sell_mode=SellMode.both,
        status=ProductStatus.active,
        is_active=True,
    )
    pricing = compute_product_pricing(product)
    for key, value in pricing.items():
        setattr(product, key, value)
    await product.insert()
    yield product
    await product.delete()


def test_margin_percent():
    assert margin_percent(25.0, 40.0) == 37.5


def test_pack_savings():
    assert pack_savings(40.0, 24, 900.0) == 60.0


def test_compute_product_pricing_discount_percent():
    product = Product(
        name="Disc",
        sku="DISC-001",
        cost_price=10.0,
        selling_price=100.0,
        pack_selling_price=0.0,
        discount_percent=10.0,
    )
    result = compute_product_pricing(product, unit_discount_source="percent")
    assert result["offered_price"] == 90.0
    assert result["discount_percent"] == 10.0


@pytest.mark.asyncio
async def test_bulk_update_products(
    client: AsyncClient,
    manager_headers: dict,
    bulk_product: Product,
):
    resp = await client.post(
        "/api/v1/products/bulk-update",
        json={
            "updates": [
                {
                    "id": str(bulk_product.id),
                    "selling_price": 50.0,
                    "discount_percent": 20.0,
                    "pack_discount_percent": 10.0,
                },
            ],
        },
        headers=manager_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated"] == 1
    assert body["errors"] == []

    refreshed = await Product.get(bulk_product.id)
    assert refreshed.selling_price == 50.0
    assert refreshed.discount_percent == 20.0
    assert refreshed.offered_price == 40.0
    assert refreshed.margin_percent == pytest.approx(50.0, rel=0.01)
    assert refreshed.pack_discount_percent == 10.0


@pytest.mark.asyncio
async def test_bulk_update_not_found(client: AsyncClient, manager_headers: dict):
    resp = await client.post(
        "/api/v1/products/bulk-update",
        json={"updates": [{"id": "000000000000000000000000", "name": "Ghost"}]},
        headers=manager_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated"] == 0
    assert len(body["errors"]) == 1
