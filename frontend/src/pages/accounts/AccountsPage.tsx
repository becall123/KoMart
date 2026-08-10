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
  Link,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TuneIcon from '@mui/icons-material/Tune';
import TodayIcon from '@mui/icons-material/Today';
import PersonIcon from '@mui/icons-material/Person';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
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
import {
  useCashCustodies,
  useCashCustodySummary,
  useDepositCashCustody,
  useReturnCashCustody,
  useTakeCashCustody,
} from '@/hooks/useCashCustody';
import { useAssignableUsers } from '@/hooks/useAssignableUsers';
import { useDailySummary } from '@/hooks/useReports';
import { useAuthStore } from '@/store';
import { formatCurrency, formatSignedCurrency, isAdminOrManager } from '@/utils';
import { useFormatDate } from '@/hooks/useFormatDate';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import type { CashCustody, WalletCode, WalletLedgerEntry } from '@/types';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function balanceColor(amount: number | null | undefined, defaultColor: string): string {
  if (amount == null || !Number.isFinite(amount)) return defaultColor;
  if (amount < 0) return 'error.main';
  return defaultColor;
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
    custody: 'Custody',
  };
  return map[type] ?? type;
}

function referencePath(row: WalletLedgerEntry): string | null {
  const id = row.referenceId;
  if (!id) return null;
  if (row.referenceType === 'sale' || row.referenceType === 'transaction') {
    return `/sales/${id}`;
  }
  if (row.referenceType === 'expense') return `/expenses/${id}`;
  if (row.referenceType === 'purchase_order' || row.referenceType === 'po') {
    return `/purchase-orders/${id}`;
  }
  return null;
}

function statementLabel(row: WalletLedgerEntry, transferPeer?: WalletLedgerEntry): string {
  if (row.entryType === 'transfer' && transferPeer) {
    const from = row.direction === 'out' ? row.wallet : transferPeer.wallet;
    const to = row.direction === 'in' ? row.wallet : transferPeer.wallet;
    return `Transfer · ${walletLabel(String(from))} → ${walletLabel(String(to))}`;
  }
  return entryTypeLabel(row.entryType);
}

