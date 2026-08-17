"""PO receive converts buy UOM qty to base stock units via units_per_buy_uom."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest

from app.auth.jwt import hash_password
from app.database import init_db
from app.models.inventory import InventoryBatch
from app.models.product import Product
from app.models.purchase_order import POStatus, PurchaseOrder, PurchaseOrderItem
from app.models.user import User, UserRole
from app.schemas.purchase_order import PurchaseOrderReceiveItem
from app.services.po_receive import receive_purchase_order_items
from app.services.stock import get_current_stock


def _mock_request() -> MagicMock:
    req = MagicMock()
    req.headers.get.return_value = ""
    req.client.host = "127.0.0.1"
    req.state.request_id = "test-request"
    return req


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


async def _manager() -> User:
    email = f"po-uom-{uuid.uuid4().hex[:8]}@komart.com"
    user = User(
        email=email,
        name="PO UOM Tester",
        hashed_password=hash_password("test"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    return user


@pytest.mark.asyncio
async def test_po_receive_converts_packs_to_base_pieces():
    sku = f"UOM-{uuid.uuid4().hex[:6]}"
    product = Product(
        name="Noodle Pack",
        sku=sku,
        barcode=sku,
        brand="T",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="",
        supplier_name="",
        buy_uom="pack",
        uom="pcs",
        units_per_buy_uom=12,
        cost_price=2.0,
        selling_price=25.0,
        is_active=True,
    )
    await product.insert()

    po = PurchaseOrder(
        order_number=f"PO-UOM-{uuid.uuid4().hex[:6]}",
        supplier_id="",
        supplier_name="",
        status=POStatus.ordered,
        items=[
            PurchaseOrderItem(
                product_id=str(product.id),
                product_name=product.name,
                quantity=5,
                unit_cost=120.0,
                received_quantity=0,
                order_uom="pack",
                base_uom="pcs",
                units_per_buy_uom=12,
            ),
        ],
        total_amount=600.0,
    )
    await po.insert()

    manager = await _manager()
    await receive_purchase_order_items(
        str(po.id),
        [
            PurchaseOrderReceiveItem(
                product_id=str(product.id),
                receive_quantity=5,
                expiry_date="2030-12-31",
            ),
        ],
        created_by=manager.name,
        current_user=manager,
        request=_mock_request(),
    )

    refreshed_product = await Product.get(product.id)
    assert refreshed_product is not None
    assert await get_current_stock(str(product.id)) == 60

    batches = await InventoryBatch.find(
        InventoryBatch.purchase_order_id == str(po.id),
    ).to_list()
    assert len(batches) == 1
    assert batches[0].quantity == 60
    assert batches[0].unit_cost == pytest.approx(10.0, rel=1e-3)
