import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Box,
  Button,
  Grid,
  Chip,
  Tabs,
  Tab,
  TextField,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Tooltip,
  Typography,
  Paper,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import AddBoxIcon from '@mui/icons-material/AddBox';
import DownloadIcon from '@mui/icons-material/Download';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchBar } from '@/components/common/SearchBar';
import { StatCard } from '@/components/common/StatCard';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { ReceiveStockDialog } from '@/components/inventory/ReceiveStockDialog';
import { AdjustStockDialog } from '@/components/inventory/AdjustStockDialog';
import { useInventory, useInventoryStats, useAdjustStock, useReceiveBatch } from '@/hooks/useInventory';
import { useSuppliers } from '@/hooks/useSuppliers';
import { downloadCsv, formatCurrency, formatExpiryDate } from '@/utils';
import { formatStockQty } from '@/utils/uomDisplay';
import { useAuthStore } from '@/store';
import { DROPDOWN_PAGE_SIZE } from '@/constants';
import { useCategoryNames } from '@/hooks/useCategories';
import type { InventoryItem } from '@/types';
import { inventoryService, type InventoryQueryParams } from '@/services';
import { showApiError, showSuccess } from '@/utils/toast';
import { MovementLedgerTab } from './MovementLedgerTab';

type StockFilter = 'all' | 'low' | 'out' | 'expiring';
type PageView = 'stock' | 'ledger';

const STOCK_FILTERS: StockFilter[] = ['all', 'low', 'out', 'expiring'];
const PAGE_VIEWS: PageView[] = ['stock', 'ledger'];

function nearestActiveBatch(item: InventoryItem) {
  return item.batches.find((b) => b.quantity > 0);
}

function expiryChipColor(date?: string): 'error' | 'warning' | 'default' {
  if (!date) return 'default';
  const days = (new Date(date).getTime() - Date.now()) / 86400000;
  if (days < 0) return 'error';
  if (days <= 30) return 'warning';
  return 'default';
}

function stockStatus(item: InventoryItem): 'out' | 'low' | 'ok' {
  if (item.stock === 0) return 'out';
  if (item.stock <= item.lowStockThreshold) return 'low';
  return 'ok';
}

function parsePageView(raw: string | null): PageView {
  return PAGE_VIEWS.includes(raw as PageView) ? (raw as PageView) : 'stock';
}

function parseStockFilter(raw: string | null): StockFilter {
  return STOCK_FILTERS.includes(raw as StockFilter) ? (raw as StockFilter) : 'all';
}

