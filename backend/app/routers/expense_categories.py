"""Expense category master data — Settings-managed codes/labels."""

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, field_validator
from typing import List, Optional
import re
from datetime import datetime, timezone

from app.auth.dependencies import get_current_user, require_manager_or_above, require_admin_only
from app.models.user import User
from app.models.expense_category import (
    ExpenseCategoryDoc,
    SYSTEM_EXPENSE_CATEGORY_CODES,
)

router = APIRouter(prefix="/expense-categories", tags=["Expense Categories"])

_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9_]{0,39}$")


class ExpenseCategoryCreate(BaseModel):
    code: str
    label: str
    description: Optional[str] = ""

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        code = value.strip().lower().replace("-", "_").replace(" ", "_")
        if not _CODE_RE.match(code):
            raise ValueError("Code must be 1–40 lowercase letters, numbers, or underscores")
        return code

    @field_validator("label")
    @classmethod
    def validate_label(cls, value: str) -> str:
        label = value.strip()
        if not label:
            raise ValueError("Label is required")
        return label


class ExpenseCategoryUpdate(BaseModel):
    code: Optional[str] = None
    label: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        code = value.strip().lower().replace("-", "_").replace(" ", "_")
        if not _CODE_RE.match(code):
            raise ValueError("Code must be 1–40 lowercase letters, numbers, or underscores")
        return code

    @field_validator("label")
    @classmethod
    def validate_label(cls, value: str | None) -> str | None:
        if value is None:
            return None
        label = value.strip()
        if not label:
            raise ValueError("Label cannot be empty")
        return label


class ExpenseCategoryResponse(BaseModel):
    id: str
    code: str
    label: str
    description: str
    is_active: bool
    is_system: bool
    created_at: str


def _to_response(doc: ExpenseCategoryDoc) -> ExpenseCategoryResponse:
    return ExpenseCategoryResponse(
        id=str(doc.id),
        code=doc.code,
        label=doc.label,
        description=doc.description,
        is_active=doc.is_active,
        is_system=doc.code in SYSTEM_EXPENSE_CATEGORY_CODES,
        created_at=doc.created_at.isoformat(),
    )


@router.get("", response_model=List[ExpenseCategoryResponse])
async def list_expense_categories(
    include_inactive: bool = False,
    _: User = Depends(get_current_user),
):
    query = (
        ExpenseCategoryDoc.find()
        if include_inactive
        else ExpenseCategoryDoc.find(ExpenseCategoryDoc.is_active == True)  # noqa: E712
    )
    rows = await query.sort("label").to_list()
    return [_to_response(r) for r in rows]


@router.post("", response_model=ExpenseCategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_expense_category(
    body: ExpenseCategoryCreate,
    _: User = Depends(require_manager_or_above),
):
    if await ExpenseCategoryDoc.find_one(ExpenseCategoryDoc.code == body.code):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Expense category code already exists")
    doc = ExpenseCategoryDoc(
        code=body.code,
        label=body.label,
        description=body.description or "",
    )
    await doc.insert()
    return _to_response(doc)


@router.patch("/{category_id}", response_model=ExpenseCategoryResponse)
async def update_expense_category(
    category_id: str,
    body: ExpenseCategoryUpdate,
    _: User = Depends(require_manager_or_above),
):
    doc = await ExpenseCategoryDoc.get(category_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense category not found")

    update_data: dict = {"updated_at": datetime.now(timezone.utc)}
    is_system = doc.code in SYSTEM_EXPENSE_CATEGORY_CODES

    if body.code is not None:
        if is_system and body.code != doc.code:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="System expense category code cannot be changed",
            )
        existing = await ExpenseCategoryDoc.find_one({"code": body.code, "_id": {"$ne": doc.id}})
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Expense category code already exists")
        update_data["code"] = body.code

    if body.label is not None:
        update_data["label"] = body.label
    if body.description is not None:
        update_data["description"] = body.description

    if body.is_active is not None:
        if is_system and body.is_active is False:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="System expense categories cannot be deactivated",
            )
        update_data["is_active"] = body.is_active

    await doc.set(update_data)
    refreshed = await ExpenseCategoryDoc.get(category_id)
    return _to_response(refreshed)  # type: ignore[arg-type]


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_expense_category(
    category_id: str,
    _: User = Depends(require_admin_only),
):
    doc = await ExpenseCategoryDoc.get(category_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense category not found")
    if doc.code in SYSTEM_EXPENSE_CATEGORY_CODES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="System expense categories cannot be deactivated",
        )
    await doc.set({"is_active": False, "updated_at": datetime.now(timezone.utc)})
