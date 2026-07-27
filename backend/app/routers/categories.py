from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from typing import List, Optional
import re

from app.auth.dependencies import get_current_user, require_manager_or_above, require_admin_only
from app.models.user import User
from app.models.category import Category
from app.services.category_sync import propagate_category_rename

router = APIRouter(prefix="/categories", tags=["Categories"])

_CODE_RE = re.compile(r"^\d{2}$")


def _validate_code(code: str) -> str:
    normalized = (code or "").strip()
    if not _CODE_RE.match(normalized):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Category code must be exactly 2 digits (01–99)",
        )
    return normalized


class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    code: str = Field(..., description="Two-digit SKU prefix")


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    # code is immutable after create — ignored if sent


class CategoryResponse(BaseModel):
    id: str
    name: str
    description: str
    code: str
    is_active: bool
    created_at: str


def _to_response(c: Category) -> CategoryResponse:
    return CategoryResponse(
        id=str(c.id),
        name=c.name,
        description=c.description,
        code=getattr(c, "code", "") or "",
        is_active=c.is_active,
        created_at=c.created_at.isoformat(),
    )


@router.get("", response_model=List[CategoryResponse])
async def list_categories(
    include_inactive: bool = False,
    _: User = Depends(get_current_user),
):
    query = Category.find() if include_inactive else Category.find(Category.is_active == True)  # noqa: E712
    categories = await query.sort("name").to_list()
    return [_to_response(c) for c in categories]


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(body: CategoryCreate, _: User = Depends(require_manager_or_above)):
    code = _validate_code(body.code)
    if await Category.find_one(Category.name == body.name):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Category name already exists")
    if await Category.find_one(Category.code == code):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Category code already exists")
    category = Category(
        name=body.name.strip(),
        description=body.description or "",
        code=code,
        next_sku_seq=1,
    )
    await category.insert()
    return _to_response(category)


@router.patch("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: str,
    body: CategoryUpdate,
    _: User = Depends(require_manager_or_above),
):
    category = await Category.get(category_id)
    if not category:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Category not found")
    update_data: dict = {}
    if body.name is not None:
        existing = await Category.find_one({"name": body.name, "_id": {"$ne": category.id}})
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Category name already exists")
        update_data["name"] = body.name
    if body.description is not None:
        update_data["description"] = body.description
    if body.is_active is not None:
        update_data["is_active"] = body.is_active
    if update_data:
        await category.set(update_data)
        if body.name is not None:
            await propagate_category_rename(category_id, body.name)
    refreshed = await Category.get(category_id)
    return _to_response(refreshed)  # type: ignore[arg-type]


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_category(category_id: str, _: User = Depends(require_admin_only)):
    category = await Category.get(category_id)
    if not category:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Category not found")
    await category.set({"is_active": False})
