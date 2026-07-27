import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchBar } from '@/components/common/SearchBar';
import { DateRangePicker } from '@/components/common/DateRangePicker';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatCard } from '@/components/common/StatCard';
import { useExpenses, useExpenseStats, useDeleteExpense } from '@/hooks/useExpenses';
import { useExpenseCategoryLabelMap, useExpenseCategoryOptions } from '@/hooks/useExpenseCategories';
import { formatCurrency, isAdminOrManager } from '@/utils';
import { useFormatDate } from '@/hooks/useFormatDate';
import { showApiError, showSuccess } from '@/utils/toast';
import { useAuthStore } from '@/store';
import type { Expense } from '@/types';
import { ExpenseCategoryInfoIcon } from './expenseCategoryInfo';

const CATEGORY_COLOR: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  setup_investment: 'secondary',
  purchase_order: 'info',
  rent: 'primary',
  utilities: 'info',
  salaries: 'warning',
  marketing: 'success',
  supplies: 'default',
  maintenance: 'default',
  equipment: 'primary',
  other: 'default',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function ExpensesPage() {
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const user = useAuthStore((s) => s.user);
  const canManage = isAdminOrManager(user?.role);
  const categoryOptions = useExpenseCategoryOptions();
  const categoryLabels = useExpenseCategoryLabelMap();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [setupFilter, setSetupFilter] = useState('');
  const [startDate, setStartDate] = useState(monthStartIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const categoryLabel = (value: string) => categoryLabels.get(value) ?? value;

  const listParams = {
    search: search || undefined,
    category: category || undefined,
    isSetupCost: setupFilter || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page: page + 1,
    pageSize,
  };

  const { data, isLoading } = useExpenses(listParams);
  const { data: stats, isLoading: statsLoading } = useExpenseStats();
  const deleteMutation = useDeleteExpense();

  const rows = data?.data ?? [];
  const deleteTarget = deleteId ? rows.find((r) => r.id === deleteId) : undefined;

  const columns: Column<Expense>[] = [
    {
      id: 'date',
      label: 'Date',
      minWidth: 100,
      render: (row) => (
        <Typography variant="body2">{formatDate(row.date)}</Typography>
      ),
    },
    {
      id: 'title',
      label: 'Title',
      minWidth: 200,
      render: (row) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {row.title}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
            {row.isSetupCost && (
              <Chip label="Setup" size="small" color="secondary" sx={{ height: 18, fontSize: '0.6rem' }} />
            )}
            {row.purchaseOrderId && (
              <Chip
                label="PO payment"
                size="small"
                color="info"
                variant="outlined"
                clickable
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/purchase-orders/${row.purchaseOrderId}`);
                }}
                sx={{ height: 18, fontSize: '0.6rem' }}
              />
            )}
          </Box>
        </Box>
      ),
    },
    {
      id: 'category',
      label: 'Category',
      minWidth: 140,
      render: (row) => (
        <Chip
          label={categoryLabel(row.category)}
          color={CATEGORY_COLOR[row.category] ?? 'default'}
          size="small"
          variant="outlined"
        />
      ),
    },
    {
      id: 'billNo',
      label: 'Bill no.',
      minWidth: 120,
      render: (row) => (
        <Typography variant="body2" color="text.secondary">
          {row.billNo?.trim() ? row.billNo : '—'}
        </Typography>
      ),
    },
    {
      id: 'paidTo',
      label: 'Paid To',
      minWidth: 160,
      render: (row) => (
        <Typography variant="body2" color="text.secondary">
          {row.paidTo ?? '—'}
        </Typography>
      ),
    },
    {
      id: 'amount',
      label: 'Amount',
      align: 'right',
      minWidth: 120,
      render: (row) => (
        <Typography variant="body2" sx={{ fontWeight: 700, color: 'error.main' }}>
          {formatCurrency(row.amount)}
        </Typography>
      ),
    },
    ...(canManage ? [{
      id: 'actions',
      label: '',
      align: 'right' as const,
      minWidth: 80,
      render: (row: Expense) => (
        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
          {!row.purchaseOrderId && (
            <Tooltip title="Edit">
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); navigate(`/expenses/${row.id}/edit`); }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={row.purchaseOrderId ? 'Delete (reverses PO payment)' : 'Delete'}>
            <IconButton
              size="small"
              color="error"
              onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    }] : []),
  ];

  return (
    <Box>
      <PageHeader
        title="Expenses"
        subtitle="Track operational costs, PO payments, and setup investments"
        action={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/expenses/new')}>
              Add Expense
            </Button>
          ) : undefined
        }
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
        <StatCard
          title="Total Expenses"
          value={statsLoading ? '—' : formatCurrency(stats?.totalExpenses ?? 0)}
          icon={<TrendingUpIcon />}
          color="error.main"
        />
        <StatCard
          title="Operating Expenses"
          value={statsLoading ? '—' : formatCurrency(stats?.operatingExpenses ?? Math.max(0, (stats?.totalExpenses ?? 0) - (stats?.setupInvestment ?? 0)))}
          icon={<AccountBalanceWalletIcon />}
          color="warning.main"
          subtitle="Excludes setup / investment"
        />
        <StatCard
          title="This Month"
          value={statsLoading ? '—' : formatCurrency(stats?.thisMonth ?? 0)}
          icon={<CalendarTodayIcon />}
          color="info.main"
        />
        <StatCard
          title="Setup / Investment"
          value={statsLoading ? '—' : formatCurrency(stats?.setupInvestment ?? 0)}
          icon={<BusinessCenterIcon />}
          color="secondary.main"
          subtitle="Setup flag or Setup / Investment category"
        />
      </Box>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <SearchBar
              value={search}
              onChange={(v) => { setSearch(v); setPage(0); }}
              placeholder="Search expenses..."
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Category</InputLabel>
              <Select
                label="Category"
                value={category}
                onChange={(e) => { setCategory(e.target.value); setPage(0); }}
              >
                <MenuItem value="">All Categories</MenuItem>
                {categoryOptions.map((c) => (
                  <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <ExpenseCategoryInfoIcon />
          </Box>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Setup filter</InputLabel>
            <Select
              label="Setup filter"
              value={setupFilter}
              onChange={(e) => { setSetupFilter(e.target.value); setPage(0); }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="true">Setup only</MenuItem>
              <MenuItem value="false">Operating only</MenuItem>
            </Select>
          </FormControl>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(range) => {
              setStartDate(range.startDate);
              setEndDate(range.endDate);
              setPage(0);
            }}
          />
        </Box>
      </Paper>

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
        getRowId={(r) => r.id}
      />

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Expense"
        message={
          deleteTarget?.purchaseOrderId
            ? 'This expense was created from a purchase order payment. Deleting it will reverse that payment on the PO.'
            : 'This will permanently delete the expense record. This action cannot be undone.'
        }
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId) {
            deleteMutation.mutate(deleteId, {
              onSuccess: () => {
                showSuccess(deleteTarget?.purchaseOrderId ? 'Expense deleted and PO payment reversed.' : 'Expense deleted.');
                setDeleteId(null);
              },
              onError: (err) => showApiError(err, 'Expense could not be deleted.'),
            });
          }
        }}
        onCancel={() => setDeleteId(null)}
      />
    </Box>
  );
}