export function InventoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useAuthStore((s) => s.user);
  const canManage = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  const pageView = parsePageView(searchParams.get('tab'));
  const filter = parseStockFilter(searchParams.get('filter'));

  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [category, setCategory] = useState('');
  const categoryOptions = useCategoryNames();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);

  const [receiveTarget, setReceiveTarget] = useState<InventoryItem | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);

  const setTab = useCallback((tab: PageView) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'stock') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setFilter = useCallback((nextFilter: StockFilter) => {
    setPage(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('tab');
      if (nextFilter === 'all') next.delete('filter');
      else next.set('filter', nextFilter);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const inventoryParams: InventoryQueryParams = {
    search,
    filter,
    page: page + 1,
    pageSize,
    ...(supplierId ? { supplierId } : {}),
    ...(category ? { category } : {}),
  };

  const { data, isLoading } = useInventory(inventoryParams, pageView === 'stock');
  const { data: stats } = useInventoryStats();
  const { data: suppliersData } = useSuppliers({ pageSize: DROPDOWN_PAGE_SIZE });
  const adjustMutation = useAdjustStock();
  const receiveMutation = useReceiveBatch();

  const suppliers = suppliersData?.data ?? [];
  const items = data?.data ?? [];

  const filterLabels = useMemo(
    () => ({
      all: 'All',
      low: `Low (${stats?.lowStock ?? 0})`,
      out: `Out (${stats?.outOfStock ?? 0})`,
      expiring: `Expiring (${stats?.expiring ?? 0})`,
    }),
    [stats],
  );

  const columns: Column<InventoryItem>[] = [
    {
      id: 'sn',
      label: 'SN',
      align: 'right',
      minWidth: 48,
      render: (row) => {
        const idx = items.findIndex((i) => i.id === row.id);
        return idx >= 0 ? page * pageSize + idx + 1 : '—';
      },
    },
    { id: 'name', label: 'Product', minWidth: 180, accessor: 'name' },
    { id: 'sku', label: 'SKU', minWidth: 120, accessor: 'sku' },
    { id: 'category', label: 'Category', accessor: 'category' },
    {
      id: 'supplier',
      label: 'Supplier',
      minWidth: 140,
      render: (row) => row.supplierName || '—',
    },
    {
      id: 'stock',
      label: 'Stock',
      align: 'right',
      render: (row) => (
        <Chip
          label={row.stock === 0 ? 'Out' : formatStockQty(row.stock, row.uom ?? '')}
          color={row.stock === 0 ? 'error' : row.stock <= row.lowStockThreshold ? 'warning' : 'success'}
          size="small"
        />
      ),
    },
    {
      id: 'batches',
      label: 'Batches',
      align: 'right',
      render: (row) => row.batchCount ?? row.batches.filter((b) => b.quantity > 0).length,
    },
    {
      id: 'expiry',
      label: 'Nearest Expiry',
      render: (row) => {
        const date = row.nearestExpiry ?? nearestActiveBatch(row)?.expiryDate;
        if (!date) return '—';
        return (
          <Chip
            label={formatExpiryDate(date)}
            size="small"
            color={expiryChipColor(date)}
            variant="outlined"
          />
        );
      },
    },
    {
      id: 'value',
      label: 'Value',
      align: 'right',
      render: (row) => formatCurrency(row.stock * row.costPrice),
    },
    {
      id: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'flex-end' }}>
          {canManage && (
            <Tooltip title="Add stock">
              <IconButton
                size="small"
                color="success"
                onClick={(e) => { e.stopPropagation(); setReceiveTarget(row); }}
                aria-label="Add stock"
              >
                <AddBoxIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {canManage && (
            <Tooltip title="Correct stock">
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); setAdjustTarget(row); }}
                aria-label="Correct stock"
              >
                <TuneIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      ),
    },
  ];

  const handleExportStockLevels = async () => {
    setExporting(true);
    try {
      const pageLimit = 500;
      const baseParams: InventoryQueryParams = {
        search: search || undefined,
        filter,
        pageSize: pageLimit,
        ...(supplierId ? { supplierId } : {}),
        ...(category ? { category } : {}),
      };
      const all: InventoryItem[] = [];
      let pageNum = 1;
      let totalPages = 1;
      do {
        const res = await inventoryService.getAll({ ...baseParams, page: pageNum });
        all.push(...(res.data ?? []));
        totalPages = res.totalPages ?? 1;
        pageNum += 1;
      } while (pageNum <= totalPages);

      downloadCsv(
        `inventory-stock-levels-${dayjs().format('YYYY-MM-DD')}.csv`,
        [
          'Product',
          'SKU',
          'Category',
          'Supplier',
          'Stock',
          'Low threshold',
          'Batch count',
          'Nearest expiry',
          'Cost',
          'Selling',
          'Stock value',
          'Status',
        ],
        all.map((row) => {
          const expiry = row.nearestExpiry ?? nearestActiveBatch(row)?.expiryDate;
          const batchCount = row.batchCount ?? row.batches.filter((b) => b.quantity > 0).length;
          return [
            row.name,
            row.sku,
            row.category,
            row.supplierName || '',
            row.stock,
            row.lowStockThreshold,
            batchCount,
            expiry ? formatExpiryDate(expiry) : '',
            row.costPrice,
            row.sellingPrice,
            Math.round(row.stock * row.costPrice * 100) / 100,
            stockStatus(row),
          ];
        }),
      );
      showSuccess(`Exported ${all.length} product${all.length === 1 ? '' : 's'}.`);
    } catch (err) {
      showApiError(err, 'Failed to export stock levels.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Inventory"
        subtitle="Check stock levels, add new batches, or correct counts. Pack receives go through Purchase Orders."
      />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            title="Total SKUs"
            value={stats?.totalSkus ?? '—'}
            onClick={() => setFilter('all')}
            subtitle="Show all"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            title="Low Stock"
            value={stats?.lowStock ?? '—'}
            color="warning.main"
            onClick={() => setFilter('low')}
            subtitle="Filter low stock"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            title="Out of Stock"
            value={stats?.outOfStock ?? '—'}
            color="error.main"
            onClick={() => setFilter('out')}
            subtitle="Filter out of stock"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            title="Inventory Value"
            value={stats ? formatCurrency(stats.inventoryValue) : '—'}
            subtitle="Batch qty × unit cost (or stock × cost if no batches)"
          />
        </Grid>
      </Grid>

      <Tabs
        value={pageView}
        onChange={(_, v: PageView) => setTab(v)}
        sx={{ mb: 2 }}
      >
        <Tab value="stock" label="Stock Levels" />
        <Tab value="ledger" label="Movement Ledger" />
      </Tabs>

      {pageView === 'stock' && (
        <>
          <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <SearchBar
                value={search}
                onChange={(v) => { setSearch(v); setPage(0); }}
                placeholder="Search products..."
              />
            </Box>
            <TextField
              select
              label="Supplier"
              value={supplierId}
              onChange={(e) => { setSupplierId(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All Suppliers</MenuItem>
              {suppliers.map((s) => (
                <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Category"
              value={category}
              onChange={(e) => { setCategory(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">All Categories</MenuItem>
              {categoryOptions.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={filter}
              onChange={(_, v: StockFilter | null) => {
                if (v) setFilter(v);
              }}
            >
              {STOCK_FILTERS.map((f) => (
                <ToggleButton key={f} value={f}>
                  {filterLabels[f]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => void handleExportStockLevels()}
              loading={exporting}
              disabled={exporting || (data?.total ?? 0) === 0}
            >
              Export CSV
            </Button>
          </Box>

          <DataTable
            columns={columns}
            rows={items}
            loading={isLoading}
            page={page}
            pageSize={pageSize}
            total={data?.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
            onRowClick={(row) => navigate(`/inventory/${row.id}`)}
            getRowId={(r) => r.id}
          />

          <Paper
            variant="outlined"
            sx={{
              mt: 1.5,
              px: 2,
              py: 1.25,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Filtered total ({data?.total ?? 0} product{(data?.total ?? 0) === 1 ? '' : 's'})
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {formatCurrency(data?.totalStockValue ?? 0)}
            </Typography>
          </Paper>
        </>
      )}

      {pageView === 'ledger' && <MovementLedgerTab />}

      <ReceiveStockDialog
        open={!!receiveTarget}
        item={receiveTarget}
        suppliers={suppliers}
        loading={receiveMutation.isPending}
        onClose={() => setReceiveTarget(null)}
        onSubmit={(payload) => {
          receiveMutation.mutate(payload, {
            onSuccess: () => {
              showSuccess('Stock received.');
              setReceiveTarget(null);
            },
            onError: (err) => showApiError(err, 'Inventory receive failed.'),
          });
        }}
      />

      <AdjustStockDialog
        open={!!adjustTarget}
        item={adjustTarget}
        createdBy={currentUser?.name ?? 'User'}
        loading={adjustMutation.isPending}
        onClose={() => setAdjustTarget(null)}
        onSubmit={(payload) => {
          adjustMutation.mutate(payload, {
            onSuccess: () => {
              showSuccess('Stock corrected.');
              setAdjustTarget(null);
            },
            onError: (err) => showApiError(err, 'Inventory update failed.'),
          });
        }}
      />
    </Box>
  );
}
