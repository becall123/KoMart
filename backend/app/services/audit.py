"""Centralized audit logging for security and compliance."""

from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

from fastapi import Request

from app.models.audit_log import AuditLog, AuditModule
from app.models.user import User

REDACT_KEYS = frozenset({
    "password",
    "hashed_password",
    "refresh_token",
    "access_token",
    "token",
})


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return _sanitize_dict(value)
    if isinstance(value, list):
        return [_sanitize_value(v) for v in value]
    return value


def _sanitize_dict(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in data.items():
        if key in REDACT_KEYS:
            out[key] = "***"
        elif isinstance(value, dict):
            out[key] = _sanitize_dict(value)
        elif isinstance(value, list):
            out[key] = [_sanitize_value(v) for v in value]
        else:
            out[key] = value
    return out


def request_meta(request: Request | None) -> dict[str, str]:
    if not request:
        return {
            "ip_address": "",
            "user_agent": "",
            "browser": "",
            "device": "",
            "request_id": str(uuid4()),
        }

    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else ""
    if not ip and request.client:
        ip = request.client.host or ""

    user_agent = request.headers.get("user-agent", "")[:512]
    request_id = getattr(request.state, "request_id", None) or request.headers.get(
        "x-request-id", str(uuid4()),
    )

    return {
        "ip_address": ip,
        "user_agent": user_agent,
        "browser": _parse_browser(user_agent),
        "device": _parse_device(user_agent),
        "request_id": request_id,
    }


def _parse_browser(user_agent: str) -> str:
    if not user_agent:
        return "Unknown"
    ua = user_agent.lower()
    if "edg/" in ua or "edge" in ua:
        return "Edge"
    if "chrome" in ua and "chromium" not in ua:
        return "Chrome"
    if "firefox" in ua:
        return "Firefox"
    if "safari" in ua and "chrome" not in ua:
        return "Safari"
    if "postman" in ua:
        return "Postman"
    return "Other"


def _parse_device(user_agent: str) -> str:
    if not user_agent:
        return "Unknown"
    ua = user_agent.lower()
    if re.search(r"mobile|android|iphone|ipod", ua):
        return "Mobile"
    if "ipad" in ua or "tablet" in ua:
        return "Tablet"
    return "Desktop"


async def log_audit(
    *,
    module: AuditModule,
    action: str,
    user: User | None = None,
    request: Request | None = None,
    entity_type: str = "",
    entity_id: str = "",
    previous: dict[str, Any] | None = None,
    new: dict[str, Any] | None = None,
    user_name: str = "",
    user_email: str = "",
    user_id: str = "",
) -> AuditLog:
    meta = request_meta(request)

    entry = AuditLog(
        user_id=user_id or (str(user.id) if user else ""),
        user_name=user_name or (user.name if user else ""),
        user_email=user_email or (user.email if user else ""),
        module=module,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        previous_value=_sanitize_dict(previous or {}),
        new_value=_sanitize_dict(new or {}),
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
        browser=meta["browser"],
        device=meta["device"],
        request_id=meta["request_id"],
    )
    await entry.insert()
    return entry


def product_snapshot(product: Any) -> dict[str, Any]:
    return {
        "id": str(product.id),
        "name": product.name,
        "sku": product.sku,
        "barcode": product.barcode,
        "cost_price": product.cost_price,
        "selling_price": product.selling_price,
        "category": product.category,
        "status": product.status.value if hasattr(product, "status") and product.status else "active",
        "is_active": product.is_active,
    }


def user_snapshot(user: User, *, include_email: bool = True) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": str(user.id),
        "name": user.name,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "is_active": user.is_active,
    }
    if include_email:
        data["email"] = user.email
    return data


def settings_snapshot(settings: Any) -> dict[str, Any]:
    return {
        "store_name": settings.store_name,
        "address": settings.address,
        "phone": settings.phone,
        "email": settings.email,
        "logo_url": getattr(settings, "logo_url", ""),
        "pan": getattr(settings, "pan", ""),
        "vat_number": getattr(settings, "vat_number", ""),
        "currency": settings.currency,
        "tax_rate": settings.tax_rate,
        "tax_inclusive": settings.tax_inclusive,
        "receipt_header": getattr(settings, "receipt_header", ""),
        "receipt_footer": getattr(settings, "receipt_footer", ""),
        "auto_print": getattr(settings, "auto_print", False),
        "default_payment_method": getattr(settings, "default_payment_method", "cash"),
        "default_low_stock_threshold": getattr(settings, "default_low_stock_threshold", 10),
        "expiry_warning_days": getattr(settings, "expiry_warning_days", 30),
        "auto_sku": getattr(settings, "auto_sku", False),
        "barcode_format": getattr(settings, "barcode_format", "any"),
        "loyalty_points_per_currency": settings.loyalty_points_per_currency,
        "loyalty_redeem_rate": getattr(settings, "loyalty_redeem_rate", 1),
        "transaction_prefix": getattr(settings, "transaction_prefix", "TXN"),
        "purchase_order_prefix": getattr(settings, "purchase_order_prefix", "PO"),
        "date_format": getattr(settings, "date_format", "en-US"),
        "time_format": getattr(settings, "time_format", "12h"),
        "calendar_system": getattr(settings, "calendar_system", "BS"),
        "fiscal_year_start_month": getattr(settings, "fiscal_year_start_month", 7),
        "fiscal_year_start_day": getattr(settings, "fiscal_year_start_day", 16),
        "opening_cash_balance": float(getattr(settings, "opening_cash_balance", 0) or 0),
        "opening_bank_balance": float(getattr(settings, "opening_bank_balance", 0) or 0),
        "opening_esewa_balance": float(getattr(settings, "opening_esewa_balance", 0) or 0),
    }


