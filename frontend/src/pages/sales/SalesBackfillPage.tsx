import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { formatCurrency } from '@/utils';
import { CURRENCY_SYMBOL } from '@/constants';
import { showApiError, showSuccess, showWarning } from '@/utils/toast';
import { useBackfillSales, usePostBackfillVariance, useValidateBackfillSales } from '@/hooks/useTransactions';
import { productService } from '@/services';
import type { BackfillSaleLinePayload, BackfillSalesResponse } from '@/types';
import {
  allocateGlobalDiscount,
  countBackfillErrors,
  downloadBackfillSalesSampleExcel,
  lineAmount,
  normalizePaymentMethod,
  parseBackfillSalesExcel,
  round2,
  validateBackfillRows,
  type BackfillFieldErrorKey,
  type BackfillPreviewRow,
  type BackfillRowErrors,
} from './backfillSalesExcel';

const errorCellSx = {
  border: '1px solid #d32f2f',
  backgroundColor: '#fff5f5',
  borderRadius: 1,
  px: 0.75,
  py: 0.25,
};

function groupSubtotals(rows: BackfillPreviewRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = r.transactionNo.trim();
    if (!key) continue;
    map.set(key, round2((map.get(key) ?? 0) + lineAmount(r)));
  }
  return map;
}

function perTxnDiscountMap(rows: BackfillPreviewRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = r.transactionNo.trim();
    if (!key || map.has(key)) continue;
    map.set(key, Math.max(0, r.discountAmount));
  }
  return map;
}

function ErrorCell({
  error,
  children,
  align = 'left',
}: {
  error?: string;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <TableCell align={align} title={error || undefined}>
      {error ? <Box sx={{ ...errorCellSx, textAlign: align }}>{children}</Box> : children}
    </TableCell>
  );
}

async function enrichPreviewRows(rows: BackfillPreviewRow[]): Promise<BackfillPreviewRow[]> {
  const codes = new Set<string>();
  for (const r of rows) {
    if (r.sku) codes.add(r.sku);
    if (r.barcode) codes.add(r.barcode);
  }

  type CatalogInfo = { name: string; sellingPrice: number };
  const infoByCode = new Map<string, CatalogInfo>();

  await Promise.all(
    [...codes].map(async (code) => {
      try {
        const res = await productService.getAll({
          exactCode: code,
          page: 1,
          pageSize: 5,
          lean: true,
        });
        const match = res.data.find(
          (p) =>
            p.sku?.toLowerCase() === code.toLowerCase()
            || p.barcode?.toLowerCase() === code.toLowerCase(),
        ) ?? res.data[0];
        if (match) {
          const info: CatalogInfo = {
            name: match.name,
            sellingPrice: Number(match.sellingPrice) || 0,
          };
          if (match.sku) infoByCode.set(match.sku.toLowerCase(), info);
          if (match.barcode) infoByCode.set(match.barcode.toLowerCase(), info);
          infoByCode.set(code.toLowerCase(), info);
        }
      } catch {
        // leave unresolved
      }
    }),
  );

  return rows.map((r) => {
    const fromSku = r.sku ? infoByCode.get(r.sku.toLowerCase()) : undefined;
    const fromBarcode = r.barcode ? infoByCode.get(r.barcode.toLowerCase()) : undefined;
    const info = fromSku || fromBarcode;
    const productName = info?.name || '';
    const hasCode = !!(r.sku || r.barcode);
    const productMissing = hasCode && !productName;
    const excelHadPrice = r.unitPrice != null;
    let unitPrice = r.unitPrice;
    let priceFromCatalog = false;
    if (!excelHadPrice && info && info.sellingPrice > 0) {
      unitPrice = info.sellingPrice;
      priceFromCatalog = true;
    }
    return {
      ...r,
      productName,
      productMissing,
      unitPrice,
      priceFromCatalog,
    };
  });
}

