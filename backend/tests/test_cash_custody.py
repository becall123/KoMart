"""Total Cash math and staff cash custody flows."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.jwt import hash_password
from app.database import init_db
from app.main import app
from app.models.cash_custody import CashCustody
from app.models.day_close import DayClose
from app.models.settings import StoreSettings
from app.models.user import User, UserRole
from app.models.wallet_ledger import Wallet, WalletDirection, WalletEntryType, WalletLedgerEntry
from app.services import wallet_ledger as wl


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
    email = f"custody-mgr-{uuid.uuid4().hex[:8]}@komart.com"
    user = User(
        email=email,
        name="Custody Manager",
        hashed_password=hash_password("managerpass123"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


@pytest.fixture
async def holder_user():
    email = f"custody-holder-{uuid.uuid4().hex[:8]}@komart.com"
    user = User(
        email=email,
        name="Cash Holder",
        hashed_password=hash_password("holderpass123"),
        role=UserRole.cashier,
        is_active=True,
    )
    await user.insert()
    yield user
    await user.delete()


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


async def _reset_cash_state():
    await WalletLedgerEntry.find_all().delete()
    await CashCustody.find_all().delete()
    await DayClose.find_all().delete()
    settings = await StoreSettings.find_one()
    if settings:
        await settings.set({
            "opening_cash_balance": 10000.0,
            "opening_bank_balance": 0.0,
            "opening_esewa_balance": 0.0,
        })


@pytest.mark.asyncio
async def test_total_cash_equals_opening_plus_ledger_plus_open_custody(
    client: AsyncClient,
    manager_user: User,
    holder_user: User,
):
    await _reset_cash_state()
    today = date.today().isoformat()

    await DayClose(
        date=today,
        opening_cash=500.0,
        closing_cash=0.0,
        created_by="test",
        updated_by="test",
    ).insert()

    await wl.post_entry(
        wallet=Wallet.cash,
        direction=WalletDirection.inflow,
        amount=2000.0,
        entry_type=WalletEntryType.sale,
        date=today,
        remarks="sale",
        created_by="test",
    )

    balances_before = await wl.all_balances()
    # Total Cash ignores till opening; uses settings opening + all-time net
    assert balances_before["cash"] == 12000.0
    assert balances_before["cash_till_expected"] == 2500.0  # 500 + 2000
    assert balances_before["cash_with_staff"] == 0.0

    token = await _login(client, manager_user.email, "managerpass123")
    take = await client.post(
        "/api/v1/cash-custodies",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "amount": 1000,
            "held_by_user_id": str(holder_user.id),
            "taken_date": today,
            "remarks": "Manager pocket",
        },
    )
    assert take.status_code == 201, take.text
    balances_after_take = await wl.all_balances()
    # Take: cash ledger −1000, open custody +1000 → Total Cash unchanged
    assert balances_after_take["cash"] == 12000.0
    assert balances_after_take["cash_with_staff"] == 1000.0
    assert balances_after_take["cash_till_expected"] == 1500.0


@pytest.mark.asyncio
async def test_custody_return_restores_cash_ledger(
    client: AsyncClient,
    manager_user: User,
    holder_user: User,
):
    await _reset_cash_state()
    today = date.today().isoformat()
    token = await _login(client, manager_user.email, "managerpass123")

    take = await client.post(
        "/api/v1/cash-custodies",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "amount": 500,
            "held_by_user_id": str(holder_user.id),
            "taken_date": today,
            "remarks": "Take for return test",
        },
    )
    assert take.status_code == 201
    custody_id = take.json()["id"]

    before_return = await wl.all_balances()
    assert before_return["cash_with_staff"] == 500.0

    ret = await client.post(
        f"/api/v1/cash-custodies/{custody_id}/return",
        headers={"Authorization": f"Bearer {token}"},
        json={"resolved_date": today, "remarks": "Back to till"},
    )
    assert ret.status_code == 200, ret.text
    after = await wl.all_balances()
    assert after["cash_with_staff"] == 0.0
    assert after["cash"] == before_return["cash"]
    assert after["cash"] == 10000.0


@pytest.mark.asyncio
async def test_custody_deposit_moves_to_bank_without_cash_in(
    client: AsyncClient,
    manager_user: User,
    holder_user: User,
):
    await _reset_cash_state()
    today = date.today().isoformat()
    token = await _login(client, manager_user.email, "managerpass123")

    take = await client.post(
        "/api/v1/cash-custodies",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "amount": 800,
            "held_by_user_id": str(holder_user.id),
            "taken_date": today,
            "remarks": "Take for deposit",
        },
    )
    custody_id = take.json()["id"]
    before = await wl.all_balances()

    dep = await client.post(
        f"/api/v1/cash-custodies/{custody_id}/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"wallet": "bank", "resolved_date": today, "remarks": "Bank drop"},
    )
    assert dep.status_code == 200, dep.text
    after = await wl.all_balances()
    assert after["cash_with_staff"] == 0.0
    assert after["cash"] == round(before["cash"] - 800, 2)
    assert after["bank"] == round(before["bank"] + 800, 2)


@pytest.mark.asyncio
async def test_closed_day_rejects_upsert_without_reopen(
    client: AsyncClient,
    manager_user: User,
):
    await _reset_cash_state()
    today = date.today().isoformat()
    token = await _login(client, manager_user.email, "managerpass123")
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.put(
        f"/api/v1/day-closes/{today}",
        headers=headers,
        json={"opening_cash": 100, "closing_cash": 150, "notes": "open"},
    )
    assert create.status_code == 200

    closed = await client.post(f"/api/v1/day-closes/{today}/close", headers=headers)
    assert closed.status_code == 200
    assert closed.json()["status"] == "closed"

    blocked = await client.put(
        f"/api/v1/day-closes/{today}",
        headers=headers,
        json={"opening_cash": 100, "closing_cash": 200, "notes": "edit"},
    )
    assert blocked.status_code == 409

    reopened = await client.post(f"/api/v1/day-closes/{today}/reopen", headers=headers)
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "open"

    ok = await client.put(
        f"/api/v1/day-closes/{today}",
        headers=headers,
        json={"opening_cash": 100, "closing_cash": 200, "notes": "edit after reopen"},
    )
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_opening_suggestion_uses_yesterday_closing(
    client: AsyncClient,
    manager_user: User,
):
    await _reset_cash_state()
    today = date.today()
    yesterday = (today - timedelta(days=1)).isoformat()
    await DayClose(
        date=yesterday,
        opening_cash=10,
        closing_cash=777.5,
        created_by="test",
        updated_by="test",
    ).insert()

    token = await _login(client, manager_user.email, "managerpass123")
    res = await client.get(
        f"/api/v1/day-closes/{today.isoformat()}/opening-suggestion",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["suggested_opening_cash"] == 777.5
    assert body["yesterday_closing_cash"] == 777.5
