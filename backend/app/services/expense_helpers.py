from app.models.expense import Expense
from app.models.expense_category import ExpenseCategoryDoc

_SETUP_CATEGORY = "setup_investment"

# MongoDB aggregation condition: expense counts as setup/investment.
SETUP_INVESTMENT_MATCH = {
    "$or": [
        {"$eq": ["$is_setup_cost", True]},
        {"$eq": ["$category", _SETUP_CATEGORY]},
    ],
}


def is_setup_investment(expense: Expense) -> bool:
    return bool(expense.is_setup_cost) or str(expense.category) == _SETUP_CATEGORY


def normalize_setup_fields(data: dict) -> dict:
    """Category setup_investment implies is_setup_cost; keep explicit flag otherwise."""
    category = data.get("category")
    if category == _SETUP_CATEGORY or str(category) == _SETUP_CATEGORY:
        data["is_setup_cost"] = True
    return data


async def assert_valid_expense_category(code: str, *, allow_inactive: bool = False) -> ExpenseCategoryDoc:
    """Resolve expense category by code; raise HTTPException if missing/inactive."""
    from fastapi import HTTPException, status

    key = (code or "").strip()
    if not key:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Expense category is required")
    doc = await ExpenseCategoryDoc.find_one(ExpenseCategoryDoc.code == key)
    if not doc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Unknown expense category '{key}'")
    if not doc.is_active and not allow_inactive:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Expense category '{key}' is inactive")
    return doc