export function SalesBackfillPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backfillMutation = useBackfillSales();
  const validateMutation = useValidateBackfillSales();
  const varianceMutation = usePostBackfillVariance();

  const [rows, setRows] = useState<BackfillPreviewRow[]>([]);
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [actualTotal, setActualTotal] = useState<string>('');
  const [result, setResult] = useState<BackfillSalesResponse | null>(null);
  const [fieldErrors, setFieldErrors] = useState<BackfillRowErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [varianceConfirmOpen, setVarianceConfirmOpen] = useState(false);
  const [resolvingNames, setResolvingNames] = useState(false);
  const [validateOk, setValidateOk] = useState(false);
  const [variancePosted, setVariancePosted] = useState(false);
  const [serverErrorTxnNos, setServerErrorTxnNos] = useState<Set<string>>(new Set());

  const subtotals = useMemo(() => groupSubtotals(rows), [rows]);
  const perTxnDiscounts = useMemo(() => perTxnDiscountMap(rows), [rows]);

  const groupList = useMemo(
    () =>
      [...subtotals.entries()].map(([transactionNo, subtotal]) => ({
        transactionNo,
        subtotal,
      })),
    [subtotals],
  );

  const groupTone = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const g of groupList) {
      map.set(g.transactionNo, i % 2);
      i += 1;
    }
    return map;
  }, [groupList]);

  const tableSubtotal = useMemo(
    () => round2(groupList.reduce((s, g) => s + g.subtotal, 0)),
    [groupList],
  );

  const sumPerTxnDiscount = useMemo(
    () => round2([...perTxnDiscounts.values()].reduce((s, v) => s + v, 0)),
    [perTxnDiscounts],
  );

  const expectedTotal = useMemo(() => {
    const raw = tableSubtotal - sumPerTxnDiscount - Math.max(0, globalDiscount);
    return round2(Math.max(0, raw));
  }, [tableSubtotal, sumPerTxnDiscount, globalDiscount]);

  const actualNumber = actualTotal.trim() === '' ? null : Number(actualTotal);
  const actualValid = actualNumber != null && Number.isFinite(actualNumber) && actualNumber >= 0;
  const difference = actualValid ? round2(expectedTotal - (actualNumber as number)) : null;

  const catalogPriceCount = useMemo(
    () => rows.filter((r) => r.priceFromCatalog).length,
    [rows],
  );

  const unresolvedPriceCount = useMemo(
    () => rows.filter((r) => r.unitPrice == null && !r.productMissing).length,
    [rows],
  );

  const errorCount = useMemo(() => countBackfillErrors(fieldErrors), [fieldErrors]);

  const setGroupDiscount = (transactionNo: string, value: number) => {
    const next = Math.max(0, round2(value));
    setValidateOk(false);
    setRows((prev) =>
      prev.map((r) =>
        r.transactionNo.trim() === transactionNo ? { ...r, discountAmount: next } : r,
      ),
    );
  };

  const onExcelSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseBackfillSalesExcel(buf);
      if (!parsed.length) {
        showWarning('No data rows found in the Excel file.');
        return;
      }
      setResolvingNames(true);
      const withNames = await enrichPreviewRows(parsed);
      setResolvingNames(false);
      setRows(withNames);
      setGlobalDiscount(0);
      setActualTotal('');
      setResult(null);
      setValidateOk(false);
      setVariancePosted(false);
      setServerErrorTxnNos(new Set());
      const errs = validateBackfillRows(withNames);
      setFieldErrors(errs);
      showSuccess(`Loaded ${withNames.length} line(s) from Excel.`);
    } catch (err) {
      setResolvingNames(false);
      showApiError(err, 'Could not parse Excel file.');
    }
  };

  const buildPayloadLines = (): BackfillSaleLinePayload[] => {
    const shares = allocateGlobalDiscount(groupList, globalDiscount);
    let clamped = false;
    const payload = rows.map((r) => {
      const key = r.transactionNo.trim();
      const sub = subtotals.get(key) ?? 0;
      const perTxn = perTxnDiscounts.get(key) ?? 0;
      const share = shares[key] ?? 0;
      let discount = round2(perTxn + share);
      if (discount > sub && sub > 0) {
        discount = sub;
        clamped = true;
      }
      const payment = normalizePaymentMethod(r.paymentMethod) || r.paymentMethod.trim().toLowerCase();
      return {
        row: r.row,
        transactionNo: key,
        saleDate: r.saleDate,
        sku: r.sku || undefined,
        barcode: r.barcode || undefined,
        quantity: r.quantity,
        unitPrice: r.unitPrice ?? undefined,
        discountAmount: discount,
        paymentMethod: payment,
        customerPhone: r.customerPhone || undefined,
        customerName: r.customerName || undefined,
        notes: r.notes || undefined,
      };
    });
    if (clamped) {
      showWarning('Some discounts were capped at the sale subtotal.');
    }
    return payload;
  };

  const mapServerErrorsToCells = (
    base: BackfillRowErrors,
    serverErrors: { transactionNo: string; rows: number[]; detail: string }[],
  ): BackfillRowErrors => {
    const next: BackfillRowErrors = { ...base };
    const failed = new Set<string>();
    for (const se of serverErrors) {
      failed.add(se.transactionNo);
      for (const r of rows) {
        if (r.transactionNo.trim() !== se.transactionNo) continue;
        next[r.key] = {
          ...(next[r.key] || {}),
          transactionNo: se.detail,
        };
      }
    }
    setServerErrorTxnNos(failed);
    return next;
  };

  const runValidate = () => {
    if (!rows.length) {
      showWarning('Import an Excel file first.');
      return;
    }
    const errs = validateBackfillRows(rows);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setValidateOk(false);
      showWarning(`${countBackfillErrors(errs)} cell(s) need attention — highlighted in red.`);
      return;
    }
    const lines = buildPayloadLines();
    validateMutation.mutate(lines, {
      onSuccess: (res) => {
        if (res.ok) {
          setFieldErrors({});
          setServerErrorTxnNos(new Set());
          setValidateOk(true);
          showSuccess('Validation passed — stock and products look good.');
          return;
        }
        setValidateOk(false);
        setFieldErrors(mapServerErrorsToCells({}, res.errors));
        showWarning(`${res.errorCount} transaction group(s) failed validation.`);
      },
      onError: (err) => {
        setValidateOk(false);
        showApiError(err, 'Validation failed.');
      },
    });
  };

  const tryOpenConfirm = () => {
    if (!rows.length) {
      showWarning('Import an Excel file first.');
      return;
    }
    const errs = validateBackfillRows(rows);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setValidateOk(false);
      showWarning(`${countBackfillErrors(errs)} cell(s) need attention — highlighted in red.`);
      return;
    }
    if (!actualValid) {
      showWarning('Enter Actual Total before importing.');
      return;
    }
    setConfirmOpen(true);
  };

  const onConfirmImport = () => {
    if (!actualValid) return;
    const lines = buildPayloadLines();
    backfillMutation.mutate(
      {
        lines,
        expectedTotal,
        actualTotal: actualNumber as number,
      },
      {
        onSuccess: (res) => {
          setResult(res);
          setConfirmOpen(false);
          setValidateOk(false);
          setVariancePosted(false);
          if (res.createdCount > 0) {
            showSuccess(`Created ${res.createdCount} sale(s).`);
          }
          if (res.errorCount > 0) {
            showWarning(`${res.errorCount} transaction group(s) failed.`);
            const failed = new Set(res.errors.map((e) => e.transactionNo));
            setRows((prev) => prev.filter((r) => failed.has(r.transactionNo.trim())));
            setFieldErrors(mapServerErrorsToCells({}, res.errors));
            setServerErrorTxnNos(failed);
          } else {
            setRows([]);
            setGlobalDiscount(0);
            setFieldErrors({});
            setServerErrorTxnNos(new Set());
          }
        },
        onError: (err) => {
          setConfirmOpen(false);
          showApiError(err, 'Backfill import failed.');
        },
      },
    );
  };

  const latestSaleDateForVariance = useMemo(() => {
    if (!result?.created?.length) return undefined;
    const dates = result.created
      .map((t) => (t.saleDate || t.createdAt || '').slice(0, 10))
      .filter(Boolean)
      .sort();
    return dates[dates.length - 1];
  }, [result]);

  const onConfirmVariance = () => {
    if (!result || result.difference == null) return;
    varianceMutation.mutate(
      {
        expectedTotal: result.expectedTotal ?? expectedTotal,
        actualTotal: result.actualTotal ?? 0,
        difference: result.difference,
        date: latestSaleDateForVariance,
        wallet: 'cash',
      },
      {
        onSuccess: () => {
          setVariancePosted(true);
          setVarianceConfirmOpen(false);
          showSuccess('Variance posted to cash wallet in Accounts.');
        },
        onError: (err) => {
          setVarianceConfirmOpen(false);
          showApiError(err, 'Could not post variance.');
        },
      },
    );
  };

  const err = (rowKey: string, field: BackfillFieldErrorKey) => fieldErrors[rowKey]?.[field];

  const discountInputStyle = (hasError: boolean): CSSProperties => ({
    width: '100%',
    border: hasError ? '1px solid #d32f2f' : '1px solid #cfcfcf',
    background: hasError ? '#fff5f5' : '#fff',
    borderRadius: 4,
    padding: '4px 6px',
  });

  const showVarianceButton =
    !!result
    && (result.createdCount ?? 0) > 0
    && Math.abs(result.difference ?? 0) > 0.01
    && !variancePosted;

  return (
    <Box>
      <PageHeader
        title="Backfill Sales"
        subtitle="Admin-only Excel import of historical sales (stock, wallets, reports)"
        action={
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/sales')}>
            Back to Sales
          </Button>
        }
      />

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link
            component="button"
            type="button"
            variant="body2"
            onClick={() => downloadBackfillSalesSampleExcel()}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <DownloadIcon fontSize="inherit" />
            Download sample
          </Link>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={(e) => void onExcelSelected(e)}
          />
          <Button
            size="small"
            variant="outlined"
            startIcon={<UploadFileIcon />}
            loading={resolvingNames}
            onClick={() => fileInputRef.current?.click()}
          >
            Import Excel
          </Button>
          {rows.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              {rows.length} line(s) · {groupList.length} transaction(s)
            </Typography>
          )}
        </Box>
      </Paper>

      {rows.length === 0 && !result && (
        <Paper sx={{ p: 4, textAlign: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Import historical sales
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 480, mx: 'auto' }}>
            Download the sample Excel, fill Sale Date, Transaction No, SKU or Barcode, Quantity,
            and Payment Method. Rows with the same Transaction No become one sale. Bill numbers
            are assigned automatically.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              startIcon={<DownloadIcon />}
              onClick={() => downloadBackfillSalesSampleExcel()}
            >
              Download sample
            </Button>
            <Button
              variant="contained"
              startIcon={<UploadFileIcon />}
              onClick={() => fileInputRef.current?.click()}
            >
              Import Excel
            </Button>
          </Box>
        </Paper>
      )}

      {errorCount > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorCount} cell{errorCount !== 1 ? 's' : ''} need attention — highlighted in red.
        </Alert>
      )}

      {catalogPriceCount > 0 && rows.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {catalogPriceCount} line(s) use catalog selling price (Unit Price was blank in Excel).
          Expected Total includes those prices.
        </Alert>
      )}
      {unresolvedPriceCount > 0 && rows.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {unresolvedPriceCount} line(s) still have no unit price — Expected Total may be incomplete.
        </Alert>
      )}

      {rows.length > 0 && (
        <>
          <TableContainer component={Paper} sx={{ mb: 2, maxHeight: 480 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Row</TableCell>
                  <TableCell>Sale Date</TableCell>
                  <TableCell>Transaction No</TableCell>
                  <TableCell>SKU</TableCell>
                  <TableCell>Product Name</TableCell>
                  <TableCell>Barcode</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">Unit Price</TableCell>
                  <TableCell align="right">Line</TableCell>
                  <TableCell align="right">Discount</TableCell>
                  <TableCell>Payment</TableCell>
                  <TableCell>Customer</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const key = r.transactionNo.trim();
                  const isFirst =
                    rows.find((x) => x.transactionNo.trim() === key)?.key === r.key;
                  const tone = groupTone.get(key) ?? 0;
                  const groupFailed = serverErrorTxnNos.has(key);
                  return (
                    <TableRow
                      key={r.key}
                      hover
                      sx={{
                        bgcolor: groupFailed
                          ? '#fff5f5'
                          : tone === 1
                            ? 'action.hover'
                            : undefined,
                      }}
                    >
                      <TableCell>{r.row}</TableCell>
                      <ErrorCell error={err(r.key, 'saleDate')}>{r.saleDate || '—'}</ErrorCell>
                      <ErrorCell error={err(r.key, 'transactionNo')}>
                        {r.transactionNo || '—'}
                      </ErrorCell>
                      <ErrorCell error={err(r.key, 'sku')}>{r.sku || '—'}</ErrorCell>
                      <ErrorCell error={err(r.key, 'productName')}>
                        {r.productName || '—'}
                      </ErrorCell>
                      <ErrorCell error={err(r.key, 'barcode')}>{r.barcode || '—'}</ErrorCell>
                      <ErrorCell error={err(r.key, 'quantity')} align="right">
                        {r.quantity || '—'}
                      </ErrorCell>
                      <TableCell align="right">
                        {r.unitPrice != null
                          ? (
                              <>
                                {formatCurrency(r.unitPrice)}
                                {r.priceFromCatalog ? (
                                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                    (catalog)
                                  </Typography>
                                ) : null}
                              </>
                            )
                          : '—'}
                      </TableCell>
                      <TableCell align="right">{formatCurrency(lineAmount(r))}</TableCell>
                      <TableCell align="right" sx={{ minWidth: 110 }}>
                        {isFirst ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={r.discountAmount}
                            onChange={(e) =>
                              setGroupDiscount(key, Number(e.target.value) || 0)
                            }
                            style={discountInputStyle(false)}
                          />
                        ) : (
                          formatCurrency(r.discountAmount)
                        )}
                      </TableCell>
                      <ErrorCell error={err(r.key, 'paymentMethod')}>
                        {r.paymentMethod || '—'}
                      </ErrorCell>
                      <TableCell>{r.customerName || r.customerPhone || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <Paper
            sx={{
              p: 2,
              mb: 2,
              display: 'flex',
              gap: 2,
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              position: 'sticky',
              bottom: 8,
              zIndex: 1,
            }}
          >
            <Box>
              <Typography variant="caption" color="text.secondary">
                Subtotal
              </Typography>
              <Typography variant="h6">{formatCurrency(tableSubtotal)}</Typography>
            </Box>
            <TextField
              label="Global discount"
              size="small"
              type="number"
              value={globalDiscount}
              onChange={(e) => {
                setValidateOk(false);
                setGlobalDiscount(Math.max(0, Number(e.target.value) || 0));
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <Typography variant="caption" sx={{ mr: 0.5 }}>
                      {CURRENCY_SYMBOL}
                    </Typography>
                  ),
                },
                htmlInput: { min: 0, step: 0.01 },
              }}
              sx={{ width: 150 }}
            />
            <Box>
              <Typography variant="caption" color="text.secondary">
                Expected Total
              </Typography>
              <Typography variant="h6">{formatCurrency(expectedTotal)}</Typography>
            </Box>
            <TextField
              label="Actual Total"
              size="small"
              type="number"
              required
              value={actualTotal}
              onChange={(e) => setActualTotal(e.target.value)}
              error={actualTotal !== '' && !actualValid}
              helperText={actualTotal !== '' && !actualValid ? 'Enter a valid amount ≥ 0' : ' '}
              slotProps={{
                input: {
                  startAdornment: (
                    <Typography variant="caption" sx={{ mr: 0.5 }}>
                      {CURRENCY_SYMBOL}
                    </Typography>
                  ),
                },
                htmlInput: { min: 0, step: 0.01 },
              }}
              sx={{ width: 160 }}
            />
            <Box>
              <Typography variant="caption" color="text.secondary">
                Difference
              </Typography>
              <Typography
                variant="h6"
                color={difference != null && Math.abs(difference) > 0.001 ? 'warning.main' : 'text.primary'}
              >
                {difference == null ? '—' : formatCurrency(difference)}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              disabled={!rows.length || validateMutation.isPending}
              loading={validateMutation.isPending}
              onClick={runValidate}
            >
              Validate
            </Button>
            <Button
              variant="contained"
              disabled={!rows.length || backfillMutation.isPending}
              onClick={tryOpenConfirm}
            >
              Import sales
            </Button>
            {validateOk && (
              <Typography variant="caption" color="success.main">
                Validated
              </Typography>
            )}
          </Paper>
        </>
      )}

      {result && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
          <Alert severity="info">
            Expected {formatCurrency(result.expectedTotal ?? expectedTotal)}
            {' · '}
            Actual {formatCurrency(result.actualTotal ?? 0)}
            {' · '}
            Difference{' '}
            <strong>{formatCurrency(result.difference ?? 0)}</strong>
            {' '}(logged in audit)
          </Alert>
          {result.createdCount > 0 && (
            <Alert severity="success">
              Created {result.createdCount} sale(s):{' '}
              {result.created.map((t, i) => (
                <span key={t.id}>
                  {i > 0 ? ', ' : ''}
                  <Link component={RouterLink} to={`/sales/${t.id}`}>
                    {t.transactionNumber}
                  </Link>
                </span>
              ))}
            </Alert>
          )}
          {showVarianceButton && (
            <Box>
              <Button
                variant="outlined"
                color="warning"
                loading={varianceMutation.isPending}
                onClick={() => setVarianceConfirmOpen(true)}
              >
                Post variance to Accounts
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Posts a cash wallet adjustment so Accounts can match Actual Total. Sales stay at Expected.
              </Typography>
            </Box>
          )}
          {variancePosted && (
            <Alert severity="success">
              Variance posted to cash wallet.
            </Alert>
          )}
          {result.errors.map((e) => (
            <Alert key={`${e.transactionNo}-${e.detail}`} severity="error">
              Transaction No {e.transactionNo}
              {e.rows.length ? ` (rows ${e.rows.join(', ')})` : ''}: {e.detail}
            </Alert>
          ))}
        </Box>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Import backfill sales?"
        message={
          `Create ${groupList.length} sale(s).\n`
          + `Expected Total: ${formatCurrency(expectedTotal)}\n`
          + `Actual Total: ${formatCurrency(actualNumber ?? 0)}\n`
          + `Difference: ${formatCurrency(difference ?? 0)}\n\n`
          + 'Stock and wallets will update. This cannot be undone from this screen.'
        }
        confirmLabel="Import"
        confirmColor="warning"
        loading={backfillMutation.isPending}
        onConfirm={onConfirmImport}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={varianceConfirmOpen}
        title="Post variance to Accounts?"
        message={
          `Post cash adjustment of ${formatCurrency(Math.abs(result?.difference ?? 0))} `
          + `(${(result?.difference ?? 0) > 0 ? 'outflow' : 'inflow'}) `
          + `for Expected ${formatCurrency(result?.expectedTotal ?? 0)} vs Actual ${formatCurrency(result?.actualTotal ?? 0)}.\n\n`
          + 'This does not change the imported sales — only the cash wallet balance.'
        }
        confirmLabel="Post variance"
        confirmColor="warning"
        loading={varianceMutation.isPending}
        onConfirm={onConfirmVariance}
        onCancel={() => setVarianceConfirmOpen(false)}
      />
    </Box>
  );
}
