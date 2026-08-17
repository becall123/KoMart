"""Discount rules API tests."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.database import init_db
from app.models.user import User, UserRole
from app.models.product import Product, ProductStatus
from app.models.discount_rule import DiscountRule, DiscountRuleType
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
    email = "discount-manager@komart.com"
    existing = await User.find_one(User.email == email)
    if existing:
        await existing.delete()
    user = User(
        email=email,
        name="Discount Manager",
        hashed_password=hash_password("managerpass123"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


@pytest.fixture
async def snack_product(manager_user: User):
    product = Product(
        name="Discount Snack",
        sku="DISC-SNACK-001",
        barcode="DISC-SNACK-BAR",
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=50.0,
        selling_price=100.0,
        status=ProductStatus.active,
        is_active=True,
    )
    await product.insert()
    yield product
    await product.delete()


@pytest.fixture
async def category_rule(manager_user: User):
    rule = DiscountRule(
        name="Snacks 10% Off",
        rule_type=DiscountRuleType.category_percent,
        value=10,
        category="Snacks",
        is_active=True,
        priority=10,
    )
    await rule.insert()
    yield rule
    await rule.delete()


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.mark.asyncio
async def test_create_discount_rule(
    client: AsyncClient,
    manager_user: User,
    snack_product: Product,
):
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.post(
        "/api/v1/discounts",
        json={
            "name": "Snack Deal",
            "rule_type": "product_percent",
            "value": 15,
            "product_ids": [str(snack_product.id)],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["rule_type"] == "product_percent"
    assert body["value"] == 15
    created = await DiscountRule.get(body["id"])
    if created:
        await created.delete()


@pytest.mark.asyncio
async def test_evaluate_category_percent(
    client: AsyncClient,
    manager_user: User,
    snack_product: Product,
    category_rule: DiscountRule,
):
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.post(
        "/api/v1/discounts/evaluate",
        json={
            "items": [
                {
                    "product_id": str(snack_product.id),
                    "price": 100,
                    "quantity": 2,
                    "category": "Snacks",
                }
            ],
            "coupon_code": "",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["line_discount_total"] == 20
    assert body["promotion_discount_total"] == 20
    assert len(body["applied_promotions"]) == 1


@pytest.mark.asyncio
async def test_coupon_code_required(
    client: AsyncClient,
    manager_user: User,
    snack_product: Product,
):
    rule = DiscountRule(
        name="Coupon 50 Off",
        code="SAVE50",
        rule_type=DiscountRuleType.cart_flat,
        value=50,
        is_active=True,
    )
    await rule.insert()
    token = await _login(client, manager_user.email, "managerpass123")
    try:
        without = await client.post(
            "/api/v1/discounts/evaluate",
            json={
                "items": [
                    {
                        "product_id": str(snack_product.id),
                        "price": 100,
                        "quantity": 1,
                        "category": "Snacks",
                    }
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert without.json()["cart_discount"] == 0

        with_code = await client.post(
            "/api/v1/discounts/evaluate",
            json={
                "items": [
                    {
                        "product_id": str(snack_product.id),
                        "price": 100,
                        "quantity": 1,
                        "category": "Snacks",
                    }
                ],
                "coupon_code": "SAVE50",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert with_code.json()["cart_discount"] == 50
    finally:
        await rule.delete()
