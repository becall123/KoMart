import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tab,
  Tabs,
  TextField,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Divider,
  Chip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { CustomerPicker } from '@/components/pos/CustomerPicker';
import { useCustomer } from '@/hooks/useCustomers';
import { PAYMENT_METHODS } from '@/constants';
import { formatCurrency, formatAmount } from '@/utils';
import { getErrorMessage } from '@/services/apiClient';
import type { PaymentMethod, Transaction } from '@/types';

interface SaleEditDialogProps {
  open: boolean;
  transaction: Transaction;
  onClose: () => void;
  onSave: (payload: {
    customerId?: string | null;
    customerName?: string;
    paymentMethod: PaymentMethod;
    discount: number;
    manualDiscount: number;
    loyaltyPointsRedeemed: number;
    tax: number;
    roundOff: number;
    notes?: string;
    items?: Array<{ productId: string; quantity: number; unitPrice: number; lineDiscount: number }>;
  }) => Promise<void>;
  saving?: boolean;
}

interface DraftItem {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  price: number;
  discount: number;
}

function computeLineTotal(item: DraftItem) {
  return Math.max(0, item.price * item.quantity - item.discount);
}

export function SaleEditDialog({
  open,
  transaction,
  onClose,
  onSave,
  saving,
}: SaleEditDialogProps) {
  const [tab, setTab] = useState(0);
  const [customerId, setCustomerId] = useState<string | null>(transaction.customerId ?? null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(transaction.paymentMethod);
  const [tax, setTax] = useState(String(transaction.tax));
  const [roundOff, setRoundOff] = useState(String(transaction.roundOff ?? 0));
  const [manualDiscount, setManualDiscount] = useState(String(transaction.manualDiscount ?? 0));
  const [loyaltyPoints, setLoyaltyPoints] = useState(String(transaction.loyaltyPointsRedeemed));
  const [notes, setNotes] = useState(String(transaction.notes ?? ''));
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  const { data: selectedCustomer } = useCustomer(customerId ?? '');

  useEffect(() => {
    if (!open) return;
    setTab(0);
    setCustomerId(transaction.customerId ?? null);
    setPaymentMethod(transaction.paymentMethod);
    setTax(String(transaction.tax));
    setRoundOff(String(transaction.roundOff ?? 0));
    setManualDiscount(String(transaction.manualDiscount ?? 0));
    setLoyaltyPoints(String(transaction.loyaltyPointsRedeemed));
    setNotes(String(transaction.notes ?? ''));
    setDraftItems(
      transaction.items.map((i) => ({
        productId: i.productId,
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        price: i.price,
        discount: i.discount,
      })),
    );
    setError('');
    setDirty(false);
  }, [open, transaction]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const promotionDiscount = Math.max(0, (transaction.promotionDiscount ?? 0));
  const loyaltyValue = parseFloat(loyaltyPoints) || 0;
  const manualNum = parseFloat(manualDiscount) || 0;
  const taxNum = parseFloat(tax) || 0;
  const roundOffNum = parseFloat(roundOff) || 0;
  const subtotal = draftItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const lineDiscountTotal = draftItems.reduce((s, i) => s + i.discount, 0);
  const overallDiscount = manualNum + promotionDiscount + loyaltyValue;
  const newTotal = Math.max(0, Math.round((subtotal - lineDiscountTotal - overallDiscount + taxNum + roundOffNum) * 100) / 100);
  const originalTotal = transaction.total;

  const updateDraftItem = (idx: number, field: keyof DraftItem, value: number | string) => {
    setDirty(true);
    setDraftItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: typeof value === 'number' ? value : Number(value) || 0 } : item)),
    );
  };

  const removeDraftItem = (idx: number) => {
    setDirty(true);
    setDraftItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (draftItems.length === 0) {
      setError('Transaction must have at least one item');
      return;
    }
    for (const item of draftItems) {
      if (item.quantity < 0 || item.price < 0 || item.discount < 0) {
        setError('Item quantities, prices, and discounts cannot be negative');
        return;
      }
    }
    const lineDiscountSum = draftItems.reduce((s, i) => s + i.discount * i.quantity, 0);
    if (overallDiscount > subtotal - lineDiscountSum) {
      setError('Overall discount cannot exceed subtotal');
      return;
    }
    const points = parseInt(loyaltyPoints, 10);
    if (isNaN(points) || points < 0) {
      setError('Enter a valid loyalty points value');
      return;
    }
    try {
      await onSave({
        customerId,
        customerName: customerId
          ? (selectedCustomer?.name ?? transaction.customerName ?? 'Customer')
          : 'Walk-In Customer',
        paymentMethod,
        discount: overallDiscount,
        manualDiscount: manualNum,
        loyaltyPointsRedeemed: points,
        tax: taxNum,
        roundOff: roundOffNum,
        notes: notes || undefined,
        items: draftItems.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.price,
          lineDiscount: i.discount,
        })),
      });
      setDirty(false);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit Sale — {transaction.transactionNumber}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="General" />
          <Tab label="Line Items" />
          <Tab label="Financials" />
        </Tabs>

        {tab === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <CustomerPicker
              customerId={customerId}
              onCustomerChange={(id) => { setCustomerId(id); setDirty(true); }}
              onAddCustomer={() => {}}
            />
            <TextField
              select
              fullWidth
              label="Payment Method"
              value={paymentMethod}
              onChange={(e) => { setPaymentMethod(e.target.value as PaymentMethod); setDirty(true); }}
            >
              {PAYMENT_METHODS.map((m) => (
                <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              fullWidth
              label="Notes / Remarks"
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setError(''); setDirty(true); }}
              multiline
              rows={2}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          </Box>
        )}

        {tab === 1 && (
          <Box sx={{ mt: 1 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Unit Price</TableCell>
                    <TableCell align="right">Line Discount</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell align="center" sx={{ width: 48 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {draftItems.map((item, idx) => (
                    <TableRow key={`${item.productId}-${idx}`}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{item.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{item.sku}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={item.quantity}
                          onChange={(e) => updateDraftItem(idx, 'quantity', e.target.value)}
                          slotProps={{ htmlInput: { min: 0, style: { textAlign: 'right' } } }}
                          sx={{ width: 72 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={item.price}
                          onChange={(e) => updateDraftItem(idx, 'price', e.target.value)}
                          slotProps={{ htmlInput: { min: 0, step: 0.01, style: { textAlign: 'right' } } }}
                          sx={{ width: 100 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={item.discount}
                          onChange={(e) => updateDraftItem(idx, 'discount', e.target.value)}
                          slotProps={{ htmlInput: { min: 0, step: 0.01, style: { textAlign: 'right' } } }}
                          sx={{ width: 100 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatAmount(computeLineTotal(item))}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Button
                          size="small"
                          color="error"
                          onClick={() => removeDraftItem(idx)}
                          disabled={draftItems.length <= 1}
                        >
                          <DeleteIcon fontSize="small" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5, px: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {draftItems.length} item{draftItems.length !== 1 ? 's' : ''}
              </Typography>
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                Subtotal: <strong>{formatCurrency(subtotal)}</strong>
              </Typography>
            </Box>
          </Box>
        )}

        {tab === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                label="Tax (NPR)"
                type="number"
                value={tax}
                onChange={(e) => { setTax(e.target.value); setError(''); setDirty(true); }}
                slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                sx={{ width: 160 }}
              />
              <TextField
                label="Manual Discount (NPR)"
                type="number"
                value={manualDiscount}
                onChange={(e) => { setManualDiscount(e.target.value); setError(''); setDirty(true); }}
                slotProps={{ htmlInput: { min: 0, max: Math.max(0, subtotal - lineDiscountTotal), step: 0.01 } }}
                sx={{ width: 180 }}
              />
              <TextField
                label="Loyalty Points Redeemed"
                type="number"
                value={loyaltyPoints}
                onChange={(e) => { setLoyaltyPoints(e.target.value); setError(''); setDirty(true); }}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                sx={{ width: 180 }}
              />
              <TextField
                label="Round-off"
                type="number"
                value={roundOff}
                onChange={(e) => { setRoundOff(e.target.value); setError(''); setDirty(true); }}
                slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                sx={{ width: 140 }}
              />
            </Box>

            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Subtotal</Typography>
                <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(subtotal)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Line Discount</Typography>
                <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(lineDiscountTotal)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Promotion Discount</Typography>
                <Chip label={formatCurrency(promotionDiscount)} size="small" variant="outlined" />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Manual Discount</Typography>
                <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(manualNum)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Loyalty Value</Typography>
                <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(loyaltyValue)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Tax</Typography>
                <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(taxNum)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Round-off</Typography>
                <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(roundOffNum)}</Typography>
              </Box>
              <Divider sx={{ my: 0.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle1">New Total</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {newTotal !== originalTotal && (
                    <Chip
                      label={`${newTotal > originalTotal ? '+' : ''}${formatCurrency(newTotal - originalTotal)}`}
                      color={newTotal > originalTotal ? 'error' : 'success'}
                      size="small"
                    />
                  )}
                  <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                    {formatCurrency(newTotal)}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} loading={saving}>
          Save Changes
        </Button>
      </DialogActions>
    </Dialog>
  );
}