def po_snapshot(po: Any) -> dict[str, Any]:
    return {
        "id": str(po.id),
        "order_number": po.order_number,
        "supplier_id": po.supplier_id,
        "supplier_name": po.supplier_name,
        "status": po.status.value if hasattr(po.status, "value") else str(po.status),
        "total_amount": po.total_amount,
        "amount_paid": float(getattr(po, "amount_paid", 0) or 0),
        "payment_status": (
            po.payment_status.value
            if hasattr(getattr(po, "payment_status", None), "value")
            else str(getattr(po, "payment_status", "unpaid"))
        ),
        "item_count": len(po.items),
    }


def expense_snapshot(expense: Any) -> dict[str, Any]:
    category = expense.category
    return {
        "id": str(expense.id),
        "title": expense.title,
        "amount": expense.amount,
        "category": category.value if hasattr(category, "value") else str(category),
        "date": expense.date,
        "bill_no": getattr(expense, "bill_no", None) or "",
        "is_setup_cost": bool(getattr(expense, "is_setup_cost", False)),
        "purchase_order_id": getattr(expense, "purchase_order_id", None) or "",
    }


def day_close_snapshot(doc: Any) -> dict[str, Any]:
    status_raw = getattr(doc, "status", None) or "open"
    status_val = status_raw.value if hasattr(status_raw, "value") else str(status_raw)
    return {
        "date": getattr(doc, "date", ""),
        "opening_cash": round(float(getattr(doc, "opening_cash", 0) or 0), 2),
        "closing_cash": round(float(getattr(doc, "closing_cash", 0) or 0), 2),
        "closing_bank": getattr(doc, "closing_bank", None),
        "closing_esewa": getattr(doc, "closing_esewa", None),
        "status": status_val,
        "notes": (getattr(doc, "notes", "") or "")[:200],
    }


def cash_custody_snapshot(doc: Any) -> dict[str, Any]:
    status_raw = getattr(doc, "status", None) or "held"
    status_val = status_raw.value if hasattr(status_raw, "value") else str(status_raw)
    return {
        "amount": round(float(getattr(doc, "amount", 0) or 0), 2),
        "held_by_name": getattr(doc, "held_by_name", "") or "",
        "held_by_user_id": getattr(doc, "held_by_user_id", "") or "",
        "status": status_val,
        "taken_date": getattr(doc, "taken_date", "") or "",
        "resolved_date": getattr(doc, "resolved_date", None),
        "deposit_wallet": getattr(doc, "deposit_wallet", None),
        "remarks": (getattr(doc, "remarks", "") or "")[:200],
    }


def wallet_transfer_snapshot(
    *,
    from_wallet: str,
    to_wallet: str,
    amount: float,
    date: str,
    remarks: str,
) -> dict[str, Any]:
    return {
        "from_wallet": from_wallet,
        "to_wallet": to_wallet,
        "amount": round(float(amount), 2),
        "date": date,
        "remarks": (remarks or "")[:200],
    }


def wallet_adjustment_snapshot(
    *,
    wallet: str,
    amount: float,
    direction: str,
    date: str,
    remarks: str,
) -> dict[str, Any]:
    return {
        "wallet": wallet,
        "amount": round(float(amount), 2),
        "direction": direction,
        "date": date,
        "remarks": (remarks or "")[:200],
    }


def sale_snapshot(txn: Any) -> dict[str, Any]:
    return {
        "id": str(txn.id),
        "transaction_number": txn.transaction_number,
        "customer_id": txn.customer_id or "",
        "customer_name": txn.customer_name or "",
        "subtotal": txn.subtotal,
        "tax": txn.tax,
        "discount": txn.discount,
        "promotion_discount": getattr(txn, "promotion_discount", 0.0) or 0.0,
        "manual_discount": getattr(txn, "manual_discount", 0.0) or 0.0,
        "loyalty_points_redeemed": txn.loyalty_points_redeemed,
        "round_off": getattr(txn, "round_off", 0.0) or 0.0,
        "total": txn.total,
        "payment_method": txn.payment_method.value if hasattr(txn.payment_method, "value") else str(txn.payment_method),
        "item_count": len(txn.items),
        "items": [
            {
                "product_id": i.product_id,
                "quantity": i.quantity,
                "price": i.price,
                "discount": i.discount,
            }
            for i in txn.items
        ],
        "notes": getattr(txn, "notes", "") or "",
    }
