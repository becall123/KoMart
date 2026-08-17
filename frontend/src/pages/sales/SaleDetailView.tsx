import { useState } from 'react';
import {
  Box,
  Chip,
  Divider,
  Grid,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useNavigate } from 'react-router-dom';
import { formatAmount, formatCurrency, formatDateTime } from '@/utils';
import { PAYMENT_METHODS } from '@/constants';
import { TransactionDiscountSummary } from '@/components/sales/TransactionDiscountSummary';
import { getTransactionDiscountBreakdown } from '@/utils/transactionDiscounts';
import { ProductQuickViewDialog } from '@/components/products/ProductQuickViewDialog';
import { useProduct } from '@/hooks/useProducts';
import type { Transaction } from '@/types';

interface SaleDetailViewProps {
  transaction: Transaction;
}

export function SaleDetailView({ transaction: txn }: SaleDetailViewProps) {
  const navigate = useNavigate();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const { data: selectedProduct } = useProduct(selectedProductId ?? '');
  const paymentLabel =
    PAYMENT_METHODS.find((m) => m.value === txn.paymentMethod)?.label
    ?? txn.paymentMethod.toUpperCase();
  const discountBreakdown = getTransactionDiscountBreakdown(txn);

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 4 }}>
        <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Sale Information
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <DetailRow label="Bill No." value={txn.transactionNumber} />
          <DetailRow label="Date" value={formatDateTime(txn.createdAt)} />
          <DetailRow label="Cashier" value={txn.createdBy} />
          <DetailRow label="Customer" value={txn.customerName ?? 'Walk-In Customer'} />
          <DetailRow label="Payment" value={paymentLabel} />
          {txn.notes?.trim() && (
            <DetailRow label="Remarks" value={txn.notes.trim()} />
          )}
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 8 }}>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2" color="text.secondary">
              Line Items
            </Typography>
          </Box>
          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
            <Table size="small" sx={{ borderCollapse: 'collapse' }}>
              <TableHead>
                <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                  <TableCell sx={{ border: '1px solid', borderColor: 'divider', fontWeight: 600, width: 40 }}>S.N</TableCell>
                  <TableCell sx={{ border: '1px solid', borderColor: 'divider', fontWeight: 600 }}>Product</TableCell>
                  <TableCell sx={{ border: '1px solid', borderColor: 'divider', fontWeight: 600 }}>SKU</TableCell>
                  <TableCell align="right" sx={{ border: '1px solid', borderColor: 'divider', fontWeight: 600 }}>Qty</TableCell>
                  <TableCell align="right" sx={{ border: '1px solid', borderColor: 'divider', fontWeight: 600 }}>Unit Price</TableCell>
                  <TableCell align="right" sx={{ border: '1px solid', borderColor: 'divider', fontWeight: 600 }}>Line Discount</TableCell>
                  <TableCell align="right" sx={{ border: '1px solid', borderColor: 'divider', fontWeight: 600 }}>Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {txn.items.map((item, index) => {
                  const lineDiscount = (item.discount ?? 0) * item.quantity;
                  const lineTotal = item.price * item.quantity - lineDiscount;
                  const isEvenRow = index % 2 === 0;
                  return (
                    <TableRow key={`${item.productId}-${item.sku}`} sx={{ backgroundColor: isEvenRow ? '#ffffff' : '#fafafa' }}>
                      <TableCell sx={{ border: '1px solid', borderColor: 'divider', fontWeight: 600, textAlign: 'center', width: 40 }}>{index + 1}</TableCell>
                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>{item.name}</Typography>
                          {item.productId && (
                            <IconButton
                              size="small"
                              aria-label="View product details"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (item.productId) {
                                  setSelectedProductId(item.productId);
                                }
                              }}
                              sx={{
                                width: 26,
                                height: 26,
                                color: 'primary.main',
                                border: '1px solid',
                                borderColor: 'divider',
                              }}
                            >
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.sku}</TableCell>
                      <TableCell align="right" sx={{ border: '1px solid', borderColor: 'divider' }}>{item.quantity}</TableCell>
                      <TableCell align="right" sx={{ border: '1px solid', borderColor: 'divider' }}>{formatAmount(item.price)}</TableCell>
                      <TableCell align="right" sx={{ color: lineDiscount > 0 ? 'success.main' : 'text.secondary', border: '1px solid', borderColor: 'divider' }}>
                        {lineDiscount > 0 ? `− ${formatAmount(lineDiscount)}` : '—'}
                      </TableCell>
                      <TableCell align="right" sx={{ border: '1px solid', borderColor: 'divider' }}>{formatAmount(lineTotal)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: discountBreakdown.hasDiscounts ? 6 : 12 }}>
        <Paper variant="outlined" sx={{ p: 2.5, maxWidth: discountBreakdown.hasDiscounts ? undefined : 360, ml: discountBreakdown.hasDiscounts ? 0 : 'auto' }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Bill Summary
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography color="text.secondary">Subtotal</Typography>
            <Typography>{formatCurrency(txn.subtotal)}</Typography>
          </Box>
          {txn.tax > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography color="text.secondary">Tax</Typography>
              <Typography>{formatCurrency(txn.tax)}</Typography>
            </Box>
          )}
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Total</Typography>
            <Chip label={formatCurrency(txn.total)} color="primary" sx={{ fontWeight: 700, fontSize: '1rem' }} />
          </Box>
        </Paper>
      </Grid>

      {discountBreakdown.hasDiscounts && (
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Discounts
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <TransactionDiscountSummary transaction={txn} />
          </Paper>
        </Grid>
      )}

      <ProductQuickViewDialog
        product={selectedProduct ?? null}
        open={!!selectedProductId && !!selectedProduct}
        onClose={() => setSelectedProductId(null)}
      />
    </Grid>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1.25 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 500, textAlign: 'right' }}>{value}</Typography>
    </Box>
  );
}

