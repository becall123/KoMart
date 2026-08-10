import { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { NepaliAwareDatePicker } from '@/components/common/NepaliAwareDatePicker';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { AUDIT_ACTION_LABELS, AUDIT_MODULE_LABELS } from '@/constants';
import { formatAuditAction, formatAuditField, formatDateTime, summarizeAuditValues } from '@/utils';
import type { AuditLog, AuditModule } from '@/types';

const MODULES: AuditModule[] = [
  'auth',
  'products',
  'inventory',
  'sales',
  'purchase_orders',
  'settings',
  'users',
  'expenses',
  'accounts',
];

function entityLabel(row: AuditLog): string {
  if (!row.entityType) return '—';
  const labels: Record<string, string> = {
    day_close: 'Day close',
    cash_custody: 'Staff custody',
    wallet_transfer: 'Transfer',
    wallet_adjustment: 'Adjustment',
    store_settings: 'Store settings',
  };
  const type = labels[row.entityType] ?? row.entityType.replace(/_/g, ' ');
  return row.entityId ? `${type} · …${row.entityId.slice(-6)}` : type;
}

export function AuditLogsTab() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [moduleFilter, setModuleFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const queryParams = useMemo(
    () => ({
      page: page + 1,
      pageSize,
      module: moduleFilter || undefined,
      action: actionFilter || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [page, pageSize, moduleFilter, actionFilter, startDate, endDate],
  );

  const { data, isLoading } = useAuditLogs(queryParams);

  const columns: Column<AuditLog>[] = [
    {
      id: 'when',
      label: 'Date',
      minWidth: 160,
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      id: 'user',
      label: 'User',
      minWidth: 140,
      render: (row) => row.userName || row.userEmail || '—',
    },
    {
      id: 'module',
      label: 'Module',
      render: (row) => (
        <Chip
          label={AUDIT_MODULE_LABELS[row.module] ?? row.module}
          size="small"
          variant="outlined"
        />
      ),
    },
    {
      id: 'action',
      label: 'Action',
      minWidth: 180,
      render: (row) => AUDIT_ACTION_LABELS[row.action] ?? formatAuditAction(row.action),
    },
    {
      id: 'entity',
      label: 'Entity',
      minWidth: 160,
      render: (row) => entityLabel(row),
    },
    {
      id: 'summary',
      label: 'Summary',
      minWidth: 220,
      render: (row) => (
        <Typography variant="body2" color="text.secondary" noWrap title={summarizeAuditValues(row.newValue)}>
          {summarizeAuditValues(row.newValue)}
        </Typography>
      ),
    },
    {
      id: 'device',
      label: 'Device',
      render: (row) => `${row.browser} / ${row.device}`,
    },
  ];

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Module</InputLabel>
              <Select
                label="Module"
                value={moduleFilter}
                onChange={(e) => { setModuleFilter(e.target.value); setPage(0); }}
              >
                <MenuItem value="">All</MenuItem>
                {MODULES.map((m) => (
                  <MenuItem key={m} value={m}>
                    {AUDIT_MODULE_LABELS[m]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              fullWidth
              size="small"
              label="Action"
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
              placeholder="e.g. wallet_transfer, day_close"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <NepaliAwareDatePicker
              label="From"
              value={startDate}
              onChange={(d) => { setStartDate(d); setPage(0); }}
              size="small"
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
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
        getRowId={(row) => row.id}
        onRowClick={setSelected}
        emptyMessage="No audit logs found"
      />

      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="md" fullWidth>
        <DialogTitle>Audit Log Detail</DialogTitle>
        <DialogContent dividers>
          {selected && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="body2">
                <strong>When:</strong> {formatDateTime(selected.createdAt)}
              </Typography>
              <Typography variant="body2">
                <strong>User:</strong> {selected.userName} ({selected.userEmail})
              </Typography>
              <Typography variant="body2">
                <strong>Action:</strong>{' '}
                {AUDIT_MODULE_LABELS[selected.module] ?? selected.module} —{' '}
                {AUDIT_ACTION_LABELS[selected.action] ?? formatAuditAction(selected.action)}
              </Typography>
              <Typography variant="body2">
                <strong>Entity:</strong> {entityLabel(selected)}
              </Typography>
              <Typography variant="body2">
                <strong>Request ID:</strong> {selected.requestId || '—'}
              </Typography>
              <Typography variant="body2">
                <strong>Client:</strong> {selected.browser} on {selected.device} — {selected.ipAddress || '—'}
              </Typography>
              <Box>
                <Typography variant="subtitle2" gutterBottom>Previous</Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {summarizeAuditValues(selected.previousValue)}
                </Typography>
                {Object.keys(selected.previousValue).length > 0 && (
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {Object.entries(selected.previousValue).map(([k, v]) => (
                      <Typography key={k} component="li" variant="body2">
                        {formatAuditField(k, v)}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>New</Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {summarizeAuditValues(selected.newValue)}
                </Typography>
                {Object.keys(selected.newValue).length > 0 && (
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {Object.entries(selected.newValue).map(([k, v]) => (
                      <Typography key={k} component="li" variant="body2">
                        {formatAuditField(k, v)}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
