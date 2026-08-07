import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Typography,
  Chip,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  CircularProgress,
  Alert,
  MenuItem,
  Select,
  TextField,
  Checkbox,
  Link,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid,
  InputAdornment,
  InputLabel,
  FormControl,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import InventoryIcon from '@mui/icons-material/Inventory';
import PaymentsIcon from '@mui/icons-material/Payments';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PageHeader } from '@/components/common/PageHeader';
import { NepaliAwareDatePicker } from '@/components/common/NepaliAwareDatePicker';
import { FormModal } from '@/components/common/FormModal';
import {
  usePurchaseOrder,
  useUpdatePurchaseOrderStatus,
  useReceivePurchaseOrderItems,
  useRecordPurchaseOrderPayment,
} from '@/hooks/usePurchaseOrders';
import { formatCurrency, canManagePurchaseOrders } from '@/utils';
import { CURRENCY_SYMBOL } from '@/constants';
import { useFormatDate } from '@/hooks/useFormatDate';
import { canEditPurchaseOrder } from '@/utils/canEditPurchaseOrder';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import { PAYMENT_METHODS, PO_LINE_STATUS_LABELS, PO_PAYMENT_STATUS_LABELS, PO_STATUS_LABELS } from '@/constants';
import { useAuthStore } from '@/store';
import type {
  PurchaseOrderLineStatus,
  PurchaseOrderPaymentStatus,
  PurchaseOrderReceiveItem,
  PurchaseOrderStatus,
} from '@/types';
import {
  PO_DETAIL_FLAT_COLUMNS,
  poDetailFlatColWidths,
  poDetailTableMinWidth,
} from '@/pages/purchase-orders/poLineTableColumns';
import { PO_LABELS, PO_RECEIVE_HINT } from '@/pages/purchase-orders/poTerminology';

