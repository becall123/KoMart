import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Grid,
  TextField,
  Typography,
  Alert,
  Paper,
  InputAdornment,
  Switch,
  FormControlLabel,
  CircularProgress,
  MenuItem,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import StoreIcon from '@mui/icons-material/Store';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import { settingsService } from '@/services';
import { useStoreSettings } from '@/hooks/useSettings';
import { useAuthStore } from '@/store';
import { isAdmin } from '@/utils';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import type { PaymentMethod, StoreSettings } from '@/types';

const NUMERIC_KEYS = new Set([
  'taxRate',
  'loyaltyPointsPerCurrency',
  'loyaltyRedeemRate',
  'defaultLowStockThreshold',
  'expiryWarningDays',
  'fiscalYearStartMonth',
  'fiscalYearStartDay',
  'openingBankBalance',
  'openingEsewaBalance',
]);

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'esewa', label: 'eSewa' },
];

function emptyForm(): StoreSettings {
  return {
    storeName: '',
    address: '',
    phone: '',
    email: '',
    logoUrl: '',
    pan: '',
    vatNumber: '',
    currency: 'NPR',
    taxRate: 13,
    taxInclusive: false,
    receiptHeader: '',
    receiptFooter: '',
    autoPrint: false,
    defaultPaymentMethod: 'cash',
    defaultLowStockThreshold: 10,
    expiryWarningDays: 30,
    autoSku: false,
    barcodeFormat: 'any',
    loyaltyPointsPerCurrency: 100,
    loyaltyRedeemRate: 1,
    transactionPrefix: 'TXN',
    purchaseOrderPrefix: 'PO',
    dateFormat: 'en-US',
    timeFormat: '12h',
    calendarSystem: 'BS',
    fiscalYearStartMonth: 7,
    fiscalYearStartDay: 16,
    openingBankBalance: 0,
    openingEsewaBalance: 0,
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Grid size={12}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 1 }}>
        {children}
      </Typography>
      <Divider sx={{ mb: 0.5 }} />
    </Grid>
  );
}

