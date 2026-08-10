export const APP_NAME = 'KoMart';

export const APP_LOGO = '/koMart_logo.png';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export const DEFAULT_PAGE_SIZE = 10;

/** Grid / infinite-scroll product pages (products list, catalog). */
export const GRID_PAGE_SIZE = 24;

/** POS product grid — one screen of cards; load more on scroll. */
export const POS_PRODUCTS_PAGE_SIZE = 48;

/** Dropdowns and pickers (suppliers, product autocomplete). */
export const DROPDOWN_PAGE_SIZE = 50;

/** Typeahead / search result limits. */
export const PRODUCT_SEARCH_PAGE_SIZE = 25;

/** PO receive — chunk size and extended API timeout (ms). */
export const PO_RECEIVE_CHUNK_SIZE = 5;
export const PO_RECEIVE_TIMEOUT_MS = 120_000;

/** React Query stale-time tiers (milliseconds). */
export const STALE_TIME = {
  realtime: 30_000,
  standard: 120_000,
  reports: 300_000,
  static: 600_000,
} as const;

export const PAGE_SIZES = [10, 25, 50, 100];

export const CURRENCY = 'NPR';

export const CURRENCY_SYMBOL = 'Rs.';

export const TAX_RATE = 13;

export const LOYALTY_POINTS_PER_100 = 1;

export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: 'Dashboard', roles: ['admin', 'manager', 'cashier'] },
  { label: 'POS', path: '/pos', icon: 'PointOfSale', roles: ['admin', 'manager', 'cashier'] },
  { label: 'Sales', path: '/sales', icon: 'ReceiptLong', roles: ['admin', 'manager', 'cashier'] },
  { label: 'Products', path: '/products', icon: 'Inventory2', roles: ['admin', 'manager', 'cashier'] },
  { label: 'Inventory', path: '/inventory', icon: 'Warehouse', roles: ['admin', 'manager'] },
  { label: 'Suppliers', path: '/suppliers', icon: 'LocalShipping', roles: ['admin', 'manager'] },
  { label: 'Purchase Orders', path: '/purchase-orders', icon: 'Receipt', roles: ['admin', 'manager'] },
  { label: 'Expenses', path: '/expenses', icon: 'AccountBalance', roles: ['admin', 'manager'] },
  { label: 'Accounts', path: '/accounts', icon: 'AccountBalanceWallet', roles: ['admin', 'manager'] },
  { label: 'Customers', path: '/customers', icon: 'People', roles: ['admin', 'manager', 'cashier'] },
  { label: 'Reports', path: '/reports', icon: 'Assessment', roles: ['admin', 'manager'] },
  { label: 'Notifications', path: '/notifications', icon: 'Notifications', roles: ['admin', 'manager', 'cashier'] },
  { label: 'Settings', path: '/settings', icon: 'Settings', roles: ['admin', 'manager'] },
] as const;

export const SELL_MODE_OPTIONS = [
  { value: 'unit', label: 'Sell whole unit only (e.g. pack)' },
  { value: 'piece', label: 'Sell individual pieces only' },
  { value: 'both', label: 'Sell pack or pieces' },
] as const;

export const UOM_OPTIONS = [
  { value: 'pcs',    label: 'Pieces (pcs)' },
  { value: 'pack',   label: 'Pack' },
  { value: 'box',    label: 'Box' },
  { value: 'bag',    label: 'Bag' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'can',    label: 'Can' },
  { value: 'cup',    label: 'Cup' },
  { value: 'dozen',  label: 'Dozen' },
  { value: 'kg',     label: 'Kilogram (kg)' },
  { value: 'g',      label: 'Gram (g)' },
  { value: 'L',      label: 'Liter (L)' },
  { value: 'ml',     label: 'Milliliter (ml)' },
] as const;

export const PRODUCT_CATEGORIES = [
  'Snacks',
  'Instant Noodles',
  'Beverages',
  'Sauces & Condiments',
  'Frozen Foods',
  'Rice & Grains',
  'Confectionery',
  'Health & Wellness',
] as const;

export const PRODUCT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'discontinued', label: 'Discontinued' },
] as const;

export const DISCOUNT_RULE_TYPES = [
  { value: 'product_percent', label: 'Product — % off' },
  { value: 'product_flat', label: 'Product — flat off' },
  { value: 'category_percent', label: 'Category — % off' },
  { value: 'category_flat', label: 'Category — flat off' },
  { value: 'cart_percent', label: 'Cart — % off' },
  { value: 'cart_flat', label: 'Cart — flat off' },
] as const;

export const COUNTRIES = [
  'South Korea',
  'Japan',
  'China',
  'Thailand',
  'Vietnam',
  'Taiwan',
  'Nepal',
  'Other',
] as const;

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'esewa', label: 'eSewa' },
] as const;

export const EXPENSE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'setup_investment', label: 'Setup / Investment' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'rent', label: 'Rent' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'salaries', label: 'Salaries' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'other', label: 'Other' },
];

export const PO_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  partial: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export const PO_PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Unpaid',
  partial: 'Partially Paid',
  paid: 'Paid',
};

