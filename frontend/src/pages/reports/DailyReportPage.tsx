import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import SaveIcon from '@mui/icons-material/Save';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { NepaliAwareDatePicker } from '@/components/common/NepaliAwareDatePicker';
import { StatCard } from '@/components/common/StatCard';
import {
  useCloseDay,
  useDailySummary,
  useOpeningSuggestion,
  usePostDayCloseVariance,
  useReopenDay,
  useUpsertDayClose,
} from '@/hooks/useReports';
import { useWalletTransfer } from '@/hooks/useWallets';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PAYMENT_METHODS } from '@/constants';
import { formatCurrency } from '@/utils';
import { useFormatDate } from '@/hooks/useFormatDate';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import type { WalletDayBookBlock } from '@/types';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function paymentLabel(method: string): string {
  const normalized =
    method === 'card' ? 'bank' : method === 'khalti' ? 'esewa' : method;
  return PAYMENT_METHODS.find((p) => p.value === normalized)?.label ?? method;
}

function WalletSection({
  title,
  block,
  mode,
  openingCash,
  closingValue,
  notes,
  onOpeningChange,
  onClosingChange,
  onNotesChange,
  onSave,
  saving,
  onPostVariance,
  postingVariance,
  readOnly,
  openingHint,
}: {
  title: string;
  block?: WalletDayBookBlock | null;
  /** cash = till count + notes + save; statement = statement closing only */
  mode?: 'cash' | 'statement';
  openingCash?: string;
  closingValue?: string;
  notes?: string;
  onOpeningChange?: (v: string) => void;
  onClosingChange?: (v: string) => void;
  onNotesChange?: (v: string) => void;
  onSave?: () => void;
  saving?: boolean;
  onPostVariance?: () => void;
  postingVariance?: boolean;
  readOnly?: boolean;
  openingHint?: string;
}) {
  const opening = block?.opening ?? 0;
  const salesIn = block?.salesIn ?? 0;
  const expensesOut = block?.expensesOut ?? 0;
  const transfersIn = block?.transfersIn ?? 0;
  const transfersOut = block?.transfersOut ?? 0;
  const adjustmentsIn = block?.adjustmentsIn ?? 0;
  const adjustmentsOut = block?.adjustmentsOut ?? 0;
  const custodyIn = block?.custodyIn ?? 0;
  const custodyOut = block?.custodyOut ?? 0;
  const expected = block?.expected ?? 0;
  const closing = block?.closing;
  const variance = block?.variance;
  const variancePosted = Boolean(block?.variancePosted);
  const showInputs = mode === 'cash' || mode === 'statement';
  const canPostVariance =
    !readOnly &&
    variance != null &&
    Math.abs(variance) >= 0.01 &&
    closing != null &&
    !variancePosted;

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>

      {showInputs && (
        <>
          <Grid container spacing={1.5} className="no-print">
            {mode === 'cash' && (
              <Grid size={{ xs: 6 }}>
                <TextField
                  label="Opening cash"
                  type="number"
                  size="small"
                  fullWidth
                  value={openingCash}
                  onChange={(e) => onOpeningChange?.(e.target.value)}
                  disabled={readOnly}
                  helperText={openingHint}
                  slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                />
              </Grid>
            )}
            <Grid size={{ xs: mode === 'cash' ? 6 : 12 }}>
              <TextField
                label={mode === 'cash' ? 'Closing cash (counted)' : 'Closing (statement)'}
                type="number"
                size="small"
                fullWidth
                value={closingValue}
                onChange={(e) => onClosingChange?.(e.target.value)}
                disabled={readOnly}
                placeholder={mode === 'statement' ? 'Leave blank if not reconciled' : undefined}
                slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
              />
            </Grid>
            {mode === 'cash' && (
              <>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    label="Notes"
                    size="small"
                    fullWidth
                    value={notes}
                    onChange={(e) => onNotesChange?.(e.target.value)}
                    disabled={readOnly}
                    multiline
                    minRows={2}
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={() => onSave?.()}
                    loading={saving}
                    disabled={readOnly}
                  >
                    Save day close
                  </Button>
                </Grid>
              </>
            )}
          </Grid>

          <Box className="print-only-block" sx={{ display: 'none', mb: 1 }}>
            {mode === 'cash' && (
              <Typography variant="body2">Opening: {formatCurrency(opening)}</Typography>
            )}
            <Typography variant="body2">
              Closing:{' '}
              {formatCurrency(
                closing ?? (closingValue !== undefined && closingValue !== '' ? Number(closingValue) || 0 : 0),
              )}
            </Typography>
            {mode === 'cash' && notes && (
              <Typography variant="body2">Notes: {notes}</Typography>
            )}
          </Box>
          <Divider sx={{ my: 1.5 }} />
        </>
      )}

      <Line label="Opening" value={opening} bold={mode !== 'cash'} />
      <Line label="Sales in" value={salesIn} />
      <Line label="Expenses out" value={expensesOut} />
      <Line label="Transfers in" value={transfersIn} />
      <Line label="Transfers out" value={transfersOut} />
      <Line label="Adjustments in" value={adjustmentsIn} />
      <Line label="Adjustments out" value={adjustmentsOut} />
      {(custodyIn > 0 || custodyOut > 0 || mode === 'cash') && (
        <>
          <Line label="Custody in (return)" value={custodyIn} />
          <Line label="Custody out (take)" value={custodyOut} />
        </>
      )}
      <Divider sx={{ my: 1 }} />
      <Line label="Expected closing" value={expected} bold />
      {closing != null && <Line label="Closing" value={closing} />}
      {variance != null && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 1,
            mt: 0.5,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Variance
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                color:
                  variance === 0
                    ? 'text.primary'
                    : variance > 0
                      ? 'success.main'
                      : 'error.main',
              }}
            >
              {formatCurrency(variance)}
            </Typography>
            {variancePosted ? (
              <Typography variant="caption" color="text.secondary" className="no-print">
                Posted
              </Typography>
            ) : canPostVariance ? (
              <Button
                size="small"
                variant="outlined"
                className="no-print"
                loading={postingVariance}
                onClick={() => onPostVariance?.()}
              >
                Post variance
              </Button>
            ) : null}
          </Box>
        </Box>
      )}
      {mode === 'cash' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Expected = Opening + sales − expenses ± transfers ± adjustments ± custody
        </Typography>
      )}
      {mode === 'statement' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Enter statement closing, then Save day close on Till. Variance = statement − expected.
        </Typography>
      )}
    </Paper>
  );
}