const PAYMENT_SCHEMA = z.object({
  amount: z.number({ error: 'Amount is required' }).positive('Amount must be positive'),
  date: z.string().min(1, 'Payment date is required'),
  paymentMethod: z.string().min(1, 'Payment method is required'),
  billNo: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentFormValues = z.infer<typeof PAYMENT_SCHEMA>;

const STATUS_COLORS: Record<PurchaseOrderStatus, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  draft: 'default', ordered: 'warning', partial: 'info', received: 'success', cancelled: 'error',
};

const PAYMENT_COLORS: Record<PurchaseOrderPaymentStatus, 'default' | 'warning' | 'success'> = {
  unpaid: 'default',
  partial: 'warning',
  paid: 'success',
};

const LINE_STATUS_COLORS: Record<PurchaseOrderLineStatus, 'default' | 'warning' | 'success'> = {
  pending: 'default',
  partial: 'warning',
  received: 'success',
};

const NEXT_STATUSES: Partial<Record<PurchaseOrderStatus, PurchaseOrderStatus[]>> = {
  draft: ['ordered', 'cancelled'],
  ordered: ['cancelled'],
  partial: ['cancelled'],
};

const PAYABLE_STATUSES = new Set<PurchaseOrderStatus>(['ordered', 'partial', 'received']);

interface ReceiveSelection {
  selected: boolean;
  receiveQuantity: number;
  expiryDate: string;
  unitsPerBuyUom?: number;
}

const headerCellSx = { fontWeight: 700, whiteSpace: 'nowrap', py: 1.25 };

export function PurchaseOrderDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const formatDate = useFormatDate();
  const canManage = canManagePurchaseOrders(user?.role);
  const [statusValue, setStatusValue] = useState('');
  const [statusError, setStatusError] = useState('');
  const [receiveError, setReceiveError] = useState('');
  const [receiveSelections, setReceiveSelections] = useState<Record<string, ReceiveSelection>>({});
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  const {
    register,
    handleSubmit: handlePaymentSubmit,
    control: paymentControl,
    reset: resetPaymentForm,
    formState: { errors: paymentErrors },
  } = useForm<PaymentFormValues>({
    resolver: zodResolver(PAYMENT_SCHEMA),
    defaultValues: {
      amount: undefined,
      date: new Date().toISOString().slice(0, 10),
      paymentMethod: 'cash',
      billNo: '',
      notes: '',
    },
  });

  const { data: po, isLoading, isError } = usePurchaseOrder(id ?? '');
  const statusMutation = useUpdatePurchaseOrderStatus();
  const receiveMutation = useReceivePurchaseOrderItems();
  const paymentMutation = useRecordPurchaseOrderPayment();

  const canReceive = po?.status === 'ordered' || po?.status === 'partial';
  const amountPaid = po?.amountPaid ?? 0;
  const remaining = po ? Math.max(0, Math.round((po.totalAmount - amountPaid) * 100) / 100) : 0;
  const paymentStatus: PurchaseOrderPaymentStatus = po?.paymentStatus ?? 'unpaid';
  const canPay = Boolean(po && canManage && PAYABLE_STATUSES.has(po.status) && remaining > 0);

  const getReceiveSelection = (productId: string, remaining: number): ReceiveSelection =>
    receiveSelections[productId] ?? { selected: false, receiveQuantity: remaining || 1, expiryDate: '' };

  const updateReceiveSelection = (productId: string, remaining: number, patch: Partial<ReceiveSelection>) => {
    setReceiveSelections((prev) => {
      const base = prev[productId] ?? { selected: false, receiveQuantity: remaining || 1, expiryDate: '' };
      return { ...prev, [productId]: { ...base, ...patch } };
    });
  };

  const receivableItems = useMemo(() => po?.items ?? [], [po]);

  const selectAllState = useMemo(() => {
    if (receivableItems.length === 0) return { checked: false, indeterminate: false };
    const selectedCount = receivableItems.filter((item) => {
      const remaining = item.quantity - item.receivedQuantity;
      return getReceiveSelection(item.productId, remaining).selected;
    }).length;
    return {
      checked: selectedCount === receivableItems.length,
      indeterminate: selectedCount > 0 && selectedCount < receivableItems.length,
    };
  }, [receivableItems, receiveSelections]);

  const handleSelectAll = (checked: boolean) => {
    setReceiveSelections((prev) => {
      const next = { ...prev };
      for (const item of receivableItems) {
        const remaining = item.quantity - item.receivedQuantity;
        const base = next[item.productId] ?? { receiveQuantity: remaining > 0 ? remaining : 1, expiryDate: '', selected: false };
        next[item.productId] = { ...base, selected: checked, receiveQuantity: remaining > 0 ? remaining : 1 };
      }
      return next;
    });
  };

  const itemsToReceive = useMemo((): PurchaseOrderReceiveItem[] => {
    if (!po) return [];
    return po.items
      .filter((item) => {
        const remaining = item.quantity - item.receivedQuantity;
        const sel = getReceiveSelection(item.productId, remaining);
        return sel.selected && sel.receiveQuantity > 0;
      })
      .map((item) => {
        const remaining = item.quantity - item.receivedQuantity;
        const sel = getReceiveSelection(item.productId, remaining);
        const payload: PurchaseOrderReceiveItem = {
          productId: item.productId,
          receiveQuantity: sel.receiveQuantity,
        };
        if (sel.expiryDate) payload.expiryDate = sel.expiryDate;
        const lineUnits = item.unitsPerBuyUom ?? 1;
        if (sel.unitsPerBuyUom && sel.unitsPerBuyUom !== lineUnits) {
          payload.unitsPerBuyUom = sel.unitsPerBuyUom;
        }
        return payload;
      });
  }, [po, receiveSelections]);

  const handleStatusChange = async (status: PurchaseOrderStatus) => {
    if (!po) return;
    setStatusError('');
    setStatusValue(status);
    try {
      await statusMutation.mutateAsync({ id: po.id, status });
      showSuccess('Purchase Order updated.');
      setStatusValue('');
    } catch (err) {
      setStatusError(getErrorMessage(err));
      setStatusValue('');
    }
  };

  const handleReceive = async () => {
    if (!po) return;
    if (itemsToReceive.length === 0) {
      setReceiveError('Select at least one item with a pack qty');
      return;
    }
    setReceiveError('');
    try {
      await receiveMutation.mutateAsync({ id: po.id, items: itemsToReceive });
      showSuccess('Purchase Order received.');
      setReceiveSelections({});
    } catch (err) {
      setReceiveError(getErrorMessage(err));
    }
  };

  const openPaymentDialog = () => {
    if (!po) return;
    resetPaymentForm({
      amount: remaining,
      date: new Date().toISOString().slice(0, 10),
      paymentMethod: 'cash',
      billNo: '',
      notes: '',
    });
    setPaymentError('');
    setPaymentOpen(true);
  };

  const handleRecordPayment = async (values: PaymentFormValues) => {
    if (!po) return;
    const amount = values.amount;
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError('Enter a valid payment amount.');
      return;
    }
    if (amount > remaining + 0.001) {
      setPaymentError(`Amount cannot exceed remaining balance (${remaining.toFixed(2)}).`);
      return;
    }
    if (!values.date) {
      setPaymentError('Payment date is required.');
      return;
    }
    setPaymentError('');
    try {
      await paymentMutation.mutateAsync({
        id: po.id,
        data: {
          amount,
          date: values.date,
          paymentMethod: values.paymentMethod,
          billNo: values.billNo?.trim() || undefined,
          notes: values.notes?.trim() || undefined,
        },
      });
      showSuccess('Payment recorded and expense created.');
      setPaymentOpen(false);
    } catch (err) {
      setPaymentError(getErrorMessage(err));
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (isError || !po) return <Alert severity="error">Purchase order not found.</Alert>;

  const nextStatuses = NEXT_STATUSES[po.status] ?? [];
  const receivedCount = po.items.filter((i) => i.receivedQuantity >= i.quantity).length;

  return (
    <Box>
      <PageHeader
        title={po.orderNumber}
        breadcrumbs={[{ label: 'Purchase Orders', path: '/purchase-orders' }, { label: po.orderNumber }]}
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/purchase-orders')}>
              Back
            </Button>
            {canManage && canEditPurchaseOrder(po) && (
              <Button
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={() => navigate(`/purchase-orders/${po.id}/edit`)}
              >
                Edit
              </Button>
            )}
            {canManage && canReceive && (
              <Button
                variant="contained"
                startIcon={<InventoryIcon />}
                onClick={() => void handleReceive()}
                loading={receiveMutation.isPending}
                disabled={itemsToReceive.length === 0}
              >
                Process Receipt
              </Button>
            )}
            {canPay && (
              <Button
                variant="outlined"
                startIcon={<PaymentsIcon />}
                onClick={openPaymentDialog}
              >
                Record Payment
              </Button>
            )}
            {canManage && nextStatuses.length > 0 && (
              <TextField
                select
                size="small"
                label="Update Status"
                value={statusValue}
                disabled={statusMutation.isPending}
                onChange={(e) => {
                  const next = e.target.value as PurchaseOrderStatus;
                  if (next) void handleStatusChange(next);
                }}
                sx={{ minWidth: 170 }}
              >
                {nextStatuses.map((s) => (
                  <MenuItem key={s} value={s}>{PO_STATUS_LABELS[s]}</MenuItem>
                ))}
              </TextField>
            )}
          </Box>
        }
      />

      {(statusError || receiveError) && (
        <Alert severity="error" sx={{ mb: 2 }}>{statusError || receiveError}</Alert>
      )}

      <Paper sx={{ px: 2, py: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Supplier
            </Typography>
            <Link
              component={RouterLink}
              to={`/suppliers/${po.supplierId}`}
              variant="subtitle1"
              sx={{ fontWeight: 600 }}
              title={po.supplierName}
            >
              {po.supplierName}
            </Link>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip label={PO_STATUS_LABELS[po.status]} color={STATUS_COLORS[po.status]} size="small" sx={{ fontWeight: 600 }} />
            <Chip
              label={PO_PAYMENT_STATUS_LABELS[paymentStatus]}
              color={PAYMENT_COLORS[paymentStatus]}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          </Box>
          <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Order total</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {formatCurrency(po.totalAmount)}
            </Typography>
          </Box>
        </Box>
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Expected delivery</Typography>
            <Typography variant="body2">{po.expectedDelivery ? formatDate(po.expectedDelivery) : '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Items</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {po.items.length}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                · {receivedCount} received
              </Typography>
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Ordered by</Typography>
            <Typography variant="body2">{po.orderedBy ?? '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Received by</Typography>
            <Typography variant="body2">{po.receivedBy ?? '—'}</Typography>
          </Grid>
        </Grid>
        <Accordion disableGutters elevation={0} sx={{ mt: 1.5, bgcolor: 'transparent', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40 }}>
            <Typography variant="body2" color="text.secondary">More details</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0, pt: 0 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Received date</Typography>
                <Typography variant="body2">{po.receivedDate ? formatDate(po.receivedDate) : '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Created</Typography>
                <Typography variant="body2">{formatDate(po.createdAt)}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Last updated</Typography>
                <Typography variant="body2">{formatDate(po.updatedAt)}</Typography>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      </Paper>

      <Paper sx={{ px: 2, py: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Payments</Typography>
          {canPay && (
            <Button size="small" startIcon={<PaymentsIcon />} onClick={openPaymentDialog}>
              Record payment
            </Button>
          )}
        </Box>
        <Grid container spacing={2} sx={{ mb: 1.5 }}>
          <Grid size={{ xs: 4 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Paid</Typography>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>{formatCurrency(amountPaid)}</Typography>
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Remaining</Typography>
            <Typography variant="body1" sx={{ fontWeight: 700, color: remaining > 0 ? 'warning.main' : 'success.main' }}>
              {formatCurrency(remaining)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Status</Typography>
            <Chip
              label={PO_PAYMENT_STATUS_LABELS[paymentStatus]}
              color={PAYMENT_COLORS[paymentStatus]}
              size="small"
              sx={{ mt: 0.25 }}
            />
          </Grid>
        </Grid>
        {(po.payments?.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary">No payments recorded yet.</Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Bill no.</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Method</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Amount</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Notes</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Recorded by</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(po.payments ?? []).map((payment, index) => (
                  <TableRow key={`${payment.expenseId}-${index}`}>
                    <TableCell>{formatDate(payment.date)}</TableCell>
                    <TableCell>{payment.billNo?.trim() ? payment.billNo : '—'}</TableCell>
                    <TableCell sx={{ textTransform: 'capitalize' }}>{payment.paymentMethod}</TableCell>
                    <TableCell align="right">{formatCurrency(payment.amount)}</TableCell>
                    <TableCell>{payment.notes || '—'}</TableCell>
                    <TableCell>{payment.createdBy || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Order Items</Typography>
            {canReceive && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {PO_RECEIVE_HINT}
              </Typography>
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {po.items.length} product{po.items.length !== 1 ? 's' : ''}
          </Typography>
        </Box>
        <Divider sx={{ mb: 2 }} />

        <TableContainer sx={{ overflowX: 'auto', maxWidth: '100%' }}>
          <Table
            size="small"
            sx={{
              tableLayout: 'auto',
              minWidth: poDetailTableMinWidth(canReceive),
              '& .MuiTableCell-root': { verticalAlign: 'middle', py: 1.25 },
            }}
          >
            <colgroup>
              {poDetailFlatColWidths(canReceive).map((width, i) => (
                <col key={i} style={{ width, minWidth: width }} />
              ))}
            </colgroup>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                {canReceive && (
                  <TableCell padding="checkbox" sx={headerCellSx}>
                    <Checkbox
                      size="small"
                      checked={selectAllState.checked}
                      indeterminate={selectAllState.indeterminate}
                      disabled={receivableItems.length === 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </TableCell>
                )}
                <TableCell align="center" sx={headerCellSx}>#</TableCell>
                <TableCell sx={headerCellSx}>Product</TableCell>
                <TableCell align="right" sx={headerCellSx}>{PO_LABELS.ordered}</TableCell>
                <TableCell align="right" sx={headerCellSx}>{PO_LABELS.received}</TableCell>
                {canReceive && <TableCell align="right" sx={headerCellSx}>{PO_LABELS.packQty}</TableCell>}
                <TableCell align="right" sx={headerCellSx}>{PO_LABELS.unitsPerPack}</TableCell>
                <TableCell align="right" sx={headerCellSx}>{PO_LABELS.totalUnits}</TableCell>
                {canReceive && <TableCell sx={headerCellSx}>{PO_LABELS.expiryOptional}</TableCell>}
                <TableCell sx={headerCellSx}>Status</TableCell>
                <TableCell align="right" sx={headerCellSx}>{PO_LABELS.unitCost}</TableCell>
                <TableCell align="right" sx={headerCellSx}>{PO_LABELS.lineTotal}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {po.items.map((item, index) => {
                const remaining = item.quantity - item.receivedQuantity;
                const receiveSel = getReceiveSelection(item.productId, remaining);
                const orderUom = item.orderUom ?? 'pcs';
                const unitsPerBuy = receiveSel.unitsPerBuyUom ?? item.unitsPerBuyUom ?? 1;
                const orderedTotalUnits = item.quantity * (item.unitsPerBuyUom ?? 1);
                const receiveTotalUnits = receiveSel.selected
                  ? receiveSel.receiveQuantity * unitsPerBuy
                  : 0;
                const lineStatus = item.lineStatus ?? (
                  item.receivedQuantity <= 0 ? 'pending'
                  : item.receivedQuantity >= item.quantity ? 'received'
                  : 'partial'
                );
                const defaultPackQty = remaining > 0 ? remaining : 1;

                return (
                  <TableRow key={item.productId} selected={canReceive && receiveSel.selected}>
                    {canReceive && (
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={receiveSel.selected}
                          onChange={(e) =>
                            updateReceiveSelection(item.productId, remaining, {
                              selected: e.target.checked,
                              receiveQuantity: receiveSel.receiveQuantity || defaultPackQty,
                              unitsPerBuyUom: receiveSel.unitsPerBuyUom ?? item.unitsPerBuyUom ?? 1,
                            })
                          }
                        />
                      </TableCell>
                    )}
                    <TableCell align="center">
                      <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                        {index + 1}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: PO_DETAIL_FLAT_COLUMNS.product }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }} title={item.productName}>
                        {item.productName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {item.quantity} {orderUom} · {orderedTotalUnits} {PO_LABELS.totalUnits.toLowerCase()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{item.quantity}</TableCell>
                    <TableCell align="right">{item.receivedQuantity}</TableCell>
                    {canReceive && (
                      <TableCell align="right">
                        <TextField
                          size="small"
                          type="number"
                          value={receiveSel.receiveQuantity}
                          disabled={!receiveSel.selected}
                          onChange={(e) => {
                            const raw = Math.max(1, parseInt(e.target.value, 10) || 1);
                            const capped = remaining > 0 ? Math.min(raw, remaining) : raw;
                            updateReceiveSelection(item.productId, remaining, {
                              receiveQuantity: capped,
                            });
                          }}
                          sx={{ width: '100%', minWidth: 72 }}
                          slotProps={{ htmlInput: { min: 1, max: Math.max(remaining, 1) } }}
                        />
                      </TableCell>
                    )}
                    <TableCell align="right">
                      {canReceive ? (
                        <TextField
                          size="small"
                          type="number"
                          value={unitsPerBuy}
                          disabled={!receiveSel.selected}
                          onChange={(e) =>
                            updateReceiveSelection(item.productId, remaining, {
                              unitsPerBuyUom: Math.max(1, parseInt(e.target.value, 10) || 1),
                            })
                          }
                          sx={{ width: '100%', minWidth: 72 }}
                          slotProps={{ htmlInput: { min: 1 } }}
                        />
                      ) : (
                        item.unitsPerBuyUom ?? 1
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {canReceive ? (receiveSel.selected ? receiveTotalUnits : '—') : orderedTotalUnits}
                    </TableCell>
                    {canReceive && (
                      <TableCell>
                        <Box sx={{ width: '100%', minWidth: 120 }}>
                          <NepaliAwareDatePicker
                            label="Expiry"
                            value={receiveSel.expiryDate}
                            onChange={(d) =>
                              updateReceiveSelection(item.productId, remaining, { expiryDate: d })
                            }
                            size="small"
                            disabled={!receiveSel.selected}
                            calendarSystem="AD"
                            helperText={receiveSel.selected ? 'AD — optional' : undefined}
                          />
                        </Box>
                      </TableCell>
                    )}
                    <TableCell>
                      <Chip label={PO_LINE_STATUS_LABELS[lineStatus]} size="small" color={LINE_STATUS_COLORS[lineStatus]} />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {formatCurrency(item.unitCost)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {formatCurrency(item.quantity * item.unitCost)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Divider sx={{ mt: 2, mb: 1 }} />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Order Total: {formatCurrency(po.totalAmount)}
          </Typography>
        </Box>
      </Paper>

      <FormModal
        open={paymentOpen}
        title="Record Payment"
        onClose={() => setPaymentOpen(false)}
        onSubmit={handlePaymentSubmit(handleRecordPayment)}
        submitLabel="Save payment"
        loading={paymentMutation.isPending}
        maxWidth="sm"
      >
        {paymentError && <Alert severity="error" sx={{ mb: 2 }}>{paymentError}</Alert>}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Remaining balance: {formatCurrency(remaining)}. This creates a linked expense under Purchase Order.
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Amount"
              type="number"
              size="small"
              fullWidth
              required
              {...register('amount', { valueAsNumber: true })}
              error={!!paymentErrors.amount}
              helperText={paymentErrors.amount?.message}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">{CURRENCY_SYMBOL}</InputAdornment>
                  ),
                },
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              name="date"
              control={paymentControl}
              render={({ field }) => (
                <NepaliAwareDatePicker
                  label="Payment date"
                  value={field.value}
                  onChange={field.onChange}
                  size="small"
                  fullWidth
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              name="paymentMethod"
              control={paymentControl}
              render={({ field }) => (
                <FormControl fullWidth required error={!!paymentErrors.paymentMethod}>
                  <InputLabel>Payment method</InputLabel>
                  <Select label="Payment method" {...field}>
                    {PAYMENT_METHODS.map((method) => (
                      <MenuItem key={method.value} value={method.value}>{method.label}</MenuItem>
                    ))}
                  </Select>
                  {paymentErrors.paymentMethod && (
                    <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                      {paymentErrors.paymentMethod.message}
                    </Typography>
                  )}
                </FormControl>
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Bill no."
              size="small"
              fullWidth
              placeholder="Optional vendor bill / invoice number"
              {...register('billNo')}
              error={!!paymentErrors.billNo}
              helperText={paymentErrors.billNo?.message}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Notes"
              size="small"
              fullWidth
              multiline
              minRows={2}
              {...register('notes')}
              error={!!paymentErrors.notes}
              helperText={paymentErrors.notes?.message}
            />
          </Grid>
        </Grid>
      </FormModal>
    </Box>
  );
}
