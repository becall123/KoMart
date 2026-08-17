"""PO receive transaction — all-or-nothing per request."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest


def _mock_request() -> MagicMock:
    req = MagicMock()
    req.headers.get.return_value = ""
    req.client.host = "127.0.0.1"
    req.state.request_id = "test-request"
    return req

from app.auth.jwt import hash_password
from app.database import init_db
from app.models.inventory import InventoryBatch
from app.models.product import Product
from app.models.purchase_order import POStatus, PurchaseOrder, PurchaseOrderItem
from app.models.user import User, UserRole
from app.schemas.purchase_order import PurchaseOrderReceiveItem
from app.services.po_receive import receive_purchase_order_items
from app.services.stock import get_current_stock


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()


async def _manager() -> User:
    email = f"po-rcv-{uuid.uuid4().hex[:8]}@komart.com"
    user = User(
        email=email,
        name="PO Receive Tester",
        hashed_password=hash_password("test"),
        role=UserRole.manager,
        is_active=True,
    )
    await user.insert()
    return user


@pytest.mark.asyncio
async def test_po_receive_atomic_creates_batches_and_updates_po():
    sku_a = f"POA-{uuid.uuid4().hex[:6]}"
    sku_b = f"POB-{uuid.uuid4().hex[:6]}"
    prod_a = Product(
        name="PO Receive A",
        sku=sku_a,
        barcode=sku_a,
        brand="T",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="",
        supplier_name="",
        cost_price=10.0,
        selling_price=20.0,
        is_active=True,
    )
    prod_b = Product(
        name="PO Receive B",
        sku=sku_b,
        barcode=sku_b,
        brand="T",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="",
        supplier_name="",
        cost_price=15.0,
        selling_price=25.0,
        is_active=True,
    )
    await prod_a.insert()
    await prod_b.insert()

    po = PurchaseOrder(
        order_number=f"PO-TEST-{uuid.uuid4().hex[:6]}",
        supplier_id="",
        supplier_name="",
        status=POStatus.ordered,
        items=[
            PurchaseOrderItem(
                product_id=str(prod_a.id),
                product_name=prod_a.name,
                quantity=10,
                unit_cost=12.0,
                received_quantity=0,
            ),
            PurchaseOrderItem(
                product_id=str(prod_b.id),
                product_name=prod_b.name,
                quantity=5,
                unit_cost=18.0,
                received_quantity=0,
            ),
        ],
        total_amount=210.0,
    )
    await po.insert()

    user = await _manager()
    request = _mock_request()

    refreshed = await receive_purchase_order_items(
        str(po.id),
        [
            PurchaseOrderReceiveItem(
                product_id=str(prod_a.id),
                receive_quantity=10,
                expiry_date="2027-12-31",
            ),
            PurchaseOrderReceiveItem(
                product_id=str(prod_b.id),
                receive_quantity=5,
                expiry_date="2027-06-30",
            ),
        ],
        created_by=user.name,
        current_user=user,
        request=request,
    )

    assert refreshed.status == POStatus.received
    assert refreshed.items[0].received_quantity == 10
    assert refreshed.items[1].received_quantity == 5

    batches = await InventoryBatch.find(
        InventoryBatch.purchase_order_id == str(po.id),
    ).to_list()
    assert len(batches) == 2
    assert all(b.batch_number.startswith(f"PO-{po.order_number}-L") for b in batches)

    prod_a_r = await Product.get(str(prod_a.id))
    prod_b_r = await Product.get(str(prod_b.id))
    assert prod_a_r is not None and await get_current_stock(str(prod_a.id)) == 10
    assert prod_b_r is not None and await get_current_stock(str(prod_b.id)) == 5
    assert prod_a_r.cost_price == 12.0
    assert prod_b_r.cost_price == 18.0

    await po.delete()
    await prod_a.delete()
    await prod_b.delete()
    await user.delete()
    for b in batches:
        await b.delete()


@pytest.mark.asyncio
async def test_po_receive_batch_numbers_use_line_index():
    sku = f"POL-{uuid.uuid4().hex[:6]}"
    product = Product(
        name="PO Line Index",
        sku=sku,
        barcode=sku,
        brand="T",
        country_of_origin="Nepal",
        category="Snacks",
        supplier_id="",
        supplier_name="",
        cost_price=10.0,
        selling_price=20.0,
        is_active=True,
    )
    await product.insert()

    order_no = f"PO-LN-{uuid.uuid4().hex[:4]}"
    po = PurchaseOrder(
        order_number=order_no,
        supplier_id="",
        supplier_name="",
        status=POStatus.ordered,
        items=[
            PurchaseOrderItem(
                product_id=str(product.id),
                product_name=product.name,
                quantity=3,
                unit_cost=11.0,
                received_quantity=0,
            ),
        ],
        total_amount=33.0,
    )
    await po.insert()

    user = await _manager()
    request = _mock_request()

    await receive_purchase_order_items(
        str(po.id),
        [
            PurchaseOrderReceiveItem(
                product_id=str(product.id),
                receive_quantity=1,
                expiry_date="2027-01-01",
            ),
        ],
        created_by=user.name,
        current_user=user,
        request=request,
    )
    await receive_purchase_order_items(
        str(po.id),
        [
            PurchaseOrderReceiveItem(
                product_id=str(product.id),
                receive_quantity=2,
                expiry_date="2027-02-01",
            ),
        ],
        created_by=user.name,
        current_user=user,
        request=request,
    )

    batches = await InventoryBatch.find(
        InventoryBatch.purchase_order_id == str(po.id),
    ).sort("+received_at").to_list()
    assert len(batches) == 2
    assert batches[0].batch_number == f"PO-{order_no}-L01"
    assert batches[1].batch_number == f"PO-{order_no}-L01-2"

    await po.delete()
    await product.delete()
    await user.delete()
    for b in batches:
        await b.delete()
