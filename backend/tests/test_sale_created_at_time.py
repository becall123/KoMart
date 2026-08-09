"""Sale created_at must keep Nepal wall-clock time for date-only sale_date."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.jwt import hash_password
from app.database import init_db
from app.main import app
from app.models.inventory import InventoryBatch, StockAdjustment
from app.models.product import Product, ProductStatus
from app.models.transaction import PaymentMethod, Transaction
from app.models.user import User, UserRole
from app.schemas.transaction import TransactionCreate, TransactionItem
from app.services.sales import record_sale
from app.services.stock import receive_stock
from app.services.time_nepal import NPT, resolve_sale_created_at


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
    email = f"sale-time-{uuid.uuid4().hex[:8]}@komart.com"
    user = User(
        email=email,
        name="Sale Time Cashier",
        hashed_password=hash_password("cashierpass123"),
        role=UserRole.cashier,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


@pytest.fixture
async def timed_product():
    sku = f"TIME-{uuid.uuid4().hex[:6]}"
    product = Product(
        name="Timed Snack",
        sku=sku,
        barcode=sku,
        brand="Test",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="sup-1",
        supplier_name="Supplier",
        cost_price=50.0,
        selling_price=100.0,
        stock=0,
        low_stock_threshold=5,
        status=ProductStatus.active,
        is_active=True,
    )
    await product.insert()
    await receive_stock(str(product.id), f"BATCH-{sku}", 20, unit_cost=50.0)
    yield product
    for batch in await InventoryBatch.find(InventoryBatch.product_id == str(product.id)).to_list():
        await batch.delete()
    for adj in await StockAdjustment.find(StockAdjustment.product_id == str(product.id)).to_list():
        await adj.delete()
    await product.delete()


def test_resolve_sale_created_at_date_only_keeps_npt_clock():
    before = datetime.now(NPT)
    created = resolve_sale_created_at("2026-08-09")
    after = datetime.now(NPT)

    assert created.tzinfo is not None
    assert created.utcoffset() == timezone.utc.utcoffset(created)

    local = created.astimezone(NPT)
    assert local.date().isoformat() == "2026-08-09"
    # Not midnight UTC payload — wall clock should be near "now" in NPT
    assert not (local.hour == 0 and local.minute == 0 and local.second == 0)
    assert before.replace(microsecond=0) <= local.replace(microsecond=0) <= after.replace(microsecond=0)


def test_resolve_sale_created_at_none_is_now_utc():
    before = datetime.now(timezone.utc)
    created = resolve_sale_created_at(None)
    after = datetime.now(timezone.utc)
    assert before <= created <= after


@pytest.mark.asyncio
async def test_record_sale_date_only_preserves_non_midnight_time(
    timed_product: Product,
    cashier_user: User,
):
    body = TransactionCreate(
        customer_name="Walk-In",
        items=[
            TransactionItem(
                product_id=str(timed_product.id),
                name=timed_product.name,
                sku=timed_product.sku,
                price=100.0,
                quantity=1,
                discount=0.0,
            )
        ],
        subtotal=100.0,
        tax=0.0,
        total=100.0,
        payment_method=PaymentMethod.cash,
        created_by=cashier_user.name,
        sale_date="2026-08-09",
    )
    result = await record_sale(body, cashier_id=str(cashier_user.id))
    try:
        created = datetime.fromisoformat(result.created_at.replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        local = created.astimezone(NPT)
        assert local.date().isoformat() == "2026-08-09"
        assert local.hour != 0 or local.minute != 0 or local.second != 0
    finally:
        txn = await Transaction.get(result.id)
        if txn:
            for adj in await StockAdjustment.find(StockAdjustment.transaction_id == result.id).to_list():
                await adj.delete()
            await txn.delete()


@pytest.mark.asyncio
async def test_list_transactions_newest_first(
    client: AsyncClient,
    timed_product: Product,
    cashier_user: User,
):
    async def _login() -> str:
        res = await client.post(
            "/api/v1/auth/login",
            json={"email": cashier_user.email, "password": "cashierpass123"},
        )
        assert res.status_code == 200
        return res.json()["access_token"]

    ids: list[str] = []
    try:
        for _ in range(2):
            body = TransactionCreate(
                customer_name="Walk-In",
                items=[
                    TransactionItem(
                        product_id=str(timed_product.id),
                        name=timed_product.name,
                        sku=timed_product.sku,
                        price=100.0,
                        quantity=1,
                        discount=0.0,
                    )
                ],
                subtotal=100.0,
                tax=0.0,
                total=100.0,
                payment_method=PaymentMethod.cash,
                created_by=cashier_user.name,
                sale_date=datetime.now(NPT).date().isoformat(),
            )
            result = await record_sale(body, cashier_id=str(cashier_user.id))
            ids.append(result.id)

        token = await _login()
        res = await client.get(
            "/api/v1/transactions",
            params={"page": 1, "page_size": 50},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text
        data = res.json()["data"]
        our = [row for row in data if row["id"] in ids]
        assert len(our) == 2
        # Newest first among the two we created
        assert our[0]["id"] == ids[-1]
        assert our[1]["id"] == ids[0]
    finally:
        for txn_id in ids:
            txn = await Transaction.get(txn_id)
            if txn:
                for adj in await StockAdjustment.find(StockAdjustment.transaction_id == txn_id).to_list():
                    await adj.delete()
                await txn.delete()
