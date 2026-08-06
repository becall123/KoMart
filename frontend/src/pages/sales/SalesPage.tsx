import { useState } from 'react';
import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchBar } from '@/components/common/SearchBar';
import { DateRangePicker } from '@/components/common/DateRangePicker';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { useTransactions } from '@/hooks/useTransactions';
import { formatCurrency, isAdmin } from '@/utils';
import { useFormatDate } from '@/hooks/useFormatDate';
import { PAYMENT_METHODS } from '@/constants';
import { useAuthStore } from '@/store';
import type { PaymentMethod, Transaction } from '@/types';
import dayjs from 'dayjs';

export function SalesPage() {
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [dateRange, setDateRange] = useState({
    startDate: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
    endDate: dayjs().format('YYYY-MM-DD'),
  });

  const { data, isLoading } = useTransactions({
    search,
    page: page + 1,
    pageSize,
    paymentMethod: paymentMethod || undefined,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const columns: Column<Transaction>[] = [
    { id: 'number', label: 'Bill No', minWidth: 160, accessor: 'transactionNumber' },
    { id: 'customer', label: 'Customer', render: (r) => r.customerName ?? 'Walk-In' },
    { id: 'items', label: 'Items', align: 'right', render: (r) => r.items.length },
    {
      id: 'total',
      label: 'Total',
      align: 'right',
      render: (r) => formatCurrency(r.total),
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
    },
    {
      id: 'payment',
      label: 'Payment',
      render: (r) => r.paymentMethod.toUpperCase(),
    },
    { id: 'cashier', label: 'Cashier', accessor: 'createdBy' },
    {
      id: 'date',
      label: 'Date',
      render: (r) => formatDate(r.createdAt),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Sales"
        subtitle={`${data?.total ?? 0} transactions`}
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
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        onRowClick={(row) => navigate(`/sales/${row.id}`)}
        getRowId={(r) => r.id}
      />
    </Box>
  );
}