export function StoreInfoTab() {
  const user = useAuthStore((s) => s.user);
  const canEdit = isAdmin(user?.role);
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useStoreSettings();

  const [form, setForm] = useState<StoreSettings>(emptyForm);
  const [error, setError] = useState('');

  useEffect(() => {
    if (settings) {
      const next = { ...emptyForm(), ...settings };
      if ((next.defaultPaymentMethod as string) === 'khalti') {
        next.defaultPaymentMethod = 'esewa';
      }
      setForm(next);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: () => settingsService.update(form),
    onSuccess: () => {
      setError('');
      showSuccess('Settings saved.');
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.settings });
    },
    onError: (err) => {
      setError(getErrorMessage(err));
    },
  });

  const change = (key: keyof StoreSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.type === 'checkbox'
      ? e.target.checked
      : NUMERIC_KEYS.has(key)
        ? Number(e.target.value)
        : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <StoreIcon color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Store Settings</Typography>
      </Box>

      {!canEdit && (
        <Alert severity="info" sx={{ mb: 3 }}>
          You are viewing store settings in read-only mode. Only admins can modify these settings.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 3 }}>
        <Grid container spacing={2.5}>
          <SectionTitle>Store &amp; Legal</SectionTitle>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField label="Store Name" value={form.storeName} onChange={change('storeName')} fullWidth disabled={!canEdit} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField label="Email" type="email" value={form.email} onChange={change('email')} fullWidth disabled={!canEdit} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField label="Phone" value={form.phone} onChange={change('phone')} fullWidth disabled={!canEdit} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField label="Currency" value={form.currency} onChange={change('currency')} fullWidth disabled={!canEdit} />
          </Grid>
          <Grid size={12}>
            <TextField label="Address" value={form.address} onChange={change('address')} fullWidth multiline rows={2} disabled={!canEdit} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField label="Logo URL" value={form.logoUrl} onChange={change('logoUrl')} fullWidth disabled={!canEdit} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField label="PAN" value={form.pan} onChange={change('pan')} fullWidth disabled={!canEdit} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField label="VAT Number" value={form.vatNumber} onChange={change('vatNumber')} fullWidth disabled={!canEdit} />
          </Grid>

          <SectionTitle>Tax &amp; Loyalty</SectionTitle>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              label="Tax Rate (%)"
              type="number"
              value={form.taxRate}
              onChange={change('taxRate')}
              fullWidth
              disabled={!canEdit}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              label="Points per 100 Currency"
              type="number"
              value={form.loyaltyPointsPerCurrency}
              onChange={change('loyaltyPointsPerCurrency')}
              fullWidth
              disabled={!canEdit}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              label="Redeem Rate (points = 1 NPR)"
              type="number"
              value={form.loyaltyRedeemRate}
              onChange={change('loyaltyRedeemRate')}
              fullWidth
              disabled={!canEdit}
            />
          </Grid>
          <Grid size={12}>
            <FormControlLabel
              control={<Switch checked={form.taxInclusive} onChange={change('taxInclusive')} disabled={!canEdit} />}
              label="Tax Inclusive Pricing"
            />
          </Grid>

          <SectionTitle>POS &amp; Receipts</SectionTitle>
          <Grid size={12}>
            <TextField
              label="Receipt Header"
              value={form.receiptHeader}
              onChange={change('receiptHeader')}
              fullWidth
              multiline
              rows={2}
              disabled={!canEdit}
              helperText="Optional lines shown below store name on receipts"
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Receipt Footer"
              value={form.receiptFooter}
              onChange={change('receiptFooter')}
              fullWidth
              multiline
              rows={2}
              disabled={!canEdit}
              helperText="Replaces default thank-you message when set"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              select
              label="Default Payment Method"
              value={form.defaultPaymentMethod}
              onChange={change('defaultPaymentMethod')}
              fullWidth
              disabled={!canEdit}
            >
              {PAYMENT_METHODS.map((m) => (
                <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }} sx={{ display: 'flex', alignItems: 'center' }}>
            <FormControlLabel
              control={<Switch checked={form.autoPrint} onChange={change('autoPrint')} disabled={!canEdit} />}
              label="Auto-print receipt after payment"
            />
          </Grid>

          <SectionTitle>Inventory Defaults</SectionTitle>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              label="Default Low-Stock Threshold"
              type="number"
              value={form.defaultLowStockThreshold}
              onChange={change('defaultLowStockThreshold')}
              fullWidth
              disabled={!canEdit}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              label="Expiry Warning (days)"
              type="number"
              value={form.expiryWarningDays}
              onChange={change('expiryWarningDays')}
              fullWidth
              disabled={!canEdit}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              select
              label="Barcode Format"
              value={form.barcodeFormat}
              onChange={change('barcodeFormat')}
              fullWidth
              disabled={!canEdit}
            >
              <MenuItem value="any">Any</MenuItem>
              <MenuItem value="ean13">EAN-13</MenuItem>
              <MenuItem value="code128">Code 128</MenuItem>
            </TextField>
          </Grid>
          <Grid size={12}>
            <FormControlLabel
              control={<Switch checked={form.autoSku} onChange={change('autoSku')} disabled={!canEdit} />}
              label="Auto-generate SKU when category is set (new products)"
            />
          </Grid>

          <SectionTitle>Business</SectionTitle>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              label="Transaction Number Prefix"
              value={form.transactionPrefix}
              onChange={change('transactionPrefix')}
              fullWidth
              disabled={!canEdit}
              helperText="e.g. TXN → TXN-0001"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              label="Purchase Order Prefix"
              value={form.purchaseOrderPrefix}
              onChange={change('purchaseOrderPrefix')}
              fullWidth
              disabled={!canEdit}
              helperText="e.g. PO → PO-0001"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              label="Fiscal Year Start Month"
              type="number"
              value={form.fiscalYearStartMonth}
              onChange={change('fiscalYearStartMonth')}
              fullWidth
              disabled={!canEdit}
              slotProps={{ htmlInput: { min: 1, max: 12 } }}
              helperText="AD month (Nepal default 7 = July)"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              label="Fiscal Year Start Day"
              type="number"
              value={form.fiscalYearStartDay}
              onChange={change('fiscalYearStartDay')}
              fullWidth
              disabled={!canEdit}
              slotProps={{ htmlInput: { min: 1, max: 31 } }}
              helperText="AD day (Nepal default 16 ≈ Shrawan 1)"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              label="Opening Bank Balance"
              type="number"
              value={form.openingBankBalance}
              onChange={change('openingBankBalance')}
              fullWidth
              disabled={!canEdit}
              helperText="Baseline for Bank dashboard KPI"
              slotProps={{
                input: { startAdornment: <InputAdornment position="start">Rs.</InputAdornment> },
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              label="Opening eSewa Balance"
              type="number"
              value={form.openingEsewaBalance}
              onChange={change('openingEsewaBalance')}
              fullWidth
              disabled={!canEdit}
              helperText="Baseline for eSewa dashboard KPI"
              slotProps={{
                input: { startAdornment: <InputAdornment position="start">Rs.</InputAdornment> },
              }}
            />
          </Grid>

          <SectionTitle>Appearance</SectionTitle>
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="body2" sx={{ mb: 0.75, fontWeight: 500 }}>
              Calendar System
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              color="primary"
              value={form.calendarSystem}
              disabled={!canEdit}
              onChange={(_, value: 'AD' | 'BS' | null) => {
                if (value) setForm((prev) => ({ ...prev, calendarSystem: value }));
              }}
              aria-label="Calendar system"
            >
              <ToggleButton value="AD">AD (Gregorian)</ToggleButton>
              <ToggleButton value="BS">BS (Bikram Sambat)</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              Controls date pickers app-wide (AD stored; BS display/entry). Expiry dates always use AD.
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              select
              label="Date Format Locale"
              value={form.dateFormat}
              onChange={change('dateFormat')}
              fullWidth
              disabled={!canEdit}
            >
              <MenuItem value="en-US">en-US (MM/DD/YYYY)</MenuItem>
              <MenuItem value="en-GB">en-GB (DD/MM/YYYY)</MenuItem>
              <MenuItem value="ne-NP">ne-NP</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              select
              label="Time Format"
              value={form.timeFormat}
              onChange={change('timeFormat')}
              fullWidth
              disabled={!canEdit}
            >
              <MenuItem value="12h">12-hour</MenuItem>
              <MenuItem value="24h">24-hour</MenuItem>
            </TextField>
          </Grid>

          {canEdit && (
            <Grid size={12} sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
              <Button
                variant="contained"
                onClick={() => updateMutation.mutate()}
                loading={updateMutation.isPending}
              >
                Save Changes
              </Button>
            </Grid>
          )}
        </Grid>
      </Paper>
    </Box>
  );
}
