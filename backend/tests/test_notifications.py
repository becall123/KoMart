"""Notifications API tests."""

from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.database import init_db
from app.models.user import User, UserRole
from app.models.product import Product, ProductStatus
from app.models.inventory import InventoryBatch
from app.models.notification import Notification, NotificationType
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
    email = "notif-manager@komart.com"
    existing = await User.find_one(User.email == email)
    if existing:
        await existing.delete()
    user = User(
        email=email,
        name="Notif Manager",
        hashed_password=hash_password("managerpass123"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


@pytest.fixture
async def low_stock_product(manager_user: User):
    product = Product(
        name="Low Stock Snack",
        sku="LOW-STOCK-001",
        barcode="LOW-STOCK-BAR",
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=50.0,
        selling_price=100.0,
        low_stock_threshold=10,
        status=ProductStatus.active,
        is_active=True,
    )
    await product.insert()
    batch = InventoryBatch(
        product_id=str(product.id),
        batch_number="TEST-BATCH-001",
        quantity=3,
        unit_cost=50.0,
        received_at=datetime.now(timezone.utc),
    )
    await batch.insert()
    yield product
    await batch.delete()
    await product.delete()


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.mark.asyncio
async def test_list_notifications_syncs_low_stock_alert(
    client: AsyncClient,
    manager_user: User,
    low_stock_product: Product,
):
    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.get(
        "/api/v1/notifications",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert any(
        n["type"] == "low_stock" and "Low Stock Snack" in n["message"]
        for n in body
    )


@pytest.mark.asyncio
async def test_mark_read_and_mark_all(
    client: AsyncClient,
    manager_user: User,
):
    n1 = await Notification(
        type=NotificationType.system,
        title="Test 1",
        message="Unread",
        read=False,
    ).insert()
    n2 = await Notification(
        type=NotificationType.system,
        title="Test 2",
        message="Unread",
        read=False,
    ).insert()

    token = await _login(client, manager_user.email, "managerpass123")

    mark_one = await client.patch(
        f"/api/v1/notifications/{n1.id}/read",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert mark_one.status_code == 200

    refreshed = await Notification.get(n1.id)
    assert refreshed is not None
    assert refreshed.read is True

    mark_all = await client.patch(
        "/api/v1/notifications/read-all",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert mark_all.status_code == 200

    still_unread = await Notification.find(Notification.read == False).count()
    assert still_unread == 0

    await n1.delete()
    await n2.delete()


@pytest.mark.asyncio
async def test_filter_unread_notifications(
    client: AsyncClient,
    manager_user: User,
):
    read_n = await Notification(
        type=NotificationType.system,
        title="Read",
        message="Done",
        read=True,
    ).insert()
    unread_n = await Notification(
        type=NotificationType.system,
        title="Unread",
        message="Pending",
        read=False,
    ).insert()

    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.get(
        "/api/v1/notifications",
        params={"unreadOnly": True, "sync": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["title"] == "Unread"

    await read_n.delete()
    await unread_n.delete()
