import { delay, generateId } from '@/utils';
import { computeProductPricing } from '@/utils/productPricing';
import type {
  LoginCredentials,
  ListQueryParams,
  PaginatedResponse,
  Product,
  ProductBulkUpdateItem,
  ProductBulkUpdateResponse,
  InventoryItem,
  InventoryStats,
  Supplier,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderReceiveItem,
  PurchaseOrderLineStatus,
  PurchaseOrderWritePayload,
  Customer,
  Transaction,
  AppNotification,
  DashboardStats,
  RevenueDataPoint,
  TopProduct,
  DashboardKpiSummary,
  CashFlowPoint,
  NamedAmountPoint,
  TopProfitProduct,
  SalesCollectionPoint,
  StoreSettings,
  User,
  DateRange,
  StockAdjustment,
  SalesSummary,
  SalesByPaymentMethod,
  SalesByCategory,
  InventoryReportSummary,
  ExpiringProductRow,
  LowStockProductRow,
  Expense,
  ExpenseWritePayload,
  ExpenseSummary,
  ExpenseStats,
  ProfitSummary,
  MarginByCategory,
  PurchasingBySupplier,
  PurchaseOrdersSummary,
  TopCustomer,
  LoyaltySummary,
  SalesByHour,
  SalesByDayOfWeek,
  SalesByCashier,
  DeadStockProduct,
  DiscountRule,
  EvaluateDiscountResult,
  AuditLog,
  AuditLogQueryParams,
} from '@/types';
import {
  isMockEnabled,
  MOCK_ACCESS_TOKEN,
  MOCK_REFRESH_TOKEN,
} from '@/config/mock';
import {
  mockUser,
  mockProducts,
  mockInventory,
  mockSuppliers,
  mockPurchaseOrders,
  mockCustomers,
  mockTransactions,
  mockNotifications,
  mockDashboardStats,
  mockRevenueData,
  mockTopProducts,
  mockDashboardKpi,
  mockCashFlow,
  mockOperationalExpenses,
  mockTopProfitProducts,
  mockSalesCollection,
  mockSalesByCategory,
  mockSalesSummary,
  mockSalesByPaymentMethod,
  mockInventoryReportSummary,
  mockProfitSummary,
  mockStoreSettings,
  mockExpenses,
} from './mockData';

// Mutable in-memory store
let products = [...mockProducts];
let inventory = [...mockInventory];
let suppliers = [...mockSuppliers];
let purchaseOrders = [...mockPurchaseOrders];
let customers = [...mockCustomers];
let transactions = [...mockTransactions];
let expenses = [...mockExpenses];
let dayCloses: import('@/types').DayCloseRecord[] = [];
/** Keys: `${date}:${wallet}` for posted day-close variance adjustments */
let dayCloseVariancePosted = new Set<string>();

function isSetupInvestmentExpense(e: Expense): boolean {
  return e.isSetupCost || e.category === 'setup_investment';
}
const notifications = [...mockNotifications];

/** In-memory only; not persisted across reload — mock stock helpers mirror real API behavior. */
function applyMockStockDelta(productId: string, delta: number): void {
  const prodIdx = products.findIndex((p) => p.id === productId);
  if (prodIdx !== -1) {
    products[prodIdx] = {
      ...products[prodIdx],
      stock: Math.max(0, products[prodIdx].stock + delta),
    };
  }
  const invIdx = inventory.findIndex((i) => i.id === productId);
  if (invIdx !== -1) {
    inventory[invIdx] = {
      ...inventory[invIdx],
      stock: Math.max(0, inventory[invIdx].stock + delta),
    };
  }
}

function paginate<T>(items: T[], params: ListQueryParams): PaginatedResponse<T> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  let filtered = [...items];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter((item) =>
      JSON.stringify(item).toLowerCase().includes(q),
    );
  }

  if (params.category) {
    filtered = filtered.filter(
      (item) => (item as Record<string, unknown>)['category'] === params.category,
    );
  }

  if (params.supplierId) {
    filtered = filtered.filter(
      (item) => (item as Record<string, unknown>)['supplierId'] === params.supplierId,
    );
  }

  const stockFilter = params.filter as string | undefined;
  if (stockFilter === 'low') {
    filtered = filtered.filter((item) => {
      const row = item as InventoryItem;
      return row.stock > 0 && row.stock <= row.lowStockThreshold;
    });
  } else if (stockFilter === 'out') {
    filtered = filtered.filter((item) => (item as InventoryItem).stock === 0);
  }

  if (params.sortBy) {
    const key = params.sortBy as keyof T;
    const order = params.sortOrder === 'desc' ? -1 : 1;
    filtered.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null || bv == null) return 0;
      if (av < bv) return -1 * order;
      if (av > bv) return 1 * order;
      return 0;
    });
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);
  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

function mockSuggestSkus(
  items: import('@/types').SkuSuggestItem[],
  exclude: string[] = [],
): import('@/types').SkuSuggestResponse {
  const used = new Set(exclude.map((sku) => sku.trim().toLowerCase()).filter(Boolean));
  const existing = new Set(products.map((p) => p.sku.toLowerCase()));
  const skus: string[] = [];
  for (const item of items) {
    let sku = '';
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const brand = (item.brand || 'PRD').replace(/\s+/g, '').slice(0, 3).toUpperCase();
      const category = (item.category || 'GEN')
        .split(/[\s&]+/)
        .map((word) => word[0] ?? '')
        .join('')
        .toUpperCase()
        .slice(0, 3);
      const candidate = `${brand}-${category}-${String(Math.floor(1000 + Math.random() * 9000))}`;
      const key = candidate.toLowerCase();
      if (used.has(key) || existing.has(key)) continue;
      sku = candidate;
      used.add(key);
      break;
    }
    skus.push(sku || `PRD-GEN-${generateId().slice(0, 6).toUpperCase()}`);
  }
  return { skus };
}

