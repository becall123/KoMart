import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Grid,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { StatCard } from '@/components/common/StatCard';
import { NepaliAwareDatePicker } from '@/components/common/NepaliAwareDatePicker';
import { useInventoryMovements, useMovementSummary } from '@/hooks/useInventory';
import { formatAmount, formatDateTime } from '@/utils';
import type { InventoryMovement, InventoryMovementQueryParams } from '@/types';
import dayjs from 'dayjs';

const MOVEMENT_TYPES: { value: InventoryMovementQueryParams['movementType']; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'sale', label: 'Sale' },
  { value: 'receive', label: 'Stock In' },
  { value: 'purchase_order', label: 'PO Receive' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'damaged', label: 'Damaged / Expired' },
  { value: 'correction', label: 'Correction' },
];

interface MovementLedgerTabProps {
  productId?: string;
  hideProductColumn?: boolean;
}

export function MovementLedgerTab({ productId, hideProductColumn }: MovementLedgerTabProps) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [movementType, setMovementType] = useState<InventoryMovementQueryParams['movementType']>('');
  const [startDate, setStartDate] = useState(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState(dayjs().format('YYYY-MM-DD'));

  const filterParams = useMemo(
    (): InventoryMovementQueryParams => ({
      page: page + 1,
      pageSize,
      productId: productId || undefined,
      search: productId ? undefined : search || undefined,
      direction: direction || undefined,
      movementType: movementType || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [page, pageSize, productId, search, direction, movementType, startDate, endDate],
  );

  const summaryParams = useMemo(
    () => {
      const { page: _p, pageSize: _s, ...rest } = filterParams;
      return rest;
    },
    [filterParams],
  );

  const { data, isLoading } = useInventoryMovements(filterParams);
  const { data: summary } = useMovementSummary(summaryParams);

  const columns: Column<InventoryMovement>[] = [
    {
      id: 'when',
      label: 'Date',
      minWidth: 160,
      render: (row) => formatDateTime(row.createdAt),
    },
    ...(!hideProductColumn
      ? [{
          id: 'product',
          label: 'Product',
          minWidth: 160,
          render: (row: InventoryMovement) => (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{row.productName}</Typography>
              <Typography variant="caption" color="text.secondary">{row.productSku}</Typography>
            </Box>
          ),
        }]
      : []),
    {
      id: 'movement',
      label: 'Movement',
      render: (row) => (
        <Chip label={row.movementLabel} size="small" variant="outlined" />
      ),
    },
    {
      id: 'direction',
      label: 'Dir',
      render: (row) => (
        <Chip
          label={row.direction === 'in' ? 'IN' : 'OUT'}
          size="small"
          color={row.direction === 'in' ? 'success' : 'error'}
        />
      ),
    },
    {
      id: 'qty',
      label: 'Qty',
      align: 'right',
      render: (row) => (
        <Typography
          component="span"
          sx={{ fontWeight: 700, color: row.quantity >= 0 ? 'success.main' : 'error.main' }}
        >
          {row.quantity >= 0 ? `+${row.quantity}` : row.quantity}
        </Typography>
      ),
    },
    {
      id: 'cost',
      label: 'Cost',
      align: 'right',
      render: (row) => (
        row.extendedCost
          ? formatAmount(row.extendedCost)
          : row.unitCost
            ? formatAmount(row.unitCost)
            : '—'
      ),
    },
    { id: 'before', label: 'Before', align: 'right', render: (row) => row.stockBefore },
    { id: 'after', label: 'After', align: 'right', render: (row) => row.stockAfter },
    {
      id: 'reference',
      label: 'Reference',
      minWidth: 140,
      render: (row) => {
        if (row.referenceType === 'sale' && row.referenceId) {
          return (
            <Button
              onClick={() => window.open(`/sales/${row.referenceId}`, '_blank')}
              size="small"
              variant="text"
              sx={{ textTransform: 'none', p: 0, minWidth: 0, cursor: 'pointer' }}
            >
              {row.transactionNumber || row.referenceLabel}
            </Button>
          );
        }
        if (row.referenceType === 'purchase_order' && row.referenceId) {
          return (
            <Button
              onClick={() => window.open(`/purchase-orders/${row.referenceId}`, '_blank')}
              size="small"
              variant="text"
              sx={{ textTransform: 'none', p: 0, minWidth: 0, cursor: 'pointer' }}
            >
              PO
            </Button>
          );
        }
        return row.referenceLabel || '—';
      },
    },
    { id: 'by', label: 'By', render: (row) => row.createdBy },
    { id: 'reason', label: 'Reason', minWidth: 140, render: (row) => row.reason },
  ];

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard title="Movements" value={summary?.movementCount ?? '—'} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard title="Total In" value={summary?.totalIn ?? '—'} color="success.main" />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard title="Total Out" value={summary?.totalOut ?? '—'} color="error.main" />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            title="Net Change"
            value={
              summary
                ? summary.totalIn - summary.totalOut
                : '—'
            }
          />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} sx={{ alignItems: 'center' }}>
          {!productId && (
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                label="Search product"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="Name or SKU"
              />
            </Grid>
          )}
          <Grid size={{ xs: 6, sm: 4, md: 2 }}>
            <TextField
              select
              fullWidth
              size="small"
              label="Direction"
              value={direction}
              onChange={(e) => { setDirection(e.target.value as '' | 'in' | 'out'); setPage(0); }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="in">Stock In</MenuItem>
              <MenuItem value="out">Stock Out</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 6, sm: 4, md: 2 }}>
            <TextField
              select
              fullWidth
              size="small"
              label="Type"
              value={movementType ?? ''}
              onChange={(e) => {
                setMovementType(e.target.value as InventoryMovementQueryParams['movementType']);
                setPage(0);
              }}
            >
              {MOVEMENT_TYPES.map((t) => (
                <MenuItem key={t.value ?? 'all'} value={t.value ?? ''}>{t.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 6, sm: 4, md: 2 }}>
            <NepaliAwareDatePicker
              label="From"
              value={startDate}
              onChange={(d) => { setStartDate(d); setPage(0); }}
              size="small"
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 4, md: 2 }}>
            <NepaliAwareDatePicker
              label="To"
              value={endDate}
              onChange={(d) => { setEndDate(d); setPage(0); }}
              size="small"
              fullWidth
            />
          </Grid>
        </Grid>
      </Paper>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        loading={isLoading}
        page={page}
        pageSize={pageSize}
        total={data?.total}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        getRowId={(r) => r.id}
        onRowClick={(row) => {
          if (!productId) {
            navigate(`/inventory/${row.productId}`);
          }
        }}
        emptyMessage="No inventory movements in this period"
      />
    </Box>
  );
}