export const PO_LINE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  partial: 'Partially Received',
  received: 'Received',
};

export const AUDIT_MODULE_LABELS: Record<string, string> = {
  auth: 'Authentication',
  products: 'Products',
  inventory: 'Inventory',
  sales: 'Sales',
  purchase_orders: 'Purchase Orders',
  settings: 'Settings',
  users: 'Users',
  expenses: 'Expenses',
  accounts: 'Accounts',
  customers: 'Customers',
  categories: 'Categories',
  discounts: 'Discounts',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  day_close_create: 'Day close created',
  day_close_update: 'Day close updated',
  day_close_close: 'Day closed (locked)',
  day_close_reopen: 'Day reopened',
  day_close_post_variance: 'Variance posted to ledger',
  wallet_transfer: 'Wallet transfer',
  wallet_adjustment: 'Wallet adjustment',
  cash_custody_take: 'Cash taken — staff custody',
  cash_custody_return: 'Cash returned to till',
  cash_custody_deposit: 'Cash deposited from custody',
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  login: 'Login',
  logout: 'Logout',
};

export const MEMBERSHIP_TIER_LABELS: Record<string, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

export const DASHBOARD_WIDGETS = [
  { id: 'todaySales', label: 'Today\'s Sales', defaultW: 3, defaultH: 2 },
  { id: 'weeklySales', label: 'Weekly Sales', defaultW: 3, defaultH: 2 },
  { id: 'monthlySales', label: 'Monthly Sales', defaultW: 3, defaultH: 2 },
  { id: 'totalProducts', label: 'Total Products', defaultW: 3, defaultH: 2 },
  { id: 'lowStock', label: 'Low Stock', defaultW: 3, defaultH: 2 },
  { id: 'expiring', label: 'Expiring Products', defaultW: 3, defaultH: 2 },
  { id: 'inventoryValue', label: 'Inventory Value', defaultW: 3, defaultH: 2 },
  { id: 'customerCount', label: 'Customer Count', defaultW: 3, defaultH: 2 },
  { id: 'revenueChart', label: 'Revenue Trend', defaultW: 8, defaultH: 4 },
  { id: 'topProducts', label: 'Top Selling Products', defaultW: 4, defaultH: 4 },
  { id: 'recentTransactions', label: 'Recent Transactions', defaultW: 12, defaultH: 4 },
  { id: 'quickActions', label: 'Quick Actions', defaultW: 4, defaultH: 3 },
] as const;

export const DEFAULT_DASHBOARD_LAYOUT = DASHBOARD_WIDGETS.map((w, i) => ({
  i: w.id,
  x: (i % 4) * 3,
  y: Math.floor(i / 4) * 2,
  w: w.defaultW,
  h: w.defaultH,
}));

export const QUERY_KEYS = {
  dashboard: ['dashboard'] as const,
  dashboardStats: (range?: string) => ['dashboard', 'stats', range] as const,
  products: ['products'] as const,
  product: (id: string) => ['products', id] as const,
  inventory: ['inventory'] as const,
  suppliers: ['suppliers'] as const,
  supplier: (id: string) => ['suppliers', id] as const,
  purchaseOrders: ['purchaseOrders'] as const,
  purchaseOrder: (id: string) => ['purchaseOrders', id] as const,
  transactions: ['transactions'] as const,
  transaction: (id: string) => ['transactions', id] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', id] as const,
  notifications: ['notifications'] as const,
  expenses: ['expenses'] as const,
  expenseStats: ['expenses', 'stats'] as const,
  expense: (id: string) => ['expenses', id] as const,
  wallets: ['wallets'] as const,
  walletBalances: ['wallets', 'balances'] as const,
  walletLedger: (filters?: string) => ['wallets', 'ledger', filters] as const,
  cashCustodies: ['cashCustodies'] as const,
  cashCustodySummary: ['cashCustodies', 'summary'] as const,
  cashCustodyList: (filters?: string) => ['cashCustodies', 'list', filters] as const,
  reports: (type: string) => ['reports', type] as const,
  settings: ['settings'] as const,
  categories: ['categories'] as const,
  uoms: ['uoms'] as const,
  expenseCategories: ['expenseCategories'] as const,
  users: ['users'] as const,
  user: (id: string) => ['users', id] as const,
  auditLogs: (filters?: string) => ['auditLogs', filters] as const,
  auditLog: (id: string) => ['auditLogs', id] as const,
  inventoryItem: (id: string) => ['inventory', 'item', id] as const,
  inventoryMovements: (filters?: string) => ['inventory', 'movements', filters] as const,
  movementSummary: (filters?: string) => ['inventory', 'movementSummary', filters] as const,
  catalog: ['catalog'] as const,
  catalogProduct: (id: string) => ['catalog', id] as const,
  storeInfo: ['catalog', 'store-info'] as const,
  catalogOffers: ['catalog', 'offers'] as const,
  catalogTags: ['catalog', 'tags'] as const,
  discounts: ['discounts'] as const,
  discountEvaluate: (payload?: string) => ['discounts', 'evaluate', payload] as const,
};
