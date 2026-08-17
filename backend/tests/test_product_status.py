"""Product status API tests."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.database import init_db
from app.models.user import User, UserRole
from app.models.product import Product, ProductStatus
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
    email = "status-manager@komart.com"
    existing = await User.find_one(User.email == email)
    if existing:
        await existing.delete()
    user = User(
        email=email,
        name="Status Manager",
        hashed_password=hash_password("managerpass123"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


@pytest.fixture
async def status_products(manager_user: User):
    products = [
        Product(
            name="Active Item",
            sku="STATUS-ACTIVE-001",
            barcode="STATUS-ACTIVE-BAR",
            brand="Test",
            country_of_origin="Nepal",
            category="Snacks",
            supplier_id="sup-1",
            supplier_name="Supplier",
            cost_price=10.0,
            selling_price=20.0,
            status=ProductStatus.active,
            is_active=True,
        ),
        Product(
            name="Seasonal Item",
            sku="STATUS-SEASONAL-001",
            barcode="STATUS-SEASONAL-BAR",
            brand="Test",
            country_of_origin="Nepal",
            category="Snacks",
            supplier_id="sup-1",
            supplier_name="Supplier",
            cost_price=10.0,
            selling_price=20.0,
            status=ProductStatus.seasonal,
            is_active=True,
        ),
        Product(
            name="Discontinued Item",
            sku="STATUS-DISC-001",
            barcode="STATUS-DISC-BAR",
            brand="Test",
            country_of_origin="Nepal",
            category="Snacks",
            supplier_id="sup-1",
            supplier_name="Supplier",
            cost_price=10.0,
            selling_price=20.0,
            status=ProductStatus.discontinued,
            is_active=True,
        ),
    ]
    for product in products:
        await product.insert()
    yield products
    for product in products:
        await product.delete()


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.mark.asyncio
async def test_list_products_includes_status(
    client: AsyncClient,
    manager_user: User,
    status_products: list[Product],
):
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.get(
        "/api/v1/products",
        params={"page_size": 100, "search": "STATUS-"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    by_sku = {row["sku"]: row for row in body["data"]}
    assert by_sku["STATUS-ACTIVE-001"]["status"] == "active"
    assert by_sku["STATUS-SEASONAL-001"]["status"] == "seasonal"
    assert by_sku["STATUS-DISC-001"]["status"] == "discontinued"


@pytest.mark.asyncio
async def test_sellable_only_includes_legacy_products_without_status(
    client: AsyncClient,
    manager_user: User,
):
    """Products seeded before status existed have no status field — still sellable."""
    legacy = Product(
        name="Legacy No Status",
        sku="STATUS-LEGACY-001",
        barcode="STATUS-LEGACY-BAR",
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=10.0,
        selling_price=20.0,
        is_active=True,
    )
    await legacy.insert()
    # Simulate pre-migration document: remove status from MongoDB only.
    await Product.get_motor_collection().update_one(
        {"_id": legacy.id},
        {"$unset": {"status": ""}},
    )
    try:
        token = await _login(client, manager_user.email, "managerpass123")
        res = await client.get(
            "/api/v1/products",
            params={"sellable_only": True, "search": "Legacy No Status"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        skus = {row["sku"] for row in res.json()["data"]}
        assert "STATUS-LEGACY-001" in skus
    finally:
        await legacy.delete()


@pytest.mark.asyncio
async def test_sellable_only_excludes_discontinued(
    client: AsyncClient,
    manager_user: User,
    status_products: list[Product],
):
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.get(
        "/api/v1/products",
        params={"sellable_only": True, "page_size": 100, "search": "STATUS-"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    skus = {row["sku"] for row in res.json()["data"]}
    assert "STATUS-ACTIVE-001" in skus
    assert "STATUS-SEASONAL-001" in skus
    assert "STATUS-DISC-001" not in skus


@pytest.mark.asyncio
async def test_filter_products_by_status(
    client: AsyncClient,
    manager_user: User,
    status_products: list[Product],
):
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.get(
        "/api/v1/products",
        params={"status": "discontinued", "search": "Discontinued Item"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    assert all(row["status"] == "discontinued" for row in body["data"])


@pytest.mark.asyncio
async def test_update_product_status(
    client: AsyncClient,
    manager_user: User,
    status_products: list[Product],
):
    product = status_products[0]
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.patch(
        f"/api/v1/products/{product.id}",
        json={"status": "seasonal"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "seasonal"


@pytest.mark.asyncio
async def test_sale_rejects_discontinued_product(
    client: AsyncClient,
    manager_user: User,
    status_products: list[Product],
):
    discontinued = next(p for p in status_products if p.status == ProductStatus.discontinued)
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.post(
        "/api/v1/transactions",
        json={
            "customer_id": "",
            "customer_name": "Walk-in",
            "items": [
                {
                    "product_id": str(discontinued.id),
                    "name": discontinued.name,
                    "sku": discontinued.sku,
                    "quantity": 1,
                    "price": discontinued.selling_price,
                    "discount": 0,
                }
            ],
            "subtotal": discontinued.selling_price,
            "discount": 0,
            "tax": 0,
            "loyalty_points_redeemed": 0,
            "total": discontinued.selling_price,
            "payment_method": "cash",
            "created_by": manager_user.name,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert "discontinued" in res.json()["detail"].lower()
