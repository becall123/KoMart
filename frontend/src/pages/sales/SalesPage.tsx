import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchBar } from '@/components/common/SearchBar';
import { DateRangePicker } from '@/components/common/DateRangePicker';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { useTransactions } from '@/hooks/useTransactions';
import { formatCurrency, formatDateTime, isAdmin } from '@/utils';
import { PAYMENT_METHODS } from '@/constants';
import { useAuthStore } from '@/store';
import type { PaymentMethod, Transaction } from '@/types';
import { SaleDetailView } from './SaleDetailView';
import dayjs from 'dayjs';

export function SalesPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [status, setStatus] = useState<'all' | 'completed' | 'voided'>('all');
  const [dateRange, setDateRange] = useState({
    startDate: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
    endDate: dayjs().format('YYYY-MM-DD'),
  });
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const SORT_KEY_MAP: Record<string, string> = {
    transactionNumber: 'transaction_number',
    customerName: 'customer_name',
    total: 'total',
    discount: 'discount',
    paymentMethod: 'payment_method',
    createdBy: 'created_by',
    createdAt: 'created_at',
  };

  const { data, isLoading } = useTransactions({
    search,
    page: page + 1,
    pageSize,
    paymentMethod: paymentMethod || undefined,
    status: status === 'all' ? undefined : status,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    sortBy: sortBy ? SORT_KEY_MAP[sortBy] : undefined,
    sortOrder,
  });

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder('desc');
    }
    setPage(0);
  };

  const columns: Column<Transaction>[] = [
    {
      id: 'serial',
      label: 'S.N',
      minWidth: 60,
      align: 'center',
      render: (_, index) => String(index + 1),
    },
    { id: 'number', label: 'Bill No', minWidth: 160, accessor: 'transactionNumber', sortable: true, sortKey: 'transactionNumber' },
    { id: 'customer', label: 'Customer', render: (r) => r.customerName ?? 'Walk-In', sortable: true, sortKey: 'customerName' },
    {
      id: 'items',
      label: 'Items',
      align: 'right',
      render: (r) => (
        <Typography
          component="button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedTransaction(r);
          }}
          sx={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'primary.main',
            textDecoration: 'underline',
            fontWeight: 600,
            fontFamily: 'inherit',
            fontSize: 'inherit',
          }}
        >
          {r.items.length}
        </Typography>
      ),
    },
    {
      id: 'total',
      label: 'Total',
      align: 'right',
      render: (r) => formatCurrency(r.total),
      sortable: true,
      sortKey: 'total',
    },
    {
      id: 'discount',
      label: 'Discount',
      align: 'right',
      render: (r) => {
        const saved = (r.subtotal ?? 0) - (r.total ?? 0) + (r.tax ?? 0);
        return saved > 0 ? (
          <Typography component="span" variant="body2" color="success.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            − {formatCurrency(saved)}
          </Typography>
        ) : '—';
      },
      sortable: true,
      sortKey: 'discount',
    },
    {
      id: 'payment',
      label: 'Payment',
      render: (r) => r.paymentMethod.toUpperCase(),
      sortable: true,
      sortKey: 'paymentMethod',
    },
    { id: 'cashier', label: 'Cashier', accessor: 'createdBy', sortable: true, sortKey: 'createdBy' },
    {
      id: 'date',
      label: 'Date',
      render: (r) => formatDateTime(r.createdAt),
      sortable: true,
      sortKey: 'createdAt',
    },
    {
      id: 'status',
      label: 'Status',
      minWidth: 110,
      align: 'center',
      render: (r) => (
        <Typography
          component="span"
          variant="caption"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 999,
            px: 1.25,
            py: 0.5,
            fontWeight: 700,
            letterSpacing: 0.25,
            backgroundColor: r.status === 'voided' ? 'error.light' : 'success.light',
            color: r.status === 'voided' ? 'error.dark' : 'success.dark',
          }}
        >
          {r.status === 'voided' ? 'Voided' : 'Completed'}
        </Typography>
      ),
    },
    {
      id: 'action',
      label: 'Action',
      minWidth: 120,
      align: 'center',
      render: (r) => (
        <Button
          size="small"
          variant="outlined"
          onClick={(event) => {
            event.stopPropagation();
            window.open(`/sales/${r.id}`, '_blank', 'noopener,noreferrer');
          }}
        >
          View Detail
        </Button>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Sales"
        subtitle={`${data?.total ?? 0} transactions`}
        subtitleEndLabel="Total Amount"
        subtitleEnd={formatCurrency(data?.totalAmount ?? 0)}
        action={
          isAdmin(user?.role) ? (
            <Button
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => navigate('/sales/backfill')}
            >
              Backfill Sales
            </Button>
          ) : undefined
        }
      />

      <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <SearchBar
            value={search}
            onChange={(v) => { setSearch(v); setPage(0); }}
            placeholder="Search bill no. or customer..."
          />
        </Box>
        <TextField
          select
          size="small"
          label="Payment"
          value={paymentMethod}
          onChange={(e) => { setPaymentMethod(e.target.value as PaymentMethod | ''); setPage(0); }}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          {PAYMENT_METHODS.map((m) => (
            <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => { setStatus(e.target.value as 'all' | 'completed' | 'voided'); setPage(0); }}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="completed">Completed</MenuItem>
          <MenuItem value="voided">Voided</MenuItem>
        </TextField>
        <DateRangePicker
          startDate={dateRange.startDate}
          endDate={dateRange.endDate}
          onChange={(range) => { setDateRange(range); setPage(0); }}
        />
      </Box>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        loading={isLoading}
        page={page}
        pageSize={pageSize}
        total={data?.total}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        onRowDoubleClick={(row) => navigate(`/sales/${row.id}`)}
        getRowId={(r) => r.id}
      />

      <Dialog open={!!selectedTransaction} onClose={() => setSelectedTransaction(null)} maxWidth="lg" fullWidth>
        <DialogTitle>Sale Detail — {selectedTransaction?.transactionNumber}</DialogTitle>
        <DialogContent dividers sx={{ p: 3 }}>
          {selectedTransaction && <SaleDetailView transaction={selectedTransaction} />}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button variant="contained" onClick={() => setSelectedTransaction(null)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
