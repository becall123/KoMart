"""Generate and maintain inventory / procurement alert notifications."""

from __future__ import annotations

from app.models.notification import Notification, NotificationType
from app.models.product import Product
from app.models.purchase_order import POStatus, PurchaseOrder
from app.models.inventory import InventoryBatch
from app.services.stock import expiring_product_ids, get_current_stock_batch
from app.services.store_settings import get_store_settings


def _auto_key(suffix: str) -> str:
    return f"auto:{suffix}"


async def _upsert_auto(
    source_key: str,
    *,
    type: NotificationType,
    title: str,
    message: str,
    link: str | None,
) -> None:
    existing = await Notification.find_one(Notification.source_key == source_key)
    if existing:
        await existing.set(
            {
                "type": type,
                "title": title,
                "message": message,
                "link": link,
            }
        )
        return
    await Notification(
        type=type,
        title=title,
        message=message,
        link=link,
        source_key=source_key,
        read=False,
    ).insert()


async def sync_notifications() -> None:
    """Refresh auto-generated alerts from current inventory and PO state."""
    settings = await get_store_settings()
    within_days = settings.expiry_warning_days
    active_keys: set[str] = set()

    products = await Product.find(Product.is_active == True).to_list()  # noqa: E712
    product_ids = [str(p.id) for p in products]
    stock_map = await get_current_stock_batch(product_ids)

    for product in products:
        pid = str(product.id)
        stock = stock_map.get(pid, 0)
        if stock <= 0 or stock > product.low_stock_threshold:
            continue
        key = _auto_key(f"low_stock:{pid}")
        active_keys.add(key)
        threshold = int(product.low_stock_threshold)
        await _upsert_auto(
            key,
            type=NotificationType.low_stock,
            title="Low Stock Alert",
            message=f'{product.name} is running low ({stock} units, threshold {threshold})',
            link=f"/inventory/{pid}",
        )

    expiring_ids = await expiring_product_ids(within_days)
    if expiring_ids:
        count = len(expiring_ids)
        key = _auto_key("expiry:summary")
        active_keys.add(key)
        day_label = "day" if within_days == 1 else "days"
        await _upsert_auto(
            key,
            type=NotificationType.expiry,
            title="Expiry Warning",
            message=f"{count} product{'s' if count != 1 else ''} expiring within {within_days} {day_label}",
            link="/reports?tab=inventory",
        )

    pending_pos = await PurchaseOrder.find(
        {"status": {"$in": [POStatus.ordered.value, POStatus.partial.value]}}
    ).to_list()
    for po in pending_pos:
        key = _auto_key(f"po:{po.id}")
        active_keys.add(key)
        status_label = "partially received" if po.status == POStatus.partial else "awaiting delivery"
        await _upsert_auto(
            key,
            type=NotificationType.purchase_reminder,
            title="Purchase Order Pending",
            message=f"{po.order_number} {status_label} from {po.supplier_name}",
            link=f"/purchase-orders/{po.id}",
        )

    auto_notifications = await Notification.find(
        {"source_key": {"$regex": r"^auto:"}}
    ).to_list()
    for notification in auto_notifications:
        if notification.source_key and notification.source_key not in active_keys:
            await notification.delete()
