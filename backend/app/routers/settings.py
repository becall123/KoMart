from fastapi import APIRouter, Depends, Request, HTTPException, status
from pydantic import BaseModel, Field
from pydantic import ConfigDict
from typing import Optional, Literal

from app.auth.dependencies import get_current_user, require_admin_only
from app.models.user import User
from app.models.settings import StoreSettings
from app.models.audit_log import AuditModule
from app.services.audit import log_audit, settings_snapshot
from app.services.store_settings import get_store_settings, settings_to_api

router = APIRouter(prefix="/settings", tags=["Settings"])


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    store_name: Optional[str] = Field(None, alias="storeName")
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    logo_url: Optional[str] = Field(None, alias="logoUrl")
    pan: Optional[str] = None
    vat_number: Optional[str] = Field(None, alias="vatNumber")
    currency: Optional[str] = None
    tax_rate: Optional[float] = Field(None, alias="taxRate")
    tax_inclusive: Optional[bool] = Field(None, alias="taxInclusive")
    receipt_header: Optional[str] = Field(None, alias="receiptHeader")
    receipt_footer: Optional[str] = Field(None, alias="receiptFooter")
    auto_print: Optional[bool] = Field(None, alias="autoPrint")
    default_payment_method: Optional[str] = Field(None, alias="defaultPaymentMethod")
    default_low_stock_threshold: Optional[int] = Field(None, alias="defaultLowStockThreshold")
    expiry_warning_days: Optional[int] = Field(None, alias="expiryWarningDays")
    auto_sku: Optional[bool] = Field(None, alias="autoSku")
    barcode_format: Optional[str] = Field(None, alias="barcodeFormat")
    loyalty_points_per_currency: Optional[int] = Field(None, alias="loyaltyPointsPerCurrency")
    loyalty_redeem_rate: Optional[int] = Field(None, alias="loyaltyRedeemRate")
    transaction_prefix: Optional[str] = Field(None, alias="transactionPrefix")
    purchase_order_prefix: Optional[str] = Field(None, alias="purchaseOrderPrefix")
    date_format: Optional[str] = Field(None, alias="dateFormat")
    time_format: Optional[Literal["12h", "24h"]] = Field(None, alias="timeFormat")
    calendar_system: Optional[Literal["AD", "BS"]] = Field(None, alias="calendarSystem")
    fiscal_year_start_month: Optional[int] = Field(None, alias="fiscalYearStartMonth", ge=1, le=12)
    fiscal_year_start_day: Optional[int] = Field(None, alias="fiscalYearStartDay", ge=1, le=31)
    opening_cash_balance: Optional[float] = Field(None, alias="openingCashBalance", ge=0)
    opening_bank_balance: Optional[float] = Field(None, alias="openingBankBalance", ge=0)
    opening_esewa_balance: Optional[float] = Field(None, alias="openingEsewaBalance", ge=0)


@router.get("")
async def get_settings(_: User = Depends(get_current_user)):
    settings = await get_store_settings()
    return settings_to_api(settings)


@router.patch("")
async def update_settings(
    body: SettingsUpdate,
    request: Request,
    current_user: User = Depends(require_admin_only),
):
    settings = await get_store_settings()
    before = settings_snapshot(settings)
    update_data = body.model_dump(exclude_unset=True)
    if "transaction_prefix" in update_data and update_data["transaction_prefix"]:
        update_data["transaction_prefix"] = update_data["transaction_prefix"].strip().upper()
    if "purchase_order_prefix" in update_data and update_data["purchase_order_prefix"]:
        update_data["purchase_order_prefix"] = update_data["purchase_order_prefix"].strip().upper()
    if "default_payment_method" in update_data and update_data["default_payment_method"]:
        update_data["default_payment_method"] = update_data["default_payment_method"].strip().lower()
    for balance_key in (
        "opening_cash_balance",
        "opening_bank_balance",
        "opening_esewa_balance",
    ):
        if balance_key in update_data and update_data[balance_key] is not None:
            val = float(update_data[balance_key])
            if val < 0:
                label = balance_key.replace("_", " ").title()
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail=f"{label} cannot be negative",
                )
            update_data[balance_key] = round(val, 2)
    if update_data:
        await settings.set(update_data)
        refreshed = await StoreSettings.find_one()
        after = settings_snapshot(refreshed) if refreshed else before
        await log_audit(
            module=AuditModule.settings,
            action="update",
            user=current_user,
            request=request,
            entity_type="store_settings",
            entity_id=str(settings.id),
            previous=before,
            new=after,
        )
    return {"message": "Settings updated"}
