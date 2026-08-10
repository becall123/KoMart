from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.services.stock import refresh_all_product_stocks
from app.routers import (
    auth,
    catalog,
    products,
    inventory,
    suppliers,
    purchase_orders,
    customers,
    transactions,
    dashboard,
    reports,
    notifications,
    settings as settings_router,
    expenses,
    users,
    categories,
    uoms,
    expense_categories,
    audit_logs,
    discounts,
    day_closes,
    wallets,
    cash_custody,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if not settings.skip_stock_refresh_on_start:
        await refresh_all_product_stocks()
    yield


app = FastAPI(
    title="KoMart API",
    description="Backend API for KoMart — Korean & Asian Snacks Retail Management",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


API_PREFIX = "/api/v1"

app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(catalog.router, prefix=API_PREFIX)
app.include_router(products.router, prefix=API_PREFIX)
app.include_router(inventory.router, prefix=API_PREFIX)
app.include_router(suppliers.router, prefix=API_PREFIX)
app.include_router(purchase_orders.router, prefix=API_PREFIX)
app.include_router(customers.router, prefix=API_PREFIX)
app.include_router(transactions.router, prefix=API_PREFIX)
app.include_router(dashboard.router, prefix=API_PREFIX)
app.include_router(reports.router, prefix=API_PREFIX)
app.include_router(notifications.router, prefix=API_PREFIX)
app.include_router(settings_router.router, prefix=API_PREFIX)
app.include_router(expenses.router, prefix=API_PREFIX)
app.include_router(users.router, prefix=API_PREFIX)
app.include_router(categories.router, prefix=API_PREFIX)
app.include_router(uoms.router, prefix=API_PREFIX)
app.include_router(expense_categories.router, prefix=API_PREFIX)
app.include_router(audit_logs.router, prefix=API_PREFIX)
app.include_router(discounts.router, prefix=API_PREFIX)
app.include_router(day_closes.router, prefix=API_PREFIX)
app.include_router(wallets.router, prefix=API_PREFIX)
app.include_router(cash_custody.router, prefix=API_PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "komart-api"}
