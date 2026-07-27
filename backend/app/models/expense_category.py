from beanie import Document, Indexed
from pydantic import Field
from datetime import datetime, timezone


# Codes used by PO payment / setup investment logic — immutable & always active.
SYSTEM_EXPENSE_CATEGORY_CODES = frozenset({"purchase_order", "setup_investment"})

DEFAULT_EXPENSE_CATEGORIES: list[tuple[str, str]] = [
    ("setup_investment", "Setup / Investment"),
    ("purchase_order", "Purchase Order"),
    ("rent", "Rent"),
    ("utilities", "Utilities"),
    ("salaries", "Salaries"),
    ("marketing", "Marketing"),
    ("supplies", "Supplies"),
    ("maintenance", "Maintenance"),
    ("equipment", "Equipment"),
    ("other", "Other"),
]


class ExpenseCategoryDoc(Document):
    code: Indexed(str, unique=True)  # type: ignore[valid-type]
    label: str
    description: str = ""
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "expense_categories"

    @property
    def is_system(self) -> bool:
        return self.code in SYSTEM_EXPENSE_CATEGORY_CODES
