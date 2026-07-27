import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Divider,
  ToggleButtonGroup,
  ToggleButton,
  TextField,
  Alert,
  Paper,
  Chip,
  IconButton,
  FormControlLabel,
  Checkbox,
  MenuItem,
} from '@mui/material';
import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import { CustomerPicker } from '@/components/pos/CustomerPicker';
import { PosAddProductAutocomplete } from '@/components/pos/PosAddProductAutocomplete';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteIcon from '@mui/icons-material/Delete';
import { formatAmount, formatCurrency, uomLabel } from '@/utils';
import { cartLineKey } from '@/utils/cartLine';
import { cashTenderSuggestions } from '@/utils/cashTenderSuggestions';
import { useCheckoutDraft, type CartMutators, type CheckoutDiscountType } from '@/hooks/useCheckoutDraft';
import { useFormatDate } from '@/hooks/useFormatDate';
import { ReceiptView } from '@/components/pos/ReceiptView';
import { ReceiptActions } from '@/components/pos/ReceiptActions';
import type { AppliedPromotion, CartItem, PaymentMethod, ReceiptBranding, Transaction } from '@/types';
import { printTransactionReceipt } from '@/utils/receiptPrint';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaymentCustomerInfo {
  name: string;
  phone?: string;
  email?: string;
  membershipTier?: string;
  loyaltyPoints?: number;
  isWalkIn?: boolean;
}

export interface PaymentConfirmPayload {
  method: PaymentMethod;
  tendered?: number;
  items: CartItem[];
  subtotal: number;
  total: number;
  manualDiscount: number;
  loyaltyPointsRedeemed: number;
  notes: string;
  promotionDiscount: number;
  appliedPromotions: AppliedPromotion[];
  discount: number;
  roundOff: number;
}

interface PaymentModalProps {
  open: boolean;
  items: CartItem[];
  cartMutators: CartMutators;
  initialDiscountType?: CheckoutDiscountType;
  initialDiscountInput?: number;
  initialLoyaltyPointsRedeemed?: number;
  productCategoryMap: Record<string, string>;
  customerId: string | null;
  onCustomerChange: (id: string | null) => void;
  onAddCustomer: () => void;
  customer?: PaymentCustomerInfo | null;
  saleDate?: string;
  loading?: boolean;
  transaction?: Transaction | null;
  tenderedAmount?: number;
  error?: string;
  defaultPaymentMethod?: PaymentMethod;
  autoPrint?: boolean;
  receiptBranding?: ReceiptBranding;
  onConfirm: (payload: PaymentConfirmPayload) => void;
  onClose: () => void;
  onNewSale: () => void;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'esewa', label: 'eSewa' },
];

/** Nearest multiple of 5 (NPR cash roundoff). */
function roundToNearest5(amount: number): number {
  return Math.round(amount / 5) * 5;
}