export function AccountsPage() {
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const user = useAuthStore((s) => s.user);
  const canAdjust = isAdminOrManager(user?.role);

  const [walletFilter, setWalletFilter] = useState<'' | WalletCode>('');
  const [entryTypeFilter, setEntryTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(() => daysAgoIso(6));
  const [dateTo, setDateTo] = useState(todayIso);

  const [transferOpen, setTransferOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [takeOpen, setTakeOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState<CashCustody | null>(null);
  const [resolveMode, setResolveMode] = useState<'return' | 'deposit'>('return');
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

  const [takeAmount, setTakeAmount] = useState('');
  const [takeHolderId, setTakeHolderId] = useState('');
  const [takeDate, setTakeDate] = useState(todayIso);
  const [takeRemarks, setTakeRemarks] = useState('');
  const [resolveDate, setResolveDate] = useState(todayIso);
  const [resolveRemarks, setResolveRemarks] = useState('');
  const [depositWallet, setDepositWallet] = useState<'bank' | 'esewa'>('bank');

  const [ledgerPage, setLedgerPage] = useState(0);
  const [ledgerPageSize, setLedgerPageSize] = useState(25);

  const today = todayIso();
  const { data: balances, isLoading: balancesLoading, isError: balancesError } = useWalletBalances();
  const { data: todaySummary } = useDailySummary(today);
  const { data: custodySummary } = useCashCustodySummary(canAdjust);
  const { data: openCustodies = [] } = useCashCustodies({ status: 'held' }, canAdjust);
  const { data: assignableUsers = [] } = useAssignableUsers();

  const ledgerParams = useMemo(
    () => ({
      wallet: walletFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      entryType: entryTypeFilter || undefined,
      limit: 200,
    }),
    [walletFilter, dateFrom, dateTo, entryTypeFilter],
  );
  const { data: ledger = [], isLoading: ledgerLoading, isError: ledgerError } =
    useWalletLedger(ledgerParams);

  const transferMutation = useWalletTransfer();
  const adjustMutation = useWalletAdjustment();
  const takeMutation = useTakeCashCustody();
  const returnMutation = useReturnCashCustody();
  const depositMutation = useDepositCashCustody();

  const needsOpenTill = !todaySummary?.dayClose;
  const transferPeers = useMemo(() => {
    const peerById = new Map<string, WalletLedgerEntry>();
    for (const row of ledger) {
      if (!row.transferId || row.entryType !== 'transfer') continue;
      const peer = ledger.find(
        (other) =>
          other.id !== row.id &&
          other.transferId === row.transferId &&
          other.entryType === 'transfer',
      );
      if (peer) peerById.set(row.id, peer);
    }
    return peerById;
  }, [ledger]);

  const displayLedger = useMemo(() => {
    const seenTransfers = new Set<string>();
    const rows: WalletLedgerEntry[] = [];
    for (const row of ledger) {
      if (row.entryType === 'transfer' && row.transferId) {
        if (seenTransfers.has(row.transferId)) continue;
        seenTransfers.add(row.transferId);
      }
      rows.push(row);
    }
    return rows;
  }, [ledger]);

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
        render: (row) => {
          if (row.entryType === 'transfer' && row.transferId) {
            const peer = transferPeers.get(row.id);
            if (peer) {
              const from = row.direction === 'out' ? row.wallet : peer.wallet;
              const to = row.direction === 'in' ? row.wallet : peer.wallet;
              return `${walletLabel(String(from))} → ${walletLabel(String(to))}`;
            }
          }
          return walletLabel(String(row.wallet));
        },
      },
      {
        id: 'entryType',
        label: 'Type',
        render: (row) => statementLabel(row, transferPeers.get(row.id)),
      },
      {
        id: 'direction',
        label: 'Direction',
        render: (row) =>
          row.entryType === 'transfer' && row.transferId ? (
            <Typography component="span" color="text.secondary">
              —
            </Typography>
          ) : (
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
              color:
                row.entryType === 'transfer'
                  ? 'text.primary'
                  : row.direction === 'in'
                    ? 'success.main'
                    : 'error.main',
            }}
          >
            {row.entryType === 'transfer'
              ? formatCurrency(row.amount)
              : formatSignedCurrency(row.amount, row.direction)}
          </Typography>
        ),
      },
      {
        id: 'remarks',
        label: 'Remarks',
        render: (row) => {
          const path = referencePath(row);
          if (path) {
            return (
              <Link component={RouterLink} to={path} underline="hover">
                {row.remarks || 'View'}
              </Link>
            );
          }
          return row.remarks || '—';
        },
      },
    ],
    [formatDate, transferPeers],
  );

  const pagedLedger = useMemo(() => {
    const start = ledgerPage * ledgerPageSize;
    return displayLedger.slice(start, start + ledgerPageSize);
  }, [displayLedger, ledgerPage, ledgerPageSize]);

  const resetTransfer = (preset?: { from: WalletCode; to: WalletCode; remarks: string }) => {
    setFromWallet(preset?.from ?? 'cash');
    setToWallet(preset?.to ?? 'bank');
    setTransferAmount('');
    setTransferDate(todayIso());
    setTransferRemarks(preset?.remarks ?? '');
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

  const resetTake = () => {
    setTakeAmount('');
    setTakeHolderId('');
    setTakeDate(todayIso());
    setTakeRemarks('');
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

  const handleTake = async () => {
    setFormError('');
    const amount = parseFloat(takeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter a valid amount greater than zero.');
      return;
    }
    if (!takeHolderId) {
      setFormError('Select who is holding the cash.');
      return;
    }
    if (!takeRemarks.trim()) {
      setFormError('Remarks are required.');
      return;
    }
    try {
      await takeMutation.mutateAsync({
        amount,
        heldByUserId: takeHolderId,
        takenDate: takeDate,
        remarks: takeRemarks.trim(),
      });
      showSuccess('Cash taken into staff custody.');
      setTakeOpen(false);
      resetTake();
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  };

  const handleResolve = async () => {
    if (!resolveOpen) return;
    setFormError('');
    try {
      if (resolveMode === 'return') {
        await returnMutation.mutateAsync({
          id: resolveOpen.id,
          payload: { resolvedDate: resolveDate, remarks: resolveRemarks.trim() },
        });
        showSuccess('Cash returned to till.');
      } else {
        await depositMutation.mutateAsync({
          id: resolveOpen.id,
          payload: {
            wallet: depositWallet,
            resolvedDate: resolveDate,
            remarks: resolveRemarks.trim(),
          },
        });
        showSuccess(`Cash deposited to ${walletLabel(depositWallet)}.`);
      }
      setResolveOpen(null);
      setResolveRemarks('');
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  };

  return (
    <Box>
      <PageHeader
        title="Accounts"
        subtitle="Total cash, bank, eSewa, transfers, and statement"
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
              onClick={() => {
                resetTransfer({
                  from: 'cash',
                  to: 'bank',
                  remarks: `Deposit to bank · ${todayIso()}`,
                });
                setTransferOpen(true);
              }}
            >
              Deposit to bank
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                resetTransfer({
                  from: 'bank',
                  to: 'cash',
                  remarks: `Float from bank · ${todayIso()}`,
                });
                setTransferOpen(true);
              }}
            >
              Float from bank
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
              <>
                <Button
                  variant="outlined"
                  startIcon={<PersonIcon />}
                  onClick={() => {
                    resetTake();
                    setTakeOpen(true);
                  }}
                >
                  Take cash
                </Button>
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
              </>
            )}
          </Box>
        }
      />

      {needsOpenTill && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/reports/daily')}>
              Open till
            </Button>
          }
        >
          Today has no Day Cash Book yet. Open the till before selling.
        </Alert>
      )}

      {(balancesError || ledgerError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load wallet accounts.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            title="Total Cash"
            value={balancesLoading ? '—' : formatCurrency(balances?.cash)}
            subtitle={[
              'Includes till + cash with staff',
              balances?.cashTillExpected != null
                ? `Till expected ${formatCurrency(balances.cashTillExpected)}`
                : null,
              balances?.cashWithStaff != null && balances.cashWithStaff > 0
                ? `With staff ${formatCurrency(balances.cashWithStaff)}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            color={balanceColor(balances?.cash, 'success.main')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            title="Bank"
            value={balancesLoading ? '—' : formatCurrency(balances?.bank)}
            subtitle={balances?.asOf ? `As of ${formatDate(balances.asOf)}` : undefined}
            color={balanceColor(balances?.bank, 'primary.main')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            title="eSewa"
            value={balancesLoading ? '—' : formatCurrency(balances?.esewa)}
            subtitle={balances?.asOf ? `As of ${formatDate(balances.asOf)}` : undefined}
            color={balanceColor(balances?.esewa, 'info.main')}
          />
        </Grid>
      </Grid>

      {canAdjust && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Cash with staff
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total {formatCurrency(custodySummary?.totalHeld ?? 0)}
            </Typography>
          </Box>
          {(custodySummary?.byHolder?.length ?? 0) === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No open custody. Use Take cash when a manager holds sales cash outside the till.
            </Typography>
          ) : (
            <Grid container spacing={1.5}>
              {openCustodies.map((row) => (
                <Grid key={row.id} size={{ xs: 12, md: 6 }}>
                  <Box
                    sx={{
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      p: 1.5,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 1,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Box>
                      <Typography sx={{ fontWeight: 600 }}>{row.heldByName}</Typography>
                      <Typography variant="body2">{formatCurrency(row.amount)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Taken {formatDate(row.takenDate)} · {row.remarks || '—'}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setResolveOpen(row);
                          setResolveMode('return');
                          setResolveDate(todayIso());
                          setResolveRemarks('');
                          setFormError('');
                        }}
                      >
                        Return
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => {
                          setResolveOpen(row);
                          setResolveMode('deposit');
                          setResolveDate(todayIso());
                          setResolveRemarks('');
                          setDepositWallet('bank');
                          setFormError('');
                        }}
                      >
                        Deposit
                      </Button>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      )}

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
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Entry type</InputLabel>
            <Select
              label="Entry type"
              value={entryTypeFilter}
              onChange={(e) => {
                setEntryTypeFilter(e.target.value);
                setLedgerPage(0);
              }}
            >
              <MenuItem value="">All</MenuItem>
              {['sale', 'expense', 'po_payment', 'transfer', 'adjustment', 'custody'].map((t) => (
                <MenuItem key={t} value={t}>
                  {entryTypeLabel(t)}
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
          total={displayLedger.length}
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
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
          />
          <NepaliAwareDatePicker label="Date" value={transferDate} onChange={setTransferDate} size="small" />
          <TextField
            label="Remarks"
            size="small"
            value={transferRemarks}
            onChange={(e) => setTransferRemarks(e.target.value)}
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransferOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleTransfer()} loading={transferMutation.isPending}>
            Transfer
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={adjustOpen} onClose={() => setAdjustOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Adjust wallet balance</DialogTitle>
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
              <MenuItem value="in">In</MenuItem>
              <MenuItem value="out">Out</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Amount"
            type="number"
            size="small"
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
          />
          <NepaliAwareDatePicker label="Date" value={adjustDate} onChange={setAdjustDate} size="small" />
          <TextField
            label="Remarks"
            size="small"
            value={adjustRemarks}
            onChange={(e) => setAdjustRemarks(e.target.value)}
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdjustOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleAdjust()} loading={adjustMutation.isPending}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={takeOpen} onClose={() => setTakeOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Take cash (staff custody)</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField
            label="Amount"
            type="number"
            size="small"
            sx={{ mt: 1 }}
            value={takeAmount}
            onChange={(e) => setTakeAmount(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
          />
          <FormControl fullWidth size="small">
            <InputLabel>Held by</InputLabel>
            <Select
              label="Held by"
              value={takeHolderId}
              onChange={(e) => setTakeHolderId(e.target.value)}
            >
              {assignableUsers.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <NepaliAwareDatePicker label="Date" value={takeDate} onChange={setTakeDate} size="small" />
          <TextField
            label="Remarks"
            size="small"
            value={takeRemarks}
            onChange={(e) => setTakeRemarks(e.target.value)}
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTakeOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleTake()} loading={takeMutation.isPending}>
            Take cash
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!resolveOpen} onClose={() => setResolveOpen(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {resolveMode === 'return' ? 'Return cash to till' : 'Deposit cash from custody'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          {resolveOpen && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {resolveOpen.heldByName} · {formatCurrency(resolveOpen.amount)}
            </Typography>
          )}
          {resolveMode === 'deposit' && (
            <FormControl fullWidth size="small">
              <InputLabel>Deposit to</InputLabel>
              <Select
                label="Deposit to"
                value={depositWallet}
                onChange={(e) => setDepositWallet(e.target.value as 'bank' | 'esewa')}
              >
                <MenuItem value="bank">Bank</MenuItem>
                <MenuItem value="esewa">eSewa</MenuItem>
              </Select>
            </FormControl>
          )}
          <NepaliAwareDatePicker label="Date" value={resolveDate} onChange={setResolveDate} size="small" />
          <TextField
            label="Remarks"
            size="small"
            value={resolveRemarks}
            onChange={(e) => setResolveRemarks(e.target.value)}
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolveOpen(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleResolve()}
            loading={returnMutation.isPending || depositMutation.isPending}
          >
            {resolveMode === 'return' ? 'Return' : 'Deposit'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