export const mockApi = {
  isMockEnabled: isMockEnabled(),

  async login(credentials: LoginCredentials): Promise<{
    user: User;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    await delay(600);
    if (credentials.email === 'admin@komart.com' && credentials.password === 'password') {
      return {
        user: mockUser,
        accessToken: MOCK_ACCESS_TOKEN,
        refreshToken: MOCK_REFRESH_TOKEN,
        expiresIn: 900,
      };
    }
    throw new Error('Invalid email or password');
  },

  async refresh(_refreshToken: string): Promise<{
    user: User;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    await delay(200);
    return {
      user: mockUser,
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      expiresIn: 900,
    };
  },

  async getDashboardStats(_range?: DateRange): Promise<DashboardStats> {
    await delay(400);
    return { ...mockDashboardStats, totalProducts: products.length };
  },

  async getRevenueData(_range?: DateRange): Promise<RevenueDataPoint[]> {
    await delay(400);
    return mockRevenueData;
  },

  async getTopProducts(): Promise<TopProduct[]> {
    await delay(300);
    return mockTopProducts;
  },

  async getRecentTransactions(): Promise<Transaction[]> {
    await delay(300);
    return transactions.slice(0, 10);
  },

  async getDashboardKpiSummary(): Promise<DashboardKpiSummary> {
    await delay(300);
    return mockDashboardKpi;
  },

  async getDashboardCashFlow(_days = 30): Promise<CashFlowPoint[]> {
    await delay(300);
    return mockCashFlow;
  },

  async getDashboardPaymentMethodFlow(method: 'cash' | 'bank' | 'esewa'): Promise<CashFlowPoint[]> {
    await delay(300);
    const scale = method === 'cash' ? 1 : method === 'bank' ? 0.7 : 0.4;
    return mockCashFlow.map((p) => ({
      date: p.date,
      inflow: Math.round(p.inflow * scale),
      outflow: Math.round(p.outflow * scale * 0.6),
    }));
  },

  async getDashboardKpiFlow(
    metric: 'sales' | 'purchase' | 'receivables' | 'payables' | 'cash' | 'bank' | 'esewa',
  ): Promise<CashFlowPoint[]> {
    await delay(300);
    if (metric === 'cash' || metric === 'bank' || metric === 'esewa') {
      return this.getDashboardPaymentMethodFlow(metric);
    }
    if (metric === 'receivables') {
      return mockCashFlow.map((p) => ({ date: p.date, inflow: 0, outflow: 0 }));
    }
    if (metric === 'sales') {
      return mockCashFlow.map((p) => ({ date: p.date, inflow: p.inflow, outflow: 0 }));
    }
    // purchase / payables
    return mockCashFlow.map((p) => ({ date: p.date, inflow: 0, outflow: Math.round(p.outflow * 0.8) }));
  },

  async getDashboardOperationalExpenses(_days = 30): Promise<NamedAmountPoint[]> {
    await delay(300);
    return mockOperationalExpenses;
  },

  async getDashboardTopProfitProducts(_days = 30, limit = 6): Promise<TopProfitProduct[]> {
    await delay(300);
    return mockTopProfitProducts.slice(0, limit);
  },

  async getDashboardTopSoldProducts(_days = 30, limit = 6): Promise<TopProduct[]> {
    await delay(300);
    return mockTopProducts.slice(0, limit);
  },

  async getDashboardSalesCollection(_days = 30): Promise<SalesCollectionPoint[]> {
    await delay(300);
    return mockSalesCollection;
  },

  async getSalesByCategory(): Promise<typeof mockSalesByCategory> {
    await delay(300);
    return mockSalesByCategory;
  },

  // ── Products ──────────────────────────────────────────────────────────────
  async getProducts(params: ListQueryParams = {}): Promise<PaginatedResponse<Product>> {
    await delay(400);
    return paginate(products, params);
  },

  async getProduct(id: string): Promise<Product> {
    await delay(300);
    const product = products.find((p) => p.id === id);
    if (!product) throw new Error('Product not found');
    return product;
  },

  async createProduct(
    data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Product> {
    await delay(600);
    let sku = data.sku?.trim() ?? '';
    if (!sku) {
      const suggested = mockSuggestSkus(
        [{ brand: data.brand ?? '', category: data.category ?? '' }],
        products.map((p) => p.sku),
      );
      sku = suggested.skus[0] ?? `PRD-GEN-${generateId().slice(0, 6).toUpperCase()}`;
    }
    const supplier = data.supplierId
      ? suppliers.find((s) => s.id === data.supplierId)
      : undefined;
    const product: Product = {
      ...data,
      sku,
      status: data.status ?? 'active',
      supplierName: supplier?.name ?? data.supplierName ?? '',
      id: `prod-${generateId().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const pricing = computeProductPricing({
      costPrice: product.costPrice,
      sellingPrice: product.sellingPrice,
      packSellingPrice: product.packSellingPrice ?? 0,
      unitsPerBuyUom: product.unitsPerBuyUom ?? 1,
      discountPercent: product.discountPercent ?? 0,
      offeredPrice: product.offeredPrice ?? 0,
      packDiscountPercent: product.packDiscountPercent ?? 0,
      packOfferedPrice: product.packOfferedPrice ?? 0,
    });
    Object.assign(product, pricing);
    products = [product, ...products];
    inventory = [{ ...product, batches: [], batchCount: 0 }, ...inventory];
    return product;
  },

  async suggestSkus(
    items: import('@/types').SkuSuggestItem[],
    exclude: string[] = [],
  ): Promise<import('@/types').SkuSuggestResponse> {
    await delay(200);
    return mockSuggestSkus(items, exclude);
  },

  async updateProduct(id: string, data: Partial<Product>): Promise<Product> {
    await delay(500);
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Product not found');
    const supplier = data.supplierId
      ? suppliers.find((s) => s.id === data.supplierId)
      : undefined;
    products[idx] = {
      ...products[idx],
      ...data,
      ...(supplier ? { supplierName: supplier.name } : {}),
      updatedAt: new Date().toISOString(),
    };
    const merged = products[idx];
    const pricing = computeProductPricing({
      costPrice: merged.costPrice,
      sellingPrice: merged.sellingPrice,
      packSellingPrice: merged.packSellingPrice ?? 0,
      unitsPerBuyUom: merged.unitsPerBuyUom ?? 1,
      discountPercent: merged.discountPercent ?? 0,
      offeredPrice: merged.offeredPrice ?? 0,
      packDiscountPercent: merged.packDiscountPercent ?? 0,
      packOfferedPrice: merged.packOfferedPrice ?? 0,
    });
    products[idx] = { ...merged, ...pricing };
    return products[idx];
  },

  async bulkUpdateProducts(
    updates: ProductBulkUpdateItem[],
  ): Promise<ProductBulkUpdateResponse> {
    await delay(600);
    const errors: ProductBulkUpdateResponse['errors'] = [];
    let updated = 0;
    for (const item of updates) {
      const { id, ...data } = item;
      try {
        await this.updateProduct(id, data as Partial<Product>);
        updated += 1;
      } catch (err) {
        errors.push({ id, detail: err instanceof Error ? err.message : 'Update failed' });
      }
    }
    return { updated, errors };
  },

  async deleteProduct(id: string): Promise<void> {
    await delay(400);
    products = products.filter((p) => p.id !== id);
    inventory = inventory.filter((i) => i.id !== id);
  },

  // ── Inventory ─────────────────────────────────────────────────────────────
  async getInventory(params: ListQueryParams = {}): Promise<import('@/types').InventoryListResponse> {
    await delay(400);
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;
    let filtered = [...inventory];
    if (params.search) {
      const q = String(params.search).toLowerCase();
      filtered = filtered.filter(
        (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
      );
    }
    if (params.category) {
      filtered = filtered.filter((i) => i.category === params.category);
    }
    if (params.supplierId) {
      filtered = filtered.filter((i) => i.supplierId === params.supplierId);
    }
    const stockFilter = params.filter as string | undefined;
    if (stockFilter === 'low') {
      filtered = filtered.filter((i) => i.stock > 0 && i.stock <= i.lowStockThreshold);
    } else if (stockFilter === 'out') {
      filtered = filtered.filter((i) => i.stock === 0);
    } else if (stockFilter === 'expiring') {
      filtered = filtered.filter((i) => Boolean(i.nearestExpiry));
    }
    const totalStockValue =
      Math.round(filtered.reduce((s, i) => s + i.stock * i.costPrice, 0) * 100) / 100;
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    return {
      data: filtered.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages,
      totalStockValue,
    };
  },

  async getInventoryStats(): Promise<InventoryStats> {
    await delay(300);
    const lowStock = inventory.filter((i) => i.stock > 0 && i.stock <= i.lowStockThreshold).length;
    const outOfStock = inventory.filter((i) => i.stock === 0).length;
    return {
      totalSkus: inventory.length,
      lowStock,
      outOfStock,
      expiring: 0,
      inventoryValue: inventory.reduce((s, i) => s + i.stock * i.costPrice, 0),
    };
  },

  async adjustStock(adjustment: Omit<StockAdjustment, 'id' | 'createdAt'>): Promise<void> {
    await delay(500);
    applyMockStockDelta(adjustment.productId, adjustment.quantity);
  },

  async receiveBatch(payload: import('@/services').ReceiveBatchPayload): Promise<import('@/types').InventoryBatch> {
    await delay(500);
    applyMockStockDelta(payload.productId, payload.quantity);
    const prodIdx = products.findIndex((p) => p.id === payload.productId);
    if (prodIdx !== -1 && payload.unitCost != null) {
      products[prodIdx] = { ...products[prodIdx], costPrice: payload.unitCost };
    }
    if (prodIdx !== -1 && payload.sellingPrice != null) {
      products[prodIdx] = { ...products[prodIdx], sellingPrice: payload.sellingPrice };
    }
    const invIdx = inventory.findIndex((i) => i.id === payload.productId);
    if (invIdx !== -1) {
      inventory[invIdx] = {
        ...inventory[invIdx],
        costPrice: payload.unitCost ?? inventory[invIdx].costPrice,
        sellingPrice: payload.sellingPrice ?? inventory[invIdx].sellingPrice,
      };
    }
    return {
      id: `batch-${generateId().slice(0, 8)}`,
      productId: payload.productId,
      batchNumber: payload.batchNumber,
      quantity: payload.quantity,
      unitCost: payload.unitCost ?? 0,
      expiryDate: payload.expiryDate,
      receivedAt: new Date().toISOString(),
    };
  },

  // ── Suppliers ─────────────────────────────────────────────────────────────
  async getSuppliers(params: ListQueryParams = {}): Promise<PaginatedResponse<Supplier>> {
    await delay(400);
    let filtered = [...suppliers];
    if (params.search) {
      const q = params.search.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.country.toLowerCase().includes(q) ||
          s.contactPerson.toLowerCase().includes(q),
      );
    }
    return paginate(filtered, params);
  },

  async getSupplier(id: string): Promise<Supplier> {
    await delay(300);
    const supplier = suppliers.find((s) => s.id === id);
    if (!supplier) throw new Error('Supplier not found');
    return supplier;
  },

  async createSupplier(data: Omit<Supplier, 'id' | 'createdAt'>): Promise<Supplier> {
    await delay(600);
    const supplier: Supplier = {
      ...data,
      id: `sup-${generateId().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
    };
    suppliers = [supplier, ...suppliers];
    return supplier;
  },

  async updateSupplier(id: string, data: Partial<Supplier>): Promise<Supplier> {
    await delay(500);
    const idx = suppliers.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error('Supplier not found');
    suppliers[idx] = { ...suppliers[idx], ...data };
    return suppliers[idx];
  },

  // ── Purchase Orders ───────────────────────────────────────────────────────
  async getPurchaseOrders(params: ListQueryParams = {}): Promise<import('@/types').PurchaseOrderListResponse> {
    await delay(400);
    let filtered = [...purchaseOrders];
    const status = typeof params.status === 'string' ? params.status : undefined;
    const paymentStatus = typeof params.paymentStatus === 'string' ? params.paymentStatus : undefined;

    if (status) {
      filtered = filtered.filter((po) => po.status === status);
    }
    if (paymentStatus) {
      filtered = filtered.filter((po) => {
        const pay = po.paymentStatus ?? 'unpaid';
        if (paymentStatus === 'unpaid') {
          return !po.paymentStatus || po.paymentStatus === 'unpaid';
        }
        return pay === paymentStatus;
      });
    }

    const page = paginate(filtered, params);
    return {
      ...page,
      receivedTotalAmount: Math.round(
        filtered
          .filter((po) => po.status === 'received')
          .reduce((sum, po) => sum + po.totalAmount, 0) * 100,
      ) / 100,
      outstandingAmount: Math.round(
        filtered
          .filter((po) => po.status !== 'cancelled')
          .reduce((sum, po) => sum + Math.max(0, po.totalAmount - (po.amountPaid ?? 0)), 0) * 100,
      ) / 100,
    };
  },

  async getPurchaseOrder(id: string): Promise<PurchaseOrder> {
    await delay(300);
    const po = purchaseOrders.find((p) => p.id === id);
    if (!po) throw new Error('Purchase order not found');
    return po;
  },

  async createPurchaseOrder(data: PurchaseOrderWritePayload): Promise<PurchaseOrder> {
    await delay(600);
    const poCount = purchaseOrders.filter((p) => p.orderNumber.startsWith('PO-')).length;
    const po: PurchaseOrder = {
      ...data,
      items: data.items.map((item) => ({ ...item, lineStatus: 'pending' as const })),
      id: `po-${generateId().slice(0, 8)}`,
      orderNumber: `PO-${String(poCount + 1).padStart(4, '0')}`,
      amountPaid: 0,
      paymentStatus: 'unpaid',
      payments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    purchaseOrders = [po, ...purchaseOrders];
    return po;
  },

  async updatePurchaseOrder(id: string, data: PurchaseOrderWritePayload): Promise<PurchaseOrder> {
    await delay(600);
    const idx = purchaseOrders.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Purchase order not found');
    const po = purchaseOrders[idx];
    if (po.status === 'received' || po.status === 'cancelled') {
      throw new Error('This purchase order cannot be edited');
    }
    if (po.status === 'ordered' && data.status === 'draft') {
      throw new Error('Cannot revert a placed order to draft');
    }

    const receivedByProduct = new Map(po.items.map((i) => [i.productId, i.receivedQuantity]));
    const mergedItems = data.items.map((item) => {
      const received = receivedByProduct.get(item.productId) ?? 0;
      if (item.quantity < received) {
        throw new Error(`Quantity for ${item.productName} cannot be less than received quantity (${received})`);
      }
      const lineStatus =
        received <= 0 ? 'pending' as const
        : received >= item.quantity ? 'received' as const
        : 'partial' as const;
      return { ...item, receivedQuantity: received, lineStatus };
    });

    purchaseOrders[idx] = {
      ...po,
      ...data,
      items: mergedItems,
      updatedAt: new Date().toISOString(),
    };
    return purchaseOrders[idx];
  },

  async updatePurchaseOrderStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder> {
    await delay(500);
    const idx = purchaseOrders.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Purchase order not found');
    purchaseOrders[idx] = { ...purchaseOrders[idx], status, updatedAt: new Date().toISOString() };
    return purchaseOrders[idx];
  },

  async receivePurchaseOrderItems(
    id: string,
    items: PurchaseOrderReceiveItem[],
  ): Promise<PurchaseOrder> {
    await delay(600);
    const idx = purchaseOrders.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Purchase order not found');
    const po = purchaseOrders[idx];
    if (po.status !== 'ordered' && po.status !== 'partial') {
      throw new Error('Only ordered or partially received purchase orders can be processed');
    }

    const updatedItems = po.items.map((item) => {
      const receive = items.find((r) => r.productId === item.productId);
      if (!receive) return item;
      const delta = receive.receiveQuantity;
      if (delta <= 0) return item;
      const units = receive.unitsPerBuyUom ?? item.unitsPerBuyUom ?? 1;
      applyMockStockDelta(item.productId, delta * units);
      const receivedQuantity = item.receivedQuantity + delta;
      const lineStatus: PurchaseOrderLineStatus =
        receivedQuantity <= 0 ? 'pending'
        : receivedQuantity >= item.quantity ? 'received'
        : 'partial';
      return {
        ...item,
        receivedQuantity,
        unitsPerBuyUom: receive.unitsPerBuyUom ?? item.unitsPerBuyUom,
        lineStatus,
      };
    });

    const allReceived = updatedItems.every((i) => i.receivedQuantity >= i.quantity);
    const anyReceived = updatedItems.some((i) => i.receivedQuantity > 0);
    const status: PurchaseOrderStatus = allReceived ? 'received' : anyReceived ? 'partial' : po.status;

    purchaseOrders[idx] = {
      ...po,
      items: updatedItems,
      status,
      receivedBy: 'Admin User',
      receivedDate: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    };
    return purchaseOrders[idx];
  },

  async recordPurchaseOrderPayment(
    id: string,
    payload: import('@/types').PurchaseOrderPaymentPayload,
  ): Promise<PurchaseOrder> {
    await delay(500);
    const idx = purchaseOrders.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Purchase order not found');
    const po = purchaseOrders[idx];
    if (!['ordered', 'partial', 'received'].includes(po.status)) {
      throw new Error('Payments can only be recorded for ordered, partial, or received purchase orders');
    }
    const amountPaid = po.amountPaid ?? 0;
    const remaining = Math.round((po.totalAmount - amountPaid) * 100) / 100;
    if (payload.amount <= 0) throw new Error('Payment amount must be greater than zero');
    if (payload.amount > remaining + 0.001) {
      throw new Error(`Payment exceeds remaining balance (${remaining.toFixed(2)})`);
    }

    const expenseId = `exp-${generateId().slice(0, 8)}`;
    const expense: Expense = {
      id: expenseId,
      title: `PO payment ${po.orderNumber}`,
      description: payload.notes || `Payment for purchase order ${po.orderNumber}`,
      amount: payload.amount,
      category: 'purchase_order',
      date: payload.date,
      paidTo: po.supplierName,
      billNo: payload.billNo?.trim() || undefined,
      paymentMethod: payload.paymentMethod,
      isSetupCost: false,
      purchaseOrderId: po.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expenses = [expense, ...expenses];

    const nextPaid = Math.round((amountPaid + payload.amount) * 100) / 100;
    const paymentStatus =
      nextPaid <= 0 ? 'unpaid' as const
      : nextPaid >= po.totalAmount ? 'paid' as const
      : 'partial' as const;

    purchaseOrders[idx] = {
      ...po,
      amountPaid: nextPaid,
      paymentStatus,
      payments: [
        ...(po.payments ?? []),
        {
          amount: payload.amount,
          date: payload.date,
          paymentMethod: payload.paymentMethod,
          billNo: payload.billNo,
          notes: payload.notes,
          expenseId,
          createdBy: 'Admin User',
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    return purchaseOrders[idx];
  },

  // ── Customers ─────────────────────────────────────────────────────────────
  async getCustomers(params: ListQueryParams = {}): Promise<PaginatedResponse<Customer>> {
    await delay(400);
    return paginate(customers, params);
  },

  async lookupCustomers(q: string, limit = 15): Promise<Customer[]> {
    await delay(120);
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    const filtered = customers.filter((c) => {
      if (!term) return true;
      if (c.name.toLowerCase().includes(term)) return true;
      if (c.email.toLowerCase().includes(term)) return true;
      if (c.phone.toLowerCase().includes(term)) return true;
      if (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)) return true;
      return false;
    });
    return filtered.slice(0, limit);
  },

  async getCustomer(id: string): Promise<Customer> {
    await delay(300);
    const customer = customers.find((c) => c.id === id);
    if (!customer) throw new Error('Customer not found');
    return customer;
  },

  async getCustomerTransactions(customerId: string): Promise<Transaction[]> {
    await delay(300);
    return transactions.filter((t) => t.customerId === customerId);
  },

  async createCustomer(data: Omit<Customer, 'id' | 'createdAt' | 'loyaltyPoints' | 'membershipTier' | 'totalSpent'>): Promise<Customer> {
    await delay(600);
    const customer: Customer = {
      ...data,
      id: `cust-${generateId().slice(0, 8)}`,
      loyaltyPoints: 0,
      membershipTier: 'bronze',
      totalSpent: 0,
      createdAt: new Date().toISOString(),
    };
    customers = [customer, ...customers];
    return customer;
  },

  async updateCustomer(id: string, data: Partial<Customer>): Promise<Customer> {
    await delay(500);
    const idx = customers.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error('Customer not found');
    customers[idx] = { ...customers[idx], ...data };
    return customers[idx];
  },

  // ── Transactions ──────────────────────────────────────────────────────────
  async getTransactions(params: ListQueryParams = {}): Promise<PaginatedResponse<Transaction>> {
    await delay(300);
    let filtered = [...transactions];

    if (params.search) {
      const q = params.search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.transactionNumber.toLowerCase().includes(q) ||
          (t.customerName?.toLowerCase().includes(q) ?? false),
      );
    }

    if (params.paymentMethod) {
      filtered = filtered.filter((t) => t.paymentMethod === params.paymentMethod);
    }

    if (params.startDate) {
      const start = new Date(params.startDate as string).getTime();
      filtered = filtered.filter((t) => new Date(t.createdAt).getTime() >= start);
    }

    if (params.endDate) {
      const end = new Date(params.endDate as string);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((t) => new Date(t.createdAt).getTime() <= end.getTime());
    }

    if (params.sortBy) {
      const sortKeyMap: Record<string, keyof Transaction> = {
        transaction_number: 'transactionNumber',
        customer_name: 'customerName',
        total: 'total',
        discount: 'discount',
        payment_method: 'paymentMethod',
        created_by: 'createdBy',
        created_at: 'createdAt',
      };
      const key = sortKeyMap[params.sortBy as string] ?? 'createdAt';
      const order = params.sortOrder === 'asc' ? 1 : -1;
      filtered.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av == null || bv == null) return 0;
        if (av < bv) return -1 * order;
        if (av > bv) return 1 * order;
        return 0;
      });
    } else {
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const totalAmount = Math.round(filtered.reduce((sum, t) => sum + (t.total ?? 0), 0) * 100) / 100;
    const paginated = paginate(filtered, params);
    return { ...paginated, totalAmount };
  },

  async getTransaction(id: string): Promise<Transaction> {
    await delay(200);
    const txn = transactions.find((t) => t.id === id);
    if (!txn) throw new Error('Transaction not found');
    return txn;
  },

  async createTransaction(
    data: Omit<Transaction, 'id' | 'transactionNumber' | 'createdAt'>,
  ): Promise<Transaction> {
    await delay(700);
    const txnCount = transactions.filter((t) => t.transactionNumber.startsWith('TXN-')).length;
    const txn: Transaction = {
      ...data,
      id: `txn-${generateId().slice(0, 8)}`,
      transactionNumber: `TXN-${String(txnCount + 1).padStart(4, '0')}`,
      createdAt: data.saleDate
        ? new Date(`${data.saleDate}T12:00:00`).toISOString()
        : new Date().toISOString(),
    };
    transactions = [txn, ...transactions];
    for (const line of data.items) {
      applyMockStockDelta(line.productId, -line.quantity);
    }
    if (data.customerId) {
      const idx = customers.findIndex((c) => c.id === data.customerId);
      if (idx !== -1) {
        const points = Math.floor(data.total / 100);
        customers[idx] = {
          ...customers[idx],
          loyaltyPoints: customers[idx].loyaltyPoints + points - data.loyaltyPointsRedeemed,
          totalSpent: customers[idx].totalSpent + data.total,
        };
      }
    }
    return txn;
  },

  async updateTransaction(id: string, payload: Partial<Transaction>): Promise<Transaction> {
    await delay(400);
    const idx = transactions.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error('Transaction not found');
    transactions[idx] = { ...transactions[idx], ...payload };
    return transactions[idx];
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  async getNotifications(params?: {
    unreadOnly?: boolean;
    type?: import('@/types').NotificationType;
    sync?: boolean;
  }): Promise<AppNotification[]> {
    await delay(300);
    let list = [...notifications];
    if (params?.unreadOnly) list = list.filter((n) => !n.read);
    if (params?.type) list = list.filter((n) => n.type === params.type);
    return list;
  },

  async markNotificationRead(id: string): Promise<void> {
    await delay(150);
    const idx = notifications.findIndex((n) => n.id === id);
    if (idx >= 0) notifications[idx] = { ...notifications[idx], read: true };
  },

  async markAllNotificationsRead(): Promise<void> {
    await delay(150);
    for (let i = 0; i < notifications.length; i++) {
      notifications[i] = { ...notifications[i], read: true };
    }
  },

  async syncNotifications(): Promise<void> {
    await delay(200);
  },

  async getSettings(): Promise<StoreSettings> {
    await delay(300);
    return mockStoreSettings;
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  async getSalesSummary(_range?: DateRange): Promise<SalesSummary> {
    await delay(300);
    return mockSalesSummary;
  },

  async getSalesByPaymentMethod(_range?: DateRange): Promise<SalesByPaymentMethod[]> {
    await delay(300);
    return mockSalesByPaymentMethod;
  },

  async getReportsRevenue(_range?: DateRange): Promise<RevenueDataPoint[]> {
    await delay(300);
    return mockRevenueData;
  },

  async getReportsTopProducts(_range?: DateRange): Promise<TopProduct[]> {
    await delay(300);
    return mockTopProducts;
  },

  async getReportsSalesByCategory(_range?: DateRange): Promise<SalesByCategory[]> {
    await delay(300);
    return mockSalesByCategory;
  },

  async getInventoryReportSummary(): Promise<InventoryReportSummary> {
    await delay(300);
    return mockInventoryReportSummary;
  },

  async getExpiringProducts(): Promise<PaginatedResponse<ExpiringProductRow>> {
    await delay(300);
    const rows: ExpiringProductRow[] = mockInventory
      .filter((i) => i.nearestExpiry)
      .slice(0, 5)
      .map((i) => ({
        productId: i.id,
        productName: i.name,
        sku: i.sku,
        category: i.category,
        batchNumber: i.batches[0]?.batchNumber ?? 'B-001',
        quantity: i.batches[0]?.quantity ?? i.stock,
        expiryDate: i.nearestExpiry!,
        daysUntilExpiry: 14,
      }));
    return { data: rows, total: rows.length, page: 1, pageSize: 25, totalPages: 1 };
  },

  async getLowStockReport(): Promise<PaginatedResponse<LowStockProductRow>> {
    await delay(300);
    const rows: LowStockProductRow[] = mockProducts
      .filter((p) => p.stock === 0 || (p.stock > 0 && p.stock <= p.lowStockThreshold))
      .slice(0, 10)
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        category: p.category,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
        status: p.stock === 0 ? 'out' : 'low',
      }));
    return { data: rows, total: rows.length, page: 1, pageSize: 25, totalPages: 1 };
  },

  async getProfitSummary(_range?: DateRange): Promise<ProfitSummary> {
    await delay(300);
    return mockProfitSummary;
  },

  async getMarginByCategory(_range?: DateRange): Promise<MarginByCategory[]> {
    await delay(300);
    return mockSalesByCategory.map((c) => ({
      category: c.category,
      revenue: c.revenue,
      cogs: Math.round(c.revenue * 0.6),
      grossProfit: Math.round(c.revenue * 0.4),
      grossMarginPct: 40,
    }));
  },

  async getPurchasingBySupplier(_range?: DateRange): Promise<PurchasingBySupplier[]> {
    await delay(300);
    return mockSuppliers.slice(0, 4).map((s, i) => ({
      supplierId: s.id,
      supplierName: s.name,
      totalAmount: 85000 - i * 12000,
      orderCount: 5 - i,
    }));
  },

  async getPurchaseOrdersSummary(_range?: DateRange): Promise<PurchaseOrdersSummary> {
    await delay(300);
    return {
      totalOrders: mockPurchaseOrders.length,
      totalAmount: mockPurchaseOrders.reduce((s, p) => s + p.totalAmount, 0),
      byStatus: [
        { status: 'ordered', count: 2 },
        { status: 'partial', count: 1 },
        { status: 'received', count: 3 },
      ],
    };
  },

  async getTopCustomers(_range?: DateRange): Promise<TopCustomer[]> {
    await delay(300);
    return mockCustomers.slice(0, 5).map((c) => ({
      customerId: c.id,
      customerName: c.name,
      transactionCount: 12,
      totalSpent: c.totalSpent,
    }));
  },

  async getLoyaltySummary(_range?: DateRange): Promise<LoyaltySummary> {
    await delay(300);
    return {
      pointsRedeemed: 450,
      activeMembers: mockCustomers.filter((c) => c.loyaltyPoints > 0).length,
      newCustomers: 8,
      totalMembers: mockCustomers.length,
    };
  },

  async getSalesByHour(_range?: DateRange): Promise<SalesByHour[]> {
    await delay(300);
    return Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      revenue: h >= 10 && h <= 20 ? Math.floor(Math.random() * 8000) + 2000 : Math.floor(Math.random() * 1500),
      transactionCount: h >= 10 && h <= 20 ? Math.floor(Math.random() * 30) + 5 : Math.floor(Math.random() * 5),
    }));
  },

  async getSalesByDayOfWeek(_range?: DateRange): Promise<SalesByDayOfWeek[]> {
    await delay(300);
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return labels.map((label, day) => ({
      day,
      label,
      revenue: 40000 + day * 3000 + (day >= 5 ? 15000 : 0),
      transactionCount: 120 + day * 8,
    }));
  },

  async getSalesByCashier(_range?: DateRange): Promise<SalesByCashier[]> {
    await delay(300);
    return [
      { cashier: 'Admin User', revenue: 185000, transactionCount: 680 },
      { cashier: 'Cashier', revenue: 157500, transactionCount: 560 },
    ];
  },

  async getDeadStock(): Promise<DeadStockProduct[]> {
    await delay(300);
    return mockProducts
      .filter((p) => p.stock > 20)
      .slice(0, 4)
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        category: p.category,
        stock: p.stock,
        stockValue: p.stock * p.costPrice,
        daysWithoutSale: 30,
      }));
  },

  // ── Expenses ────────────────────────────────────────────────────────────────
  async getExpenses(params?: ListQueryParams): Promise<PaginatedResponse<Expense>> {
    await delay(250);
    let filtered = [...expenses];
    if (params?.search) {
      const term = String(params.search).toLowerCase();
      filtered = filtered.filter((e) => e.title.toLowerCase().includes(term));
    }
    if (params?.category) {
      filtered = filtered.filter((e) => e.category === params.category);
    }
    if (params?.isSetupCost === 'true' || params?.isSetupCost === true) {
      filtered = filtered.filter((e) => e.isSetupCost);
    } else if (params?.isSetupCost === 'false' || params?.isSetupCost === false) {
      filtered = filtered.filter((e) => !e.isSetupCost);
    }
    if (params?.startDate) {
      filtered = filtered.filter((e) => e.date >= String(params.startDate));
    }
    if (params?.endDate) {
      filtered = filtered.filter((e) => e.date <= String(params.endDate));
    }
    return paginate<Expense>(filtered, params ?? {});
  },

  async getExpenseStats(): Promise<ExpenseStats> {
    await delay(200);
    const now = new Date();
    const thisMonthTotal = expenses
      .filter((e) => {
        const d = new Date(e.date);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((sum, e) => sum + e.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const setupInvestment = expenses
      .filter(isSetupInvestmentExpense)
      .reduce((sum, e) => sum + e.amount, 0);
    return {
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      thisMonth: Math.round(thisMonthTotal * 100) / 100,
      setupInvestment: Math.round(setupInvestment * 100) / 100,
      operatingExpenses: Math.round((totalExpenses - setupInvestment) * 100) / 100,
    };
  },

  async getExpense(id: string): Promise<Expense> {
    await delay(200);
    const expense = expenses.find((e) => e.id === id);
    if (!expense) throw new Error(`Expense ${id} not found`);
    return { ...expense };
  },

  async createExpense(data: ExpenseWritePayload): Promise<Expense> {
    await delay(300);
    const now = new Date().toISOString();
    const created: Expense = {
      ...data,
      id: `exp-${generateId().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    expenses = [created, ...expenses];
    return { ...created };
  },

  async updateExpense(id: string, data: Partial<ExpenseWritePayload>): Promise<Expense> {
    await delay(300);
    const idx = expenses.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Expense ${id} not found`);
    if (expenses[idx].purchaseOrderId) {
      throw new Error('PO-linked expenses cannot be edited here. Delete to reverse the payment.');
    }
    expenses[idx] = {
      ...expenses[idx],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    return { ...expenses[idx] };
  },

  async deleteExpense(id: string): Promise<void> {
    await delay(250);
    const expense = expenses.find((e) => e.id === id);
    if (expense?.purchaseOrderId) {
      const poIdx = purchaseOrders.findIndex((p) => p.id === expense.purchaseOrderId);
      if (poIdx !== -1) {
        const po = purchaseOrders[poIdx];
        const remainingPayments = (po.payments ?? []).filter((p) => p.expenseId !== id);
        const amountPaid = Math.round(
          Math.max(0, (po.amountPaid ?? 0) - expense.amount) * 100,
        ) / 100;
        const paymentStatus =
          amountPaid <= 0 ? 'unpaid' as const
          : amountPaid >= po.totalAmount ? 'paid' as const
          : 'partial' as const;
        purchaseOrders[poIdx] = {
          ...po,
          amountPaid,
          paymentStatus,
          payments: remainingPayments,
          updatedAt: new Date().toISOString(),
        };
      }
    }
    expenses = expenses.filter((e) => e.id !== id);
  },

  async getExpenseSummary(_range?: DateRange): Promise<ExpenseSummary> {
    await delay(300);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const setupInvestment = expenses
      .filter(isSetupInvestmentExpense)
      .reduce((sum, e) => sum + e.amount, 0);
    const categoryMap: Record<string, { amount: number; count: number }> = {};
    for (const e of expenses) {
      if (!categoryMap[e.category]) categoryMap[e.category] = { amount: 0, count: 0 };
      categoryMap[e.category].amount += e.amount;
      categoryMap[e.category].count += 1;
    }
    return {
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      setupInvestment: Math.round(setupInvestment * 100) / 100,
      operatingExpenses: Math.round((totalExpenses - setupInvestment) * 100) / 100,
      byCategory: Object.entries(categoryMap)
        .map(([category, v]) => ({ category, amount: Math.round(v.amount * 100) / 100, count: v.count }))
        .sort((a, b) => b.amount - a.amount),
      daily: [],
    };
  },

  async getDailySummary(date: string): Promise<import('@/types').DailySummary> {
    await delay(300);
    const dayTxns = transactions.filter((t) => {
      if (t.status === 'voided') return false;
      return t.createdAt.slice(0, 10) === date;
    });
    const dayExpenses = expenses.filter((e) => e.date === date);
    const normalize = (m: string) => (m === 'card' ? 'bank' : m);
    const paymentMap: Record<string, { revenue: number; count: number }> = {};
    let cashSales = 0;
    for (const t of dayTxns) {
      const method = normalize(t.paymentMethod);
      if (!paymentMap[method]) paymentMap[method] = { revenue: 0, count: 0 };
      paymentMap[method].revenue += t.total;
      paymentMap[method].count += 1;
      if (method === 'cash') cashSales += t.total;
    }
    const totalExpenses = dayExpenses.reduce((s, e) => s + e.amount, 0);
    const setupInvestment = dayExpenses
      .filter(isSetupInvestmentExpense)
      .reduce((s, e) => s + e.amount, 0);
    const cashExpenses = dayExpenses
      .filter((e) => normalize(e.paymentMethod ?? '') === 'cash')
      .reduce((s, e) => s + e.amount, 0);
    const dayClose = dayCloses.find((d) => d.date === date) ?? null;
    const opening = dayClose?.openingCash ?? 0;
    const closing = dayClose?.closingCash ?? 0;
    let cashExpected = Math.round((opening + cashSales - cashExpenses) * 100) / 100;
    const cashPosted = dayCloseVariancePosted.has(`${date}:cash`);
    let cashVariance = Math.round((closing - cashExpected) * 100) / 100;
    let cashAdjIn = 0;
    let cashAdjOut = 0;
    if (cashPosted && Math.abs(cashVariance) >= 0.01) {
      if (cashVariance > 0) cashAdjIn = Math.abs(cashVariance);
      else cashAdjOut = Math.abs(cashVariance);
      cashExpected = closing;
      cashVariance = 0;
    }

    const bankSales = Math.round((paymentMap.bank?.revenue ?? 0) * 100) / 100;
    const bankExpenses =
      Math.round(
        dayExpenses
          .filter((e) => normalize(e.paymentMethod ?? '') === 'bank')
          .reduce((s, e) => s + e.amount, 0) * 100,
      ) / 100;
    let bankExpected = Math.round((bankSales - bankExpenses) * 100) / 100;
    const bankClosing = dayClose?.closingBank ?? null;
    const bankPosted = dayCloseVariancePosted.has(`${date}:bank`);
    let bankVariance =
      bankClosing != null ? Math.round((bankClosing - bankExpected) * 100) / 100 : null;
    let bankAdjIn = 0;
    let bankAdjOut = 0;
    if (bankPosted && bankClosing != null && bankVariance != null && Math.abs(bankVariance) >= 0.01) {
      if (bankVariance > 0) bankAdjIn = Math.abs(bankVariance);
      else bankAdjOut = Math.abs(bankVariance);
      bankExpected = bankClosing;
      bankVariance = 0;
    }

    const esewaSales = Math.round((paymentMap.esewa?.revenue ?? 0) * 100) / 100;
    const esewaExpenses =
      Math.round(
        dayExpenses
          .filter((e) => normalize(e.paymentMethod ?? '') === 'esewa')
          .reduce((s, e) => s + e.amount, 0) * 100,
      ) / 100;
    let esewaExpected = Math.round((esewaSales - esewaExpenses) * 100) / 100;
    const esewaClosing = dayClose?.closingEsewa ?? null;
    const esewaPosted = dayCloseVariancePosted.has(`${date}:esewa`);
    let esewaVariance =
      esewaClosing != null ? Math.round((esewaClosing - esewaExpected) * 100) / 100 : null;
    let esewaAdjIn = 0;
    let esewaAdjOut = 0;
    if (esewaPosted && esewaClosing != null && esewaVariance != null && Math.abs(esewaVariance) >= 0.01) {
      if (esewaVariance > 0) esewaAdjIn = Math.abs(esewaVariance);
      else esewaAdjOut = Math.abs(esewaVariance);
      esewaExpected = esewaClosing;
      esewaVariance = 0;
    }

    return {
      date,
      sales: {
        totalRevenue: Math.round(dayTxns.reduce((s, t) => s + t.total, 0) * 100) / 100,
        transactionCount: dayTxns.length,
      },
      expenses: {
        total: Math.round(totalExpenses * 100) / 100,
        setupInvestment: Math.round(setupInvestment * 100) / 100,
        operating: Math.round((totalExpenses - setupInvestment) * 100) / 100,
      },
      byPaymentMethod: Object.entries(paymentMap)
        .map(([paymentMethod, v]) => ({
          paymentMethod,
          revenue: Math.round(v.revenue * 100) / 100,
          count: v.count,
        }))
        .sort((a, b) => b.revenue - a.revenue),
      cash: {
        opening,
        cashSales: Math.round(cashSales * 100) / 100,
        cashExpenses: Math.round(cashExpenses * 100) / 100,
        transfersIn: 0,
        transfersOut: 0,
        adjustmentsIn: cashAdjIn,
        adjustmentsOut: cashAdjOut,
        expected: cashExpected,
        closing,
        variance: cashVariance,
      },
      wallets: [
        {
          wallet: 'cash',
          opening,
          salesIn: Math.round(cashSales * 100) / 100,
          expensesOut: Math.round(cashExpenses * 100) / 100,
          transfersIn: 0,
          transfersOut: 0,
          adjustmentsIn: cashAdjIn,
          adjustmentsOut: cashAdjOut,
          expected: cashExpected,
          closing,
          variance: cashVariance,
          variancePosted: cashPosted,
        },
        {
          wallet: 'bank',
          opening: 0,
          salesIn: bankSales,
          expensesOut: bankExpenses,
          transfersIn: 0,
          transfersOut: 0,
          adjustmentsIn: bankAdjIn,
          adjustmentsOut: bankAdjOut,
          expected: bankExpected,
          closing: bankClosing,
          variance: bankVariance,
          variancePosted: bankPosted,
        },
        {
          wallet: 'esewa',
          opening: 0,
          salesIn: esewaSales,
          expensesOut: esewaExpenses,
          transfersIn: 0,
          transfersOut: 0,
          adjustmentsIn: esewaAdjIn,
          adjustmentsOut: esewaAdjOut,
          expected: esewaExpected,
          closing: esewaClosing,
          variance: esewaVariance,
          variancePosted: esewaPosted,
        },
      ],
      dayClose,
    };
  },

  async upsertDayClose(
    date: string,
    payload: import('@/types').DayCloseUpsertPayload,
  ): Promise<import('@/types').DayCloseRecord> {
    await delay(250);
    const record: import('@/types').DayCloseRecord = {
      date,
      openingCash: payload.openingCash,
      closingCash: payload.closingCash,
      closingBank: payload.closingBank ?? null,
      closingEsewa: payload.closingEsewa ?? null,
      notes: payload.notes,
      updatedBy: 'Admin User',
      updatedAt: new Date().toISOString(),
    };
    const idx = dayCloses.findIndex((d) => d.date === date);
    if (idx === -1) dayCloses = [record, ...dayCloses];
    else dayCloses[idx] = record;
    return record;
  },

  async postDayCloseVariance(
    date: string,
    wallet: string,
  ): Promise<import('@/types').WalletLedgerEntry> {
    await delay(250);
    const key = `${date}:${wallet}`;
    if (dayCloseVariancePosted.has(key)) {
      throw new Error('Variance already posted for this wallet/day. Reverse the adjustment in Accounts to re-post.');
    }
    const summary = await this.getDailySummary(date);
    const block = summary.wallets?.find((w) => w.wallet === wallet);
    if (!block || block.closing == null) {
      throw new Error('Save closing (counted/statement) before posting variance');
    }
    const variance = block.variance ?? 0;
    if (Math.abs(variance) < 0.01) {
      throw new Error('No variance to post');
    }
    dayCloseVariancePosted.add(key);
    return {
      id: `adj-var-${date}-${wallet}`,
      date,
      wallet: wallet as import('@/types').WalletCode,
      direction: variance > 0 ? 'in' : 'out',
      amount: Math.abs(variance),
      entryType: 'adjustment',
      remarks: `Day close variance ${date} (${wallet})`,
      referenceType: 'day_close_variance',
      referenceId: key,
      createdBy: 'Admin User',
      createdAt: new Date().toISOString(),
    };
  },

  // ── Discounts ─────────────────────────────────────────────────────────────
  async getDiscounts(_activeOnly = true): Promise<DiscountRule[]> {
    await delay(200);
    return [];
  },

  async createDiscount(
    data: Omit<DiscountRule, 'id' | 'createdAt' | 'updatedAt' | 'isActive'> & { isActive?: boolean },
  ): Promise<DiscountRule> {
    await delay(300);
    const now = new Date().toISOString();
    return {
      ...data,
      id: `disc-${generateId().slice(0, 8)}`,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
  },

  async updateDiscount(id: string, data: Partial<DiscountRule>): Promise<DiscountRule> {
    await delay(300);
    const now = new Date().toISOString();
    return {
      id,
      name: data.name ?? 'Mock discount',
      code: data.code ?? '',
      ruleType: data.ruleType ?? 'cart_percent',
      value: data.value ?? 0,
      productIds: data.productIds ?? [],
      category: data.category ?? '',
      minCartTotal: data.minCartTotal ?? 0,
      maxDiscount: data.maxDiscount ?? 0,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      isActive: data.isActive ?? true,
      priority: data.priority ?? 0,
      createdAt: now,
      updatedAt: now,
    };
  },

  async deleteDiscount(_id: string): Promise<void> {
    await delay(200);
  },

  async evaluateDiscount(payload: {
    items: Array<{ productId: string; price: number; quantity: number; category?: string }>;
    couponCode?: string;
  }): Promise<EvaluateDiscountResult> {
    await delay(150);
    return {
      lineItems: payload.items.map((item) => ({
        productId: item.productId,
        perUnitDiscount: 0,
        lineDiscount: 0,
      })),
      lineDiscountTotal: 0,
      cartDiscount: 0,
      promotionDiscountTotal: 0,
      appliedPromotions: [],
    };
  },

  // ── Audit logs ──────────────────────────────────────────────────────────────
  async getAuditLogs(params?: AuditLogQueryParams): Promise<PaginatedResponse<AuditLog>> {
    await delay(250);
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 25;
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  },

  async getAuditLog(id: string): Promise<AuditLog> {
    await delay(200);
    throw new Error(`Audit log ${id} not found`);
  },
};