const noNumberSpinnerSx = {
  MozAppearance: 'textfield',
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': {
    WebkitAppearance: 'none',
    margin: 0,
  },
} as const;

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="overline"
      sx={{ fontWeight: 700, letterSpacing: 0.8, color: 'text.secondary', display: 'block', mb: 0.5 }}
    >
      {children}
    </Typography>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PaymentModal({
  open,
  items,
  cartMutators,
  initialDiscountType = null,
  initialDiscountInput = 0,
  initialLoyaltyPointsRedeemed = 0,
  productCategoryMap,
  customerId,
  onCustomerChange,
  onAddCustomer,
  customer,
  saleDate,
  loading,
  transaction,
  tenderedAmount,
  error,
  defaultPaymentMethod = 'cash',
  autoPrint = false,
  receiptBranding,
  onConfirm,
  onClose,
  onNewSale,
}: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tendered, setTendered] = useState('');
  const [roundOffEnabled, setRoundOffEnabled] = useState(false);
  const printedTxnId = useRef<string | null>(null);
  const openSessionRef = useRef(false);
  const customerIdAtOpenRef = useRef<string | null>(customerId);

  const resolvedDefaultMethod: PaymentMethod =
    defaultPaymentMethod === 'card'
      ? 'bank'
      : (defaultPaymentMethod as string) === 'khalti'
        ? 'esewa'
        : defaultPaymentMethod;

  const draft = useCheckoutDraft(items, productCategoryMap, cartMutators);
  const formatDate = useFormatDate();

  useEffect(() => {
    if (!open) {
      openSessionRef.current = false;
      return;
    }
    if (transaction || openSessionRef.current) return;

    openSessionRef.current = true;
    customerIdAtOpenRef.current = customerId;
    draft.initDraft({
      discountType: initialDiscountType,
      discountInput: initialDiscountInput,
      loyaltyPointsRedeemed: initialLoyaltyPointsRedeemed,
    });
    setMethod(resolvedDefaultMethod);
    setTendered('');
    setRoundOffEnabled(false);
    printedTxnId.current = null;
  }, [
    open,
    transaction,
    resolvedDefaultMethod,
    initialDiscountType,
    initialDiscountInput,
    initialLoyaltyPointsRedeemed,
    customerId,
    draft.initDraft,
  ]);

  useEffect(() => {
    if (!open || !openSessionRef.current) return;
    if (customerIdAtOpenRef.current === customerId) return;
    customerIdAtOpenRef.current = customerId;
    draft.setLoyalty(0);
  }, [customerId, open, draft.setLoyalty]);

  useEffect(() => {
    if (!transaction) {
      printedTxnId.current = null;
      return;
    }
    if (autoPrint && printedTxnId.current !== transaction.id) {
      printedTxnId.current = transaction.id;
      const cash = tenderedAmount ?? (method === 'cash' ? parseFloat(tendered) || undefined : undefined);
      printTransactionReceipt(transaction, cash, receiptBranding);
    }
  }, [transaction, autoPrint, tenderedAmount, method, tendered, receiptBranding]);

  const rawTotal = draft.total;
  const payableTotal = roundOffEnabled ? roundToNearest5(rawTotal) : rawTotal;
  const roundOffAmount = roundOffEnabled ? Math.round((payableTotal - rawTotal) * 100) / 100 : 0;

  const tenderedNum = parseFloat(tendered) || 0;
  const change = tenderedNum - payableTotal;
  const showReceipt = !!transaction;
  const cashSuggestions = useMemo(() => cashTenderSuggestions(payableTotal), [payableTotal]);
  const breakdown = draft.discountBreakdown;

  const handleConfirm = () => {
    onConfirm({
      method,
      tendered: method === 'cash' ? tenderedNum : undefined,
      items: draft.paymentItems,
      subtotal: draft.subtotal,
      total: payableTotal,
      manualDiscount: draft.manualDiscount,
      loyaltyPointsRedeemed: draft.loyaltyPointsRedeemed,
      notes: draft.notes.trim(),
      promotionDiscount: draft.promotionDiscount,
      appliedPromotions: draft.appliedPromotions,
      discount: breakdown.promotionCartDiscount + draft.manualDiscount + draft.loyaltyPointsRedeemed,
      roundOff: roundOffAmount,
    });
  };

  if (showReceipt) {
    const txn = transaction!;
    const cash = tenderedAmount ?? (method === 'cash' ? tenderedNum : undefined);

    return (
      <Dialog open={open} maxWidth="sm" fullWidth>
        <Box sx={{ bgcolor: 'success.main', py: 2, textAlign: 'center' }}>
          <CheckCircleIcon sx={{ color: '#fff', fontSize: 36, mb: 0.5 }} />
          <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700 }}>
            Payment Successful
          </Typography>
          <Typography variant="body2" sx={{ color: 'success.light' }}>
            {txn.transactionNumber}
          </Typography>
        </Box>

        <DialogContent sx={{ px: 2, pt: 2, pb: 1 }}>
          <ReceiptView transaction={txn} tenderedAmount={cash} branding={receiptBranding} />
        </DialogContent>

        <DialogActions sx={{ px: 2, pb: 2, gap: 1, flexDirection: 'column', alignItems: 'stretch' }}>
          <ReceiptActions transaction={txn} tenderedAmount={cash} branding={receiptBranding} compact />
          <Button variant="contained" fullWidth startIcon={<AddShoppingCartIcon />} onClick={onNewSale}>
            New Sale
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  const totalUnits = draft.items.reduce((sum, item) => sum + item.quantity, 0);
  const customerLoyalty = customer?.loyaltyPoints ?? 0;
  const orderCols = '28px minmax(0, 1.4fr) 84px 52px 68px 56px 72px 32px';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      slotProps={{
        paper: {
          sx: {
            width: 'min(1100px, 96vw)',
            maxHeight: '92vh',
            m: 1.5,
          },
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 700, pb: 1, display: 'flex', alignItems: 'flex-start', gap: 2, pr: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          Confirm Payment
          {saleDate && (
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400, mt: 0.25 }}>
              Sale date: {formatDate(saleDate)}
            </Typography>
          )}
        </Box>
        <Typography
          variant="body2"
          sx={{ fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap', pt: 0.35 }}
        >
          {totalUnits} item{totalUnits === 1 ? '' : 's'} · {formatCurrency(payableTotal)}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5, flexShrink: 0 }}>
            {error}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.35fr 1fr' },
            gap: 1.5,
            alignItems: 'stretch',
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Left: order items */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: { md: 420 },
            }}
          >
            <SectionLabel>Order items</SectionLabel>
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                mb: 1,
                overflow: 'hidden',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: orderCols,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  px: 1,
                  py: 0.75,
                  gap: 0.5,
                  flexShrink: 0,
                }}
              >
                {['#', 'Item', 'Qty', 'UOM', 'Price', 'Disc', 'Total', ''].map((label, i) => (
                  <Typography
                    key={label || 'actions'}
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      textAlign: i === 0 || i === 3 ? 'center' : i >= 2 && i < 7 ? 'right' : 'left',
                      fontSize: '0.68rem',
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}
                  >
                    {label}
                  </Typography>
                ))}
              </Box>

              <Box sx={{ flex: 1, overflow: 'auto', minHeight: 200, maxHeight: { xs: 280, md: 'none' } }}>
                {draft.items.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                    No items — add a product below
                  </Typography>
                ) : (
                  draft.items.map((item, index) => {
                    const lineKey = cartLineKey(item.productId, item.sellUom);
                    const perUnitDiscount = draft.paymentItems.find(
                      (p) => cartLineKey(p.productId, p.sellUom) === lineKey,
                    )?.discount ?? 0;
                    const lineDiscount = perUnitDiscount * item.quantity;
                    const lineGross = item.price * item.quantity;
                    const lineNet = lineGross - lineDiscount;

                    return (
                      <Box
                        key={lineKey}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: orderCols,
                          px: 1,
                          py: 0.65,
                          gap: 0.5,
                          alignItems: 'center',
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          bgcolor: index % 2 === 0 ? 'background.paper' : 'action.hover',
                        }}
                      >
                        <Typography variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary' }}>
                          {index + 1}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem', lineHeight: 1.3 }} noWrap title={item.name}>
                          {item.name}
                        </Typography>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.25 }}>
                          <IconButton
                            size="small"
                            aria-label="Decrease quantity"
                            onClick={() => draft.updateQty(item.productId, item.quantity - 1, item.sellUom)}
                            disabled={item.quantity <= 1}
                            sx={{ p: 0.25, width: 22, height: 22 }}
                          >
                            <RemoveIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                          <Typography variant="body2" sx={{ minWidth: 20, textAlign: 'center', fontWeight: 700, fontSize: '0.75rem' }}>
                            {item.quantity}
                          </Typography>
                          <IconButton
                            size="small"
                            aria-label="Increase quantity"
                            onClick={() => draft.updateQty(item.productId, item.quantity + 1, item.sellUom)}
                            sx={{ p: 0.25, width: 22, height: 22 }}
                          >
                            <AddIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Box>
                        <Typography variant="caption" sx={{ textAlign: 'center', fontWeight: 600, fontSize: '0.7rem' }}>
                          {uomLabel(item.sellUom || item.uom || '')}
                        </Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem' }}>
                          {formatAmount(item.price)}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontSize: '0.8125rem',
                            color: lineDiscount > 0 ? 'success.main' : 'text.disabled',
                          }}
                        >
                          {lineDiscount > 0 ? `- ${formatAmount(lineDiscount)}` : '—'}
                        </Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {formatAmount(lineNet)}
                        </Typography>
                        <IconButton
                          size="small"
                          aria-label="Remove item"
                          onClick={() => draft.removeLine(item.productId, item.sellUom)}
                          sx={{ p: 0.25 }}
                        >
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Box>
                    );
                  })
                )}
              </Box>
            </Box>

            <PosAddProductAutocomplete
              onAdd={(product, asPack) => draft.addProduct(product, asPack)}
            />
          </Box>

          {/* Right: customer, discounts, remarks, totals, payment */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              minWidth: 0,
              overflow: 'visible',
            }}
          >
            <Paper variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
              <CustomerPicker
                customerId={customerId}
                onCustomerChange={onCustomerChange}
                onAddCustomer={onAddCustomer}
              />
            </Paper>

            <Paper variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
              <SectionLabel>Discounts</SectionLabel>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mb: customerLoyalty > 0 ? 0.5 : 0 }}>
                <ToggleButtonGroup
                  value={draft.discountType}
                  exclusive
                  size="small"
                  onChange={(_, v: CheckoutDiscountType) => {
                    draft.setDiscount(v ?? null, 0);
                  }}
                >
                  <ToggleButton value="flat" sx={{ px: 1.25, py: 0.25, fontSize: '0.7rem' }}>NPR</ToggleButton>
                  <ToggleButton value="pct" sx={{ px: 1.25, py: 0.25, fontSize: '0.7rem' }}>%</ToggleButton>
                </ToggleButtonGroup>
                {draft.discountType !== null && (
                  <TextField
                    placeholder={draft.discountType === 'pct' ? '%' : 'NPR'}
                    type="number"
                    size="small"
                    value={draft.discountInput || ''}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      const max = draft.discountType === 'pct' ? 100 : draft.netAfterPromo;
                      draft.setDiscount(draft.discountType, Math.min(Math.max(0, v), max));
                    }}
                    slotProps={{
                      htmlInput: {
                        min: 0,
                        max: draft.discountType === 'pct' ? 100 : draft.netAfterPromo,
                        step: draft.discountType === 'pct' ? 5 : 10,
                      },
                    }}
                    sx={{
                      width: 88,
                      ...noNumberSpinnerSx,
                      '& .MuiInputBase-root': { height: 28 },
                    }}
                  />
                )}
              </Box>

              {customerLoyalty > 0 && (
                <TextField
                  label="Loyalty pts"
                  type="number"
                  size="small"
                  fullWidth
                  value={draft.loyaltyInput || ''}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10) || 0;
                    draft.setLoyalty(Math.min(v, customerLoyalty, draft.maxLoyalty));
                  }}
                  slotProps={{
                    htmlInput: { min: 0, max: Math.min(customerLoyalty, draft.maxLoyalty) },
                  }}
                  sx={{ ...noNumberSpinnerSx, '& .MuiInputBase-root': { height: 32 } }}
                />
              )}

              {breakdown.appliedPromotions.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {breakdown.appliedPromotions.map((promo) => (
                    <Chip
                      key={promo.ruleId}
                      icon={<LocalOfferOutlinedIcon />}
                      label={`${promo.name} (−${formatAmount(promo.amount)})`}
                      size="small"
                      color="success"
                      variant="outlined"
                    />
                  ))}
                </Box>
              )}
            </Paper>

            <TextField
              label="Remarks / description"
              multiline
              minRows={1}
              maxRows={2}
              fullWidth
              size="small"
              value={draft.notes}
              onChange={(e) => draft.setNotes(e.target.value)}
              slotProps={{
                htmlInput: { maxLength: 500 },
                formHelperText: { sx: { m: 0, mt: 0.25 } },
              }}
              helperText={`${draft.notes.length}/500`}
            />

            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography variant="caption" color="text.secondary">Subtotal</Typography>
                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatAmount(draft.subtotal)}</Typography>
              </Box>
              {breakdown.promotionLineDiscount > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                  <Typography variant="caption" color="text.secondary">Item promotions</Typography>
                  <Typography variant="caption" color="success.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    - {formatAmount(breakdown.promotionLineDiscount)}
                  </Typography>
                </Box>
              )}
              {breakdown.promotionCartDiscount > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                  <Typography variant="caption" color="text.secondary">Cart promotion</Typography>
                  <Typography variant="caption" color="success.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    - {formatAmount(breakdown.promotionCartDiscount)}
                  </Typography>
                </Box>
              )}
              {breakdown.manualDiscount > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                  <Typography variant="caption" color="text.secondary">Manual discount</Typography>
                  <Typography variant="caption" color="success.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    - {formatAmount(breakdown.manualDiscount)}
                  </Typography>
                </Box>
              )}
              {breakdown.loyaltyPointsRedeemed > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                  <Typography variant="caption" color="text.secondary">Loyalty</Typography>
                  <Typography variant="caption" color="success.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    - {formatAmount(breakdown.loyaltyPointsRedeemed)}
                  </Typography>
                </Box>
              )}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  mt: 0.25,
                  mb: 0.25,
                }}
              >
                <FormControlLabel
                  sx={{
                    mx: 0,
                    mr: 0,
                    flex: 1,
                    minWidth: 0,
                    '& .MuiFormControlLabel-label': { fontSize: '0.8rem' },
                    '& .MuiCheckbox-root': { py: 0.25, pl: 0 },
                  }}
                  control={
                    <Checkbox
                      size="small"
                      checked={roundOffEnabled}
                      onChange={(_, checked) => setRoundOffEnabled(checked)}
                      disabled={loading}
                    />
                  }
                  label="Roundoff"
                />
                {roundOffEnabled && (
                  <Typography
                    variant="caption"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                      color: roundOffAmount === 0
                        ? 'text.secondary'
                        : roundOffAmount > 0
                          ? 'text.primary'
                          : 'success.main',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {roundOffAmount === 0
                      ? formatAmount(0)
                      : `${roundOffAmount > 0 ? '+ ' : '- '}${formatAmount(Math.abs(roundOffAmount))}`}
                  </Typography>
                )}
              </Box>
              <Divider sx={{ my: 0.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Amount due</Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(payableTotal)}
                </Typography>
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
              <SectionLabel>Payment</SectionLabel>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: method === 'cash' ? { xs: '1fr', sm: '1fr 1fr' } : '1fr',
                  gap: 1,
                  alignItems: 'start',
                }}
              >
                <TextField
                  select
                  label="Payment method"
                  size="small"
                  fullWidth
                  value={method}
                  disabled={loading}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                >
                  {METHODS.map((m) => (
                    <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                  ))}
                </TextField>

                {method === 'cash' && (
                  <TextField
                    label="Cash tendered"
                    value={tendered}
                    onChange={(e) => setTendered(e.target.value)}
                    type="number"
                    size="small"
                    fullWidth
                    autoFocus
                    disabled={loading}
                    sx={noNumberSpinnerSx}
                    slotProps={{ htmlInput: { min: 0, step: 5 } }}
                  />
                )}
              </Box>

              {method === 'cash' && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75, alignItems: 'center' }}>
                  {cashSuggestions.map((amount) => (
                    <Chip
                      key={amount}
                      label={formatCurrency(amount)}
                      size="small"
                      clickable
                      color={tenderedNum === amount ? 'primary' : 'default'}
                      onClick={() => setTendered(String(amount))}
                    />
                  ))}
                  {tenderedNum > 0 && (
                    <Alert
                      severity={change >= 0 ? 'success' : 'error'}
                      icon={false}
                      sx={{ py: 0.35, px: 1, ml: { sm: 'auto' } }}
                    >
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {change >= 0 ? 'Change' : 'Short'}{' '}
                        {formatCurrency(Math.abs(change))}
                      </Typography>
                    </Alert>
                  )}
                </Box>
              )}

              {method !== 'cash' && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                  Collect {formatCurrency(payableTotal)} via {METHODS.find((m) => m.value === method)?.label}
                </Typography>
              )}
            </Paper>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, pt: 1 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          size="large"
          loading={loading}
          disabled={
            draft.items.length === 0
            || (method === 'cash' && (tenderedNum <= 0 || tenderedNum < payableTotal))
          }
          onClick={handleConfirm}
          sx={{ minWidth: 180 }}
        >
          Confirm Payment
        </Button>
      </DialogActions>
    </Dialog>
  );
}
