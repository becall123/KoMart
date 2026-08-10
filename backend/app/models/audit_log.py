from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class AuditModule(str, Enum):
    auth = "auth"
    products = "products"
    inventory = "inventory"
    sales = "sales"
    purchase_orders = "purchase_orders"
    settings = "settings"
    users = "users"
    expenses = "expenses"
    customers = "customers"
    categories = "categories"
    discounts = "discounts"
    accounts = "accounts"


class AuditLog(Document):
    user_id: str = ""
    user_name: str = ""
    user_email: str = ""
    module: AuditModule
    action: str
    entity_type: str = ""
    entity_id: str = ""
    previous_value: dict[str, Any] = Field(default_factory=dict)
    new_value: dict[str, Any] = Field(default_factory=dict)
    ip_address: str = ""
    user_agent: str = ""
    browser: str = ""
    device: str = ""
    request_id: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "audit_logs"
        indexes = [
            IndexModel([("created_at", DESCENDING)]),
            IndexModel([("module", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel([("entity_type", ASCENDING), ("entity_id", ASCENDING)]),
            IndexModel([("action", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel([("request_id", ASCENDING)]),
        ]
