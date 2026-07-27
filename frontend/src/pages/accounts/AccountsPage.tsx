import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TuneIcon from '@mui/icons-material/Tune';
import TodayIcon from '@mui/icons-material/Today';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { NepaliAwareDatePicker } from '@/components/common/NepaliAwareDatePicker';
import { StatCard } from '@/components/common/StatCard';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { PAYMENT_METHODS } from '@/constants';
import {
  useWalletAdjustment,
  useWalletBalances,
  useWalletLedger,
  useWalletTransfer,
} from '@/hooks/useWallets';
import { useAuthStore } from '@/store';
import { formatCurrency, isAdminOrManager } from '@/utils';
import { useFormatDate } from '@/hooks/useFormatDate';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import type { WalletCode, WalletLedgerEntry } from '@/types';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function walletLabel(code: string) {
  return PAYMENT_METHODS.find((p) => p.value === code)?.label ?? code;
}

function entryTypeLabel(type: string) {
  const map: Record<string, string> = {
    sale: 'Sale',
    expense: 'Expense',
    po_payment: 'PO payment',
    transfer: 'Transfer',
    adjustment: 'Adjustment',
    opening: 'Opening',
    void_reversal: 'Void reversal',
  };
  return map[type] ?? type;
}

export function AccountsPage() {
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const user = useAuthStore((s) => s.user);
  const canAdjust = isAdminOrManager(user?.role);

  const [walletFilter, setWalletFilter] = useState<'' | WalletCode>('');
  const [dateFrom, setDateFrom] = useState(monthStartIso);
  const [dateTo, setDateTo] = useState(todayIso);

  const [transferOpen, setTransferOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [formError, setFormError] = useState('');

  const [fromWallet, setFromWallet] = useState<WalletCode>('cash');
  const [toWallet, setToWallet] = useState<WalletCode>('bank');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDate, setTransferDate] = useState(todayIso);
  const [transferRemarks, setTransferRemarks] = useState('');

  const [adjustWallet, setAdjustWallet] = useState<WalletCode>('cash');
  const [adjustDirection, setAdjustDirection] = useState<'in' | 'out'>('in');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustDate, setAdjustDate] = useState(todayIso);
  const [adjustRemarks, setAdjustRemarks] = useState('');
  const [ledgerPage, setLedgerPage] = useState(0);
  const [ledgerPageSize, setLedgerPageSize] = useState(25);

  const { data: balances, isLoading: balancesLoading, isError: balancesError } = useWalletBalances();
  const ledgerParams = useMemo(
    () => ({
      wallet: walletFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit: 200,
    }),
    [walletFilter, dateFrom, dateTo],
  );
  const { data: ledger = [], isLoading: ledgerLoading, isError: ledgerError } =
    useWalletLedger(ledgerParams);

  const transferMutation = useWalletTransfer();
  const adjustMutation = useWalletAdjustment();

  const ledgerColumns = useMemo<Column<WalletLedgerEntry>[]>(
    () => [
      {
        id: 'date',
        label: 'Date',
        render: (row) => formatDate(row.date),
      },
      {
        id: 'wallet',
        label: 'Wallet',
        render: (row) => walletLabel(String(row.wallet)),
      },
      {
        id: 'entryType',
        label: 'Type',
        render: (row) => entryTypeLabel(row.entryType),
      },
      {
        id: 'direction',
        label: 'Direction',
        render: (row) => (
          <Typography component="span" sx={{ textTransform: 'uppercase' }}>
            {row.direction}
          </Typography>
        ),
      },
      {
        id: 'amount',
        label: 'Amount',
        align: 'right',
        render: (row) => (
          <Typography
            component="span"
            sx={{
              fontWeight: 600,
              color: row.direction === 'in' ? 'success.main' : 'error.main',
            }}
          >
            {row.direction === 'in' ? '+' : '−'}
            {formatCurrency(row.amount)}
          </Typography>
        ),
      },
      {
        id: 'remarks',
        label: 'Remarks',
        render: (row) => row.remarks || '—',
      },
    ],
    [formatDate],
  );

  const pagedLedger = useMemo(() => {
    const start = ledgerPage * ledgerPageSize;
    return ledger.slice(start, start + ledgerPageSize);
  }, [ledger, ledgerPage, ledgerPageSize]);

  const resetTransfer = () => {
    setFromWallet('cash');
    setToWallet('bank');
    setTransferAmount('');
    setTransferDate(todayIso());
    setTransferRemarks('');
    setFormError('');
  };

  const resetAdjust = () => {
    setAdjustWallet('cash');
    setAdjustDirection('in');
    setAdjustAmount('');
    setAdjustDate(todayIso());
    setAdjustRemarks('');
    setFormError('');
  };

  const handleTransfer = async () => {
    setFormError('');
    const amount = parseFloat(transferAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter a valid amount greater than zero.');
      return;
    }
    if (fromWallet === toWallet) {
      setFormError('Choose different wallets for transfer.');
      return;
    }
    if (!transferRemarks.trim()) {
      setFormError('Remarks are required.');
      return;
    }
    try {
      await transferMutation.mutateAsync({
        fromWallet,
        toWallet,
        amount,
        date: transferDate,
        remarks: transferRemarks.trim(),
      });
      showSuccess('Transfer recorded.');
      setTransferOpen(false);
      resetTransfer();
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  };

  const handleAdjust = async () => {
    setFormError('');
    const amount = parseFloat(adjustAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter a valid amount greater than zero.');
      return;
    }
    if (!adjustRemarks.trim()) {
      setFormError('Remarks are required.');
      return;
    }
    try {
      await adjustMutation.mutateAsync({
        wallet: adjustWallet,
        amount,
        direction: adjustDirection,
        date: adjustDate,
        remarks: adjustRemarks.trim(),
      });
      showSuccess('Adjustment recorded.');
      setAdjustOpen(false);
      resetAdjust();
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  };

  return (
    <Box>
      <PageHeader
        title="Accounts"
        subtitle="Cash, Bank, and eSewa balances, transfers, and statement"
        breadcrumbs={[{ label: 'Accounts' }]}
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<TodayIcon />}
              onClick={() => navigate('/reports/daily')}
            >
              Open Day Cash Book
            </Button>
            <Button
              variant="outlined"
              startIcon={<SwapHorizIcon />}
              onClick={() => {
                resetTransfer();
                setTransferOpen(true);
              }}
            >
              Transfer
            </Button>
            {canAdjust && (
              <Button
                variant="contained"
                startIcon={<TuneIcon />}
                onClick={() => {
                  resetAdjust();
                  setAdjustOpen(true);
                }}
              >
                Adjust
              </Button>
            )}
          </Box>
        }
      />

      {(balancesError || ledgerError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load wallet accounts.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        {(['cash', 'bank', 'esewa'] as const).map((w) => (
          <Grid key={w} size={{ xs: 12, sm: 4 }}>
            <StatCard
              title={walletLabel(w)}
              value={balancesLoading ? '—' : formatCurrency(balances?.[w] ?? 0)}
              subtitle={balances?.asOf ? `As of ${formatDate(balances.asOf)}` : undefined}
              color={w === 'cash' ? 'success.main' : w === 'bank' ? 'primary.main' : 'info.main'}
            />
          </Grid>
        ))}
      </Grid>

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
          Statement
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Wallet</InputLabel>
            <Select
              label="Wallet"
              value={walletFilter}
              onChange={(e) => {
                setWalletFilter(e.target.value as '' | WalletCode);
                setLedgerPage(0);
              }}
            >
              <MenuItem value="">All</MenuItem>
              {PAYMENT_METHODS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <NepaliAwareDatePicker
            label="From"
            value={dateFrom}
            onChange={(v) => {
              setDateFrom(v);
              setLedgerPage(0);
            }}
            size="small"
          />
          <NepaliAwareDatePicker
            label="To"
            value={dateTo}
            onChange={(v) => {
              setDateTo(v);
              setLedgerPage(0);
            }}
            size="small"
          />
        </Box>

        <DataTable
          columns={ledgerColumns}
          rows={pagedLedger}
          loading={ledgerLoading}
          page={ledgerPage}
          pageSize={ledgerPageSize}
          total={ledger.length}
          onPageChange={setLedgerPage}
          onPageSizeChange={(size) => {
            setLedgerPageSize(size);
            setLedgerPage(0);
          }}
          emptyMessage="No ledger entries in this range."
          getRowId={(row) => row.id}
        />
      </Box>

      <Dialog open={transferOpen} onClose={() => setTransferOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Transfer between wallets</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <FormControl fullWidth size="small" sx={{ mt: 1 }}>
            <InputLabel>From</InputLabel>
            <Select
              label="From"
              value={fromWallet}
              onChange={(e) => setFromWallet(e.target.value as WalletCode)}
            >
              {PAYMENT_METHODS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>To</InputLabel>
            <Select
              label="To"
              value={toWallet}
              onChange={(e) => setToWallet(e.target.value as WalletCode)}
            >
              {PAYMENT_METHODS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Amount"
            type="number"
            size="small"
            fullWidth
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
          />
          <NepaliAwareDatePicker
            label="Date"
            value={transferDate}
            onChange={setTransferDate}
            size="small"
          />
          <TextField
            label="Remarks"
            required
            size="small"
            fullWidth
            multiline
            minRows={2}
            value={transferRemarks}
            onChange={(e) => setTransferRemarks(e.target.value)}
            placeholder="e.g. Deposit cash to bank"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransferOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleTransfer()}
            loading={transferMutation.isPending}
          >
            Transfer
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={adjustOpen} onClose={() => setAdjustOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Manual adjustment</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <FormControl fullWidth size="small" sx={{ mt: 1 }}>
            <InputLabel>Wallet</InputLabel>
            <Select
              label="Wallet"
              value={adjustWallet}
              onChange={(e) => setAdjustWallet(e.target.value as WalletCode)}
            >
              {PAYMENT_METHODS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Direction</InputLabel>
            <Select
              label="Direction"
              value={adjustDirection}
              onChange={(e) => setAdjustDirection(e.target.value as 'in' | 'out')}
            >
              <MenuItem value="in">In (increase)</MenuItem>
              <MenuItem value="out">Out (decrease)</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Amount"
            type="number"
            size="small"
            fullWidth
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
            slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
          />
          <NepaliAwareDatePicker
            label="Date"
            value={adjustDate}
            onChange={setAdjustDate}
            size="small"
          />
          <TextField
            label="Remarks"
            required
            size="small"
            fullWidth
            multiline
            minRows={2}
            value={adjustRemarks}
            onChange={(e) => setAdjustRemarks(e.target.value)}
            placeholder="e.g. Found cash / bank fee"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdjustOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleAdjust()}
            loading={adjustMutation.isPending}
          >
            Save adjustment
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