function Line({
  label,
  value,
  bold,
}: {
  label: string;
  value: number | null | undefined;
  bold?: boolean;
}) {
  const display = value == null || !Number.isFinite(value) ? '—' : formatCurrency(value);
  const color =
    value != null && Number.isFinite(value) && value < 0 ? 'error.main' : undefined;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 400 }} color={color}>
        {display}
      </Typography>
    </Box>
  );
}

export function DailyReportPage() {
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const [date, setDate] = useState(todayIso);
  const [openingCash, setOpeningCash] = useState('0');
  const [closingCash, setClosingCash] = useState('0');
  const [closingBank, setClosingBank] = useState('');
  const [closingEsewa, setClosingEsewa] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [postWallet, setPostWallet] = useState<'cash' | 'bank' | 'esewa' | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const suggestedAppliedFor = useRef<string | null>(null);

  const { data, isLoading, isError, refetch } = useDailySummary(date);
  const { data: openingSuggestion } = useOpeningSuggestion(date);
  const upsertMutation = useUpsertDayClose();
  const postVarianceMutation = usePostDayCloseVariance();
  const closeDayMutation = useCloseDay();
  const reopenDayMutation = useReopenDay();
  const transferMutation = useWalletTransfer();

  const dayClosed = data?.dayClose?.status === 'closed';

  useEffect(() => {
    if (!data) return;
    setOpeningCash(String(data.cash.opening ?? 0));
    setClosingCash(String(data.cash.closing ?? 0));
    setClosingBank(
      data.dayClose?.closingBank != null ? String(data.dayClose.closingBank) : '',
    );
    setClosingEsewa(
      data.dayClose?.closingEsewa != null ? String(data.dayClose.closingEsewa) : '',
    );
    setNotes(data.dayClose?.notes ?? '');
  }, [data]);

  useEffect(() => {
    if (!openingSuggestion || data?.dayClose) return;
    if (suggestedAppliedFor.current === date) return;
    suggestedAppliedFor.current = date;
    setOpeningCash(String(openingSuggestion.suggestedOpeningCash ?? 0));
  }, [openingSuggestion, data?.dayClose, date]);

  const openingMismatch =
    !data?.dayClose &&
    (openingSuggestion?.yesterdayClosingCash ?? 0) > 0 &&
    parseFloat(openingCash || '0') === 0;

  const parseOptionalClosing = (raw: string): number | null | 'invalid' => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const value = parseFloat(trimmed);
    if (!Number.isFinite(value) || value < 0) return 'invalid';
    return value;
  };

  const handleSaveCash = async () => {
    setError('');
    const opening = parseFloat(openingCash);
    const closing = parseFloat(closingCash);
    if (!Number.isFinite(opening) || opening < 0 || !Number.isFinite(closing) || closing < 0) {
      setError('Opening and closing cash must be valid non-negative amounts.');
      return;
    }
    const bank = parseOptionalClosing(closingBank);
    const esewa = parseOptionalClosing(closingEsewa);
    if (bank === 'invalid' || esewa === 'invalid') {
      setError('Bank and eSewa statement closings must be blank or valid non-negative amounts.');
      return;
    }
    try {
      await upsertMutation.mutateAsync({
        date,
        data: {
          openingCash: opening,
          closingCash: closing,
          closingBank: bank,
          closingEsewa: esewa,
          notes: notes.trim() || undefined,
        },
      });
      showSuccess('Day close saved.');
      await refetch();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleQuickTransfer = async (from: 'cash' | 'bank', to: 'cash' | 'bank', label: string) => {
    setError('');
    const amountRaw = window.prompt(`${label} — enter amount (NPR):`);
    if (amountRaw == null) return;
    const amount = parseFloat(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid transfer amount.');
      return;
    }
    try {
      await transferMutation.mutateAsync({
        fromWallet: from,
        toWallet: to,
        amount,
        date,
        remarks: `${label} · ${date}`,
      });
      showSuccess(`${label} recorded.`);
      await refetch();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleCloseDay = async () => {
    setError('');
    try {
      await closeDayMutation.mutateAsync(date);
      showSuccess('Day closed.');
      setConfirmClose(false);
      await refetch();
    } catch (err) {
      setError(getErrorMessage(err));
      setConfirmClose(false);
    }
  };

  const handleReopenDay = async () => {
    setError('');
    try {
      await reopenDayMutation.mutateAsync(date);
      showSuccess('Day reopened.');
      await refetch();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const sales = data?.sales.totalRevenue ?? 0;
  const expenses = data?.expenses.total ?? 0;
  const net = sales - expenses;
  const cash = data?.cash;
  const wallets = data?.wallets ?? [];

  const cashBook: WalletDayBookBlock = wallets.find((w) => w.wallet === 'cash') ?? {
    wallet: 'cash',
    opening: cash?.opening ?? 0,
    salesIn: cash?.cashSales ?? 0,
    expensesOut: cash?.cashExpenses ?? 0,
    transfersIn: cash?.transfersIn ?? 0,
    transfersOut: cash?.transfersOut ?? 0,
    adjustmentsIn: cash?.adjustmentsIn ?? 0,
    adjustmentsOut: cash?.adjustmentsOut ?? 0,
    custodyIn: 0,
    custodyOut: 0,
    expected: cash?.expected ?? 0,
    closing: cash?.closing ?? 0,
    variance: cash?.variance ?? 0,
  };
  const bankBook = wallets.find((w) => w.wallet === 'bank');
  const esewaBook = wallets.find((w) => w.wallet === 'esewa');

  const checklist = [
    { label: 'Count till cash and save closing', done: (data?.dayClose?.closingCash ?? 0) > 0 || !!data?.dayClose },
    {
      label: 'Optional: bank / eSewa statement closings',
      done: data?.dayClose?.closingBank != null || data?.dayClose?.closingEsewa != null,
    },
    {
      label: 'Review variances (post if needed)',
      done:
        Math.abs(cashBook.variance ?? 0) < 0.01 ||
        Boolean(cashBook.variancePosted) ||
        (bankBook?.variancePosted ?? true),
    },
    { label: 'Close day', done: dayClosed },
  ];

  const walletLabel = (wallet: string) =>
    wallet === 'cash' ? 'Till (today)' : wallet === 'bank' ? 'Bank' : 'eSewa';

  const blockForWallet = (wallet: 'cash' | 'bank' | 'esewa') => {
    if (wallet === 'cash') return cashBook;
    if (wallet === 'bank') return bankBook;
    return esewaBook;
  };

  const handleConfirmPostVariance = async () => {
    if (!postWallet) return;
    setError('');
    try {
      await postVarianceMutation.mutateAsync({ date, wallet: postWallet });
      showSuccess(`Variance posted to ${walletLabel(postWallet)} ledger.`);
      setPostWallet(null);
      await refetch();
    } catch (err) {
      setError(getErrorMessage(err));
      setPostWallet(null);
    }
  };

  const pendingPostBlock = postWallet ? blockForWallet(postWallet) : null;
  const pendingPostAmount = Math.abs(pendingPostBlock?.variance ?? 0);
  const pendingPostDirection =
    (pendingPostBlock?.variance ?? 0) > 0 ? 'surplus (in)' : 'deficit (out)';

  const methods = ['cash', 'bank', 'esewa'] as const;
  const methodRows = methods.map((method) => {
    const row = data?.byPaymentMethod.find((p) => {
      const m =
        p.paymentMethod === 'card' ? 'bank' : p.paymentMethod === 'khalti' ? 'esewa' : p.paymentMethod;
      return m === method;
    });
    let revenue = row?.revenue ?? 0;
    let count = row?.count ?? 0;
    if (method === 'esewa') {
      const legacy = data?.byPaymentMethod.find((p) => p.paymentMethod === 'khalti');
      revenue += legacy?.revenue ?? 0;
      count += legacy?.count ?? 0;
    }
    return {
      method,
      label: paymentLabel(method),
      revenue,
      count,
    };
  });

  return (
    <Box className="daily-report-page">
      <PageHeader
        title="Day Cash Book"
        subtitle="Per-wallet movements and end-of-day reconciliation"
        breadcrumbs={[{ label: 'Reports', path: '/reports' }, { label: 'Day Cash Book' }]}
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }} className="no-print">
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/reports')}>
              Back
            </Button>
            <Button
              variant="outlined"
              startIcon={<AccountBalanceWalletIcon />}
              onClick={() => navigate('/accounts')}
            >
              Accounts
            </Button>
            <Button
              variant="outlined"
              disabled={dayClosed || transferMutation.isPending}
              onClick={() => void handleQuickTransfer('cash', 'bank', 'Deposit to bank')}
            >
              Deposit to bank
            </Button>
            <Button
              variant="outlined"
              disabled={dayClosed || transferMutation.isPending}
              onClick={() => void handleQuickTransfer('bank', 'cash', 'Float from bank')}
            >
              Float from bank
            </Button>
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()}>
              Print
            </Button>
          </Box>
        }
      />

      <Paper
        variant="outlined"
        className="no-print"
        sx={{ p: 2, mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <NepaliAwareDatePicker
          label="Business date"
          value={date}
          onChange={setDate}
          size="small"
        />
        <Typography variant="body2" color="text.secondary">
          Review Cash / Bank / eSewa for the day, enter counted/statement closings, then print.
        </Typography>
      </Paper>

      {(error || isError) && (
        <Alert severity="error" sx={{ mb: 2 }} className="no-print">
          {error || 'Could not load day cash book.'}
        </Alert>
      )}

      {!data?.dayClose && (
        <Alert severity="info" sx={{ mb: 2 }} className="no-print">
          Open till: set Opening cash (suggested from yesterday’s close), then Save day close.
        </Alert>
      )}

      {openingMismatch && (
        <Alert severity="warning" sx={{ mb: 2 }} className="no-print">
          Opening is 0 but yesterday’s closing was{' '}
          {formatCurrency(openingSuggestion?.yesterdayClosingCash ?? 0)}. Confirm before continuing.
        </Alert>
      )}

      {dayClosed && (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          className="no-print"
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<LockOpenIcon />}
              onClick={() => void handleReopenDay()}
              loading={reopenDayMutation.isPending}
            >
              Reopen
            </Button>
          }
        >
          Day closed{data?.dayClose?.closedBy ? ` by ${data.dayClose.closedBy}` : ''}. Edits are locked.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="no-print">
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Close-day checklist
        </Typography>
        {checklist.map((item) => (
          <Typography
            key={item.label}
            variant="body2"
            color={item.done ? 'success.main' : 'text.secondary'}
            sx={{ mb: 0.5 }}
          >
            {item.done ? '✓' : '○'} {item.label}
          </Typography>
        ))}
        {!dayClosed && (
          <Button
            sx={{ mt: 1 }}
            variant="contained"
            startIcon={<LockIcon />}
            disabled={!data?.dayClose}
            onClick={() => setConfirmClose(true)}
            loading={closeDayMutation.isPending}
          >
            Close day
          </Button>
        )}
      </Paper>

      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }} className="print-only-block">
        KoMart Day Cash Book — {formatDate(date)}
      </Typography>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            title="Total Sales"
            value={isLoading ? '—' : formatCurrency(sales)}
            subtitle={data ? `${data.sales.transactionCount} transactions` : undefined}
            color="success.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            title="Total Expenses"
            value={isLoading ? '—' : formatCurrency(expenses)}
            subtitle={data ? `Operating ${formatCurrency(data.expenses.operating)}` : undefined}
            color="error.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            title="Net (Sales − Expenses)"
            value={isLoading ? '—' : formatCurrency(net)}
            color={net >= 0 ? 'primary.main' : 'error.main'}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <WalletSection
            title="Till (today)"
            block={cashBook}
            mode="cash"
            openingCash={openingCash}
            closingValue={closingCash}
            notes={notes}
            onOpeningChange={setOpeningCash}
            onClosingChange={setClosingCash}
            onNotesChange={setNotes}
            onSave={() => void handleSaveCash()}
            saving={upsertMutation.isPending}
            onPostVariance={() => setPostWallet('cash')}
            postingVariance={postVarianceMutation.isPending && postWallet === 'cash'}
            readOnly={dayClosed}
            openingHint={
              openingSuggestion?.yesterdayClosingCash != null
                ? `Suggested ${formatCurrency(openingSuggestion.suggestedOpeningCash)}`
                : undefined
            }
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <WalletSection
            title="Bank"
            block={bankBook}
            mode="statement"
            closingValue={closingBank}
            onClosingChange={setClosingBank}
            onPostVariance={() => setPostWallet('bank')}
            postingVariance={postVarianceMutation.isPending && postWallet === 'bank'}
            readOnly={dayClosed}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <WalletSection
            title="eSewa"
            block={esewaBook}
            mode="statement"
            closingValue={closingEsewa}
            onClosingChange={setClosingEsewa}
            onPostVariance={() => setPostWallet('esewa')}
            postingVariance={postVarianceMutation.isPending && postWallet === 'esewa'}
            readOnly={dayClosed}
          />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          Payments received
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Method</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                Txns
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                Amount
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {methodRows.map((row) => (
              <TableRow key={row.method}>
                <TableCell>{row.label}</TableCell>
                <TableCell align="right">{row.count}</TableCell>
                <TableCell align="right">{formatCurrency(row.revenue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <ConfirmDialog
        open={postWallet != null}
        title="Post variance to ledger"
        message={
          postWallet
            ? `Post ${formatCurrency(pendingPostAmount)} as a ${walletLabel(postWallet)} adjustment (${pendingPostDirection}) for ${formatDate(date)}? This updates Accounts.`
            : ''
        }
        confirmLabel="Post variance"
        loading={postVarianceMutation.isPending}
        onConfirm={() => void handleConfirmPostVariance()}
        onCancel={() => setPostWallet(null)}
      />

      <ConfirmDialog
        open={confirmClose}
        title="Close day"
        message={`Lock ${formatDate(date)} after review? Further edits will require Reopen.`}
        confirmLabel="Close day"
        loading={closeDayMutation.isPending}
        onConfirm={() => void handleCloseDay()}
        onCancel={() => setConfirmClose(false)}
      />

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only-block { display: block !important; }
          .MuiDrawer-root, .MuiAppBar-root { display: none !important; }
          body { background: #fff !important; }
        }
        .print-only-block { display: none; }
      `}</style>
    </Box>
  );
}
