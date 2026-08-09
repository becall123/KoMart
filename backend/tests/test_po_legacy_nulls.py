"""Regression: legacy null PO fields must not 500 list or KPI payables."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.jwt import hash_password
from app.database import init_db
from app.main import app
from app.models.purchase_order import PurchaseOrder
from app.models.user import User, UserRole
from app.services.dashboard_kpi import total_payables


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
    email = f"po-legacy-{uuid.uuid4().hex[:8]}@komart.com"
    user = User(
        email=email,
        name="PO Legacy Tester",
        hashed_password=hash_password("managerpass123"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


async def _insert_legacy_po(*, order_number: str, total_amount: float = 1000.0) -> str:
    """Insert a raw Mongo doc with nulls that used to break Beanie validation."""
    col = PurchaseOrder.get_motor_collection()
    now = datetime.now(timezone.utc)
    doc = {
        "order_number": order_number,
        "supplier_id": "sup-legacy",
        "supplier_name": "Legacy Supplier",
        "status": "ordered",
        "items": [
            {
                "product_id": "prod-legacy",
                "product_name": "Legacy Item",
                "quantity": 10,
                "unit_cost": 100.0,
                "received_quantity": None,
                "order_uom": None,
                "base_uom": None,
                "units_per_buy_uom": None,
            }
        ],
        "total_amount": total_amount,
        "amount_paid": None,
        "payment_status": "not-a-real-status",
        "payments": None,
        "expected_delivery": None,
        "ordered_by": "Tester",
        "received_by": None,
        "received_date": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await col.insert_one(doc)
    return str(result.inserted_id)


@pytest.mark.asyncio
async def test_list_purchase_orders_tolerates_legacy_null_fields(
    client: AsyncClient,
    manager_user: User,
):
    order_number = f"PO-LEGACY-{uuid.uuid4().hex[:6].upper()}"
    po_id = await _insert_legacy_po(order_number=order_number, total_amount=1500.0)
    try:
        token = await _login(client, manager_user.email, "managerpass123")
        res = await client.get(
            "/api/v1/purchase-orders",
            params={"search": "", "page": 1, "page_size": 10},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert "data" in body
        match = next((row for row in body["data"] if row.get("id") == po_id), None)
        assert match is not None
        assert match.get("order_number") == order_number or match.get("orderNumber") == order_number
        amount_paid = match.get("amount_paid", match.get("amountPaid"))
        assert amount_paid == 0.0
        payment_status = match.get("payment_status", match.get("paymentStatus"))
        assert payment_status in ("unpaid", "partial", "paid")
        payments = match.get("payments") or []
        assert payments == []
        items = match.get("items") or []
        assert items
        item0 = items[0]
        assert item0.get("units_per_buy_uom", item0.get("unitsPerBuyUom")) == 1
        assert item0.get("received_quantity", item0.get("receivedQuantity")) == 0
    finally:
        await PurchaseOrder.get_motor_collection().delete_one({"order_number": order_number})


@pytest.mark.asyncio
async def test_total_payables_uses_aggregation_with_null_amount_paid():
    order_number = f"PO-PAY-{uuid.uuid4().hex[:6].upper()}"
    cancelled = f"PO-CAN-{uuid.uuid4().hex[:6].upper()}"
    clean_number = f"PO-CLEAN-{uuid.uuid4().hex[:6].upper()}"
    col = PurchaseOrder.get_motor_collection()
    before = await total_payables()
    await _insert_legacy_po(order_number=order_number, total_amount=250.0)
    await col.insert_one(
        {
            "order_number": cancelled,
            "supplier_id": "sup-legacy",
            "supplier_name": "Legacy Supplier",
            "status": "cancelled",
            "items": [],
            "total_amount": 999.0,
            "amount_paid": None,
            "payment_status": None,
            "payments": None,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
    )
    clean = PurchaseOrder(
        order_number=clean_number,
        supplier_id="sup",
        supplier_name="Clean",
        status="ordered",
        items=[],
        total_amount=100.0,
        amount_paid=40.0,
        payment_status="partial",
    )
    await clean.insert()
    try:
        after = await total_payables()
        # Legacy 250 (null paid) + clean remaining 60; cancelled 999 excluded
        assert after == round(before + 250.0 + 60.0, 2)
    finally:
        await col.delete_many(
            {"order_number": {"$in": [order_number, cancelled, clean_number]}}
        )


@pytest.mark.asyncio
async def test_beanie_loads_legacy_null_po_document():
    order_number = f"PO-LOAD-{uuid.uuid4().hex[:6].upper()}"
    po_id = await _insert_legacy_po(order_number=order_number, total_amount=80.0)
    try:
        po = await PurchaseOrder.get(po_id)
        assert po is not None
        assert po.amount_paid == 0.0
        assert po.payments == []
        assert po.items[0].units_per_buy_uom == 1
        assert po.items[0].received_quantity == 0
        assert po.items[0].order_uom == "pcs"
    finally:
        await PurchaseOrder.get_motor_collection().delete_one({"order_number": order_number})
