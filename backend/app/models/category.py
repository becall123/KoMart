from beanie import Document, Indexed
from pydantic import Field
from datetime import datetime, timezone
from pymongo import IndexModel, ASCENDING


class Category(Document):
    name: Indexed(str, unique=True)  # type: ignore[valid-type]
    description: str = ""
    # Two-digit SKU prefix (01–99). Empty only for legacy rows before migration.
    code: str = ""
    # Next product sequence for this category (1–9999) → SKU = code + zero-padded seq.
    next_sku_seq: int = Field(default=1, ge=1)
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "categories"
        indexes = [
            IndexModel([("code", ASCENDING)], unique=True, partialFilterExpression={"code": {"$gt": ""}}),
        ]
