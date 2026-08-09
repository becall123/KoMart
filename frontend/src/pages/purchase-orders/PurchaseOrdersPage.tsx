import { useState } from 'react';
import { Box, Button, Chip, MenuItem, Paper, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchBar } from '@/components/common/SearchBar';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { formatCurrency, canManagePurchaseOrders } from '@/utils';
import { useFormatDate } from '@/hooks/useFormatDate';
import { PO_PAYMENT_STATUS_LABELS, PO_STATUS_LABELS } from '@/constants';
import type { PurchaseOrder, PurchaseOrderPaymentStatus, PurchaseOrderStatus } from '@/types';
import { useAuthStore } from '@/store';

const STATUS_COLORS: Record<PurchaseOrderStatus, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  draft: 'default',
  ordered: 'warning',
  partial: 'info',
  received: 'success',
  cancelled: 'error',
};

const PAYMENT_COLORS: Record<PurchaseOrderPaymentStatus, 'default' | 'warning' | 'success'> = {
  unpaid: 'default',
  partial: 'warning',
  paid: 'success',
};

const PO_STATUS_OPTIONS: PurchaseOrderStatus[] = [
  'draft',
  'ordered',
  'partial',
  'received',
  'cancelled',
];

const PO_PAYMENT_OPTIONS: PurchaseOrderPaymentStatus[] = [
  'unpaid',
  'partial',
  'paid',
];

export function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const user = useAuthStore((s) => s.user);
  const canManage = canManagePurchaseOrders(user?.role);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('ordered');
  const [paymentStatus, setPaymentStatus] = useState<PurchaseOrderPaymentStatus | ''>('unpaid');

  const { data, isLoading } = usePurchaseOrders({
    search,
    page: page + 1,
    pageSize: 10,
    status: status || undefined,
    paymentStatus: paymentStatus || undefined,
  });
  const rows = data?.data ?? [];

  const columns: Column<PurchaseOrder>[] = [
    {
      id: 'sn',
      label: 'SN',
      align: 'center',
      minWidth: 48,
      render: (row) => rows.findIndex((r) => r.id === row.id) + 1,
    },
    { id: 'orderNumber', label: 'PO Number', minWidth: 140, accessor: 'orderNumber' },
    { id: 'supplier', label: 'Supplier', accessor: 'supplierName' },
    {
      id: 'status',
      label: 'Status',
      render: (row) => (
        <Chip
          label={PO_STATUS_LABELS[row.status] ?? row.status}
          color={STATUS_COLORS[row.status]}
          size="small"
        />
      ),
    },
    {
      id: 'payment',
      label: 'Payment',
      render: (row) => {
        const pay = row.paymentStatus ?? 'unpaid';
        return (
          <Chip
            label={PO_PAYMENT_STATUS_LABELS[pay] ?? pay}
            color={PAYMENT_COLORS[pay]}
            size="small"
            variant="outlined"
          />
        );
      },
    },
    {
      id: 'items',
      label: 'Items',
      align: 'right',
      render: (row) => row.items.length,
    },
    {
      id: 'total',
      label: 'Total',
      align: 'right',
      render: (row) => formatCurrency(row.totalAmount),
    },
    {
      id: 'paid',
      label: 'Paid',
      align: 'right',
      render: (row) => formatCurrency(row.amountPaid ?? 0),
    },
    {
      id: 'orderedBy',
      label: 'Ordered By',
      render: (row) => row.orderedBy ?? '—',
    },
    {
      id: 'delivery',
      label: 'Expected Delivery',
      render: (row) => row.expectedDelivery ? formatDate(row.expectedDelivery) : '—',
    },
    {
      id: 'receivedDate',
      label: 'Received Date',
      render: (row) => row.receivedDate ? formatDate(row.receivedDate) : '—',
    },
    {
      id: 'created',
      label: 'Created',
      render: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Purchase Orders"
        subtitle={`${data?.total ?? 0} orders`}
        action={
          canManage ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/purchase-orders/new')}
            >
              Create Order
            </Button>
          ) : undefined
        }
      />

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        <Paper
          variant="outlined"
          sx={{ px: 2, py: 1.5, display: 'inline-flex', alignItems: 'baseline', gap: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            Total Received Value
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
            {formatCurrency(data?.receivedTotalAmount ?? 0)}
          </Typography>
        </Paper>
        <Paper
          variant="outlined"
          sx={{ px: 2, py: 1.5, display: 'inline-flex', alignItems: 'baseline', gap: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            Outstanding Payable
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'warning.main' }}>
            {formatCurrency(data?.outstandingAmount ?? 0)}
          </Typography>
        </Paper>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <SearchBar
            value={search}
            onChange={(v) => { setSearch(v); setPage(0); }}
            placeholder="Search by PO number or supplier..."
          />
        </Box>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as PurchaseOrderStatus | '');
            setPage(0);
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All</MenuItem>
          {PO_STATUS_OPTIONS.map((value) => (
            <MenuItem key={value} value={value}>
              {PO_STATUS_LABELS[value]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Payment"
          value={paymentStatus}
          onChange={(e) => {
            setPaymentStatus(e.target.value as PurchaseOrderPaymentStatus | '');
            setPage(0);
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {PO_PAYMENT_OPTIONS.map((value) => (
            <MenuItem key={value} value={value}>
              {PO_PAYMENT_STATUS_LABELS[value]}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        page={page}
        pageSize={10}
        total={data?.total}
        onPageChange={setPage}
        getRowId={(r) => r.id}
        onRowClick={(r) => navigate(`/purchase-orders/${r.id}`)}
      />
    </Box>
  );
}
