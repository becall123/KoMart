import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from '@/layouts/MainLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { CatalogLayout } from '@/layouts/CatalogLayout';
import { ProtectedRoute, GuestRoute, RoleGuard } from '@/routes/guards';
import { LoginPage } from '@/pages/auth/LoginPage';
import { CatalogPage } from '@/pages/catalog/CatalogPage';
import { CatalogDetailPage } from '@/pages/catalog/CatalogDetailPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { POSPage } from '@/pages/pos/POSPage';
import { ProductsPage } from '@/pages/products/ProductsPage';
import { ProductFormPage } from '@/pages/products/ProductFormPage';
import { BulkProductFormPage } from '@/pages/products/BulkProductFormPage';
import { ProductDetailPage } from '@/pages/products/ProductDetailPage';
import { InventoryPage } from '@/pages/inventory/InventoryPage';
import { InventoryDetailPage } from '@/pages/inventory/InventoryDetailPage';
import { PurchaseOrdersPage } from '@/pages/purchase-orders/PurchaseOrdersPage';
import { PurchaseOrderFormPage } from '@/pages/purchase-orders/PurchaseOrderFormPage';
import { PurchaseOrderDetailPage } from '@/pages/purchase-orders/PurchaseOrderDetailPage';
import { SalesPage } from '@/pages/sales/SalesPage';
import { SaleDetailPage } from '@/pages/sales/SaleDetailPage';
import { SalesBackfillPage } from '@/pages/sales/SalesBackfillPage';
import { SuppliersPage } from '@/pages/suppliers/SuppliersPage';
import { SupplierFormPage } from '@/pages/suppliers/SupplierFormPage';
import { SupplierDetailPage } from '@/pages/suppliers/SupplierDetailPage';
import { CustomersPage } from '@/pages/customers/CustomersPage';
import { CustomerDetailPage } from '@/pages/customers/CustomerDetailPage';
import { ReportsPage } from '@/pages/reports/ReportsPage';
import { DailyReportPage } from '@/pages/reports/DailyReportPage';
import { AccountsPage } from '@/pages/accounts/AccountsPage';
import { ExpensesPage } from '@/pages/expenses/ExpensesPage';
import { ExpenseFormPage } from '@/pages/expenses/ExpenseFormPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';

export const router = createBrowserRouter([
  // Public catalog routes (no auth)
  {
    element: <CatalogLayout />,
    children: [
      { path: '/', element: <CatalogPage /> },
      { path: '/catalog/:id', element: <CatalogDetailPage /> },
    ],
  },
  {
    element: <GuestRoute />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: '/login', element: <LoginPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          // Routes accessible by all authenticated users
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/pos', element: <POSPage /> },
          { path: '/sales', element: <SalesPage /> },
          {
            element: <RoleGuard allow={['admin']} />,
            children: [
              { path: '/sales/backfill', element: <SalesBackfillPage /> },
            ],
          },
          { path: '/sales/:id', element: <SaleDetailPage /> },
          { path: '/products', element: <ProductsPage /> },
          { path: '/customers', element: <CustomersPage /> },
          { path: '/customers/:id', element: <CustomerDetailPage /> },
          { path: '/notifications', element: <NotificationsPage /> },

          // Manager + Admin only routes (placed before /:id catch-all)
          {
            element: <RoleGuard allow={['admin', 'manager']} />,
            children: [
              { path: '/products/new', element: <ProductFormPage /> },
              { path: '/products/bulk-add', element: <BulkProductFormPage /> },
              { path: '/products/:id/edit', element: <ProductFormPage /> },
              { path: '/inventory', element: <InventoryPage /> },
              { path: '/inventory/:productId', element: <InventoryDetailPage /> },
              { path: '/suppliers', element: <SuppliersPage /> },
              { path: '/suppliers/new', element: <SupplierFormPage /> },
              { path: '/suppliers/:id/edit', element: <SupplierFormPage /> },
              { path: '/suppliers/:id', element: <SupplierDetailPage /> },
              { path: '/purchase-orders', element: <PurchaseOrdersPage /> },
              { path: '/purchase-orders/new', element: <PurchaseOrderFormPage /> },
              { path: '/purchase-orders/:id/edit', element: <PurchaseOrderFormPage /> },
              { path: '/purchase-orders/:id', element: <PurchaseOrderDetailPage /> },
              { path: '/expenses', element: <ExpensesPage /> },
              { path: '/expenses/new', element: <ExpenseFormPage /> },
              { path: '/expenses/:id/edit', element: <ExpenseFormPage /> },
              { path: '/accounts', element: <AccountsPage /> },
              { path: '/reports', element: <ReportsPage /> },
              { path: '/reports/daily', element: <DailyReportPage /> },
              { path: '/settings', element: <SettingsPage /> },
              { path: '/settings/:tab', element: <SettingsPage /> },
            ],
          },

          // Product detail after /products/new to avoid /:id catching "new"
          { path: '/products/:id', element: <ProductDetailPage /> },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
