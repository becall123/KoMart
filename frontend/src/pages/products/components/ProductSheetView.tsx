import { memo, useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '@/services/apiClient';
import type { ListQueryParams, Product, ProductBulkUpdateItem, ProductStatus, Supplier } from '@/types';
import { showSuccess, showWarning, showError, showInfo } from '@/utils/toast';
import { copyProductsToClipboard } from '@/pages/products/productPasteExport';
import {
  filterByStock,
  type StockFilter,
} from '@/pages/products/productStockFilter';
import {
  PRODUCT_SHEET_COLUMNS,
  SHEET_CHECKBOX_COL_WIDTH,
  SHEET_SN_COL_WIDTH,
  isPoPasteColumn,
  isSheetColumnRightAligned,
  productSheetColWidths,
  productSheetTableMinWidth,
  getSheetCellValue,
  applyDraftPricing,
  type ProductSheetColumnDef,
} from '@/pages/products/productSheetColumnDefs';
import { PO_PASTE_HINT } from '@/pages/purchase-orders/poTerminology';
import { useBulkUpdateProducts } from '@/hooks/useProducts';
import {
  COUNTRIES,
  DROPDOWN_PAGE_SIZE,
  PRODUCT_CATEGORIES,
  PRODUCT_STATUS_OPTIONS,
} from '@/constants';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useCategoryNames } from '@/hooks/useCategories';
import { useUomOptions } from '@/hooks/useUoms';
import {
  validateDrafts,
  validateProductRow,
  countValidationErrors,
  type ProductFieldErrors,
  type ProductValidationMap,
} from '@/pages/products/productSheetValidation';

export interface ProductSheetViewProps {
  products: Product[];
  loading: boolean;
  page: number;
  pageSize: number;
  total?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  filters: ListQueryParams;
  stockFilter?: StockFilter;
  canCreatePo?: boolean;
  canBulkEdit?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: 'name' | 'sku') => void;
}

const headerSx = {
  fontWeight: 700,
  fontSize: '0.75rem',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  py: 0.75,
  px: 1,
  bgcolor: 'background.paper',
  backgroundImage: 'none',
  borderBottom: '1px solid',
  borderColor: 'divider',
  position: 'sticky',
  top: 0,
  zIndex: 2,
};

const poHeaderSx = {
  ...headerSx,
  bgcolor: (t: Theme) =>
    (t.palette.mode === 'dark' ? t.palette.grey[800] : t.palette.grey[100]),
};

const cellSx = {
  py: 0.5,
  px: 0.5,
  fontSize: '0.8125rem',
  borderBottom: '1px solid',
  borderColor: 'divider',
  overflow: 'hidden',
};

/** Sticky left: checkbox | # | Name */
const STICKY_CHECKBOX_LEFT = 0;
const STICKY_SN_LEFT = SHEET_CHECKBOX_COL_WIDTH;
const STICKY_NAME_LEFT = SHEET_CHECKBOX_COL_WIDTH + SHEET_SN_COL_WIDTH;

/** Opaque fills only — alpha tokens (action.hover) make sticky cells unreadable. */
function stickyRowBg(rowDirty: boolean, rowIndex: number, selected: boolean) {
  return (t: Theme) => {
    if (selected) {
      return t.palette.mode === 'dark' ? t.palette.grey[800] : t.palette.grey[200];
    }
    if (rowDirty) {
      return t.palette.mode === 'dark' ? t.palette.grey[800] : '#fff3e0';
    }
    if (rowIndex % 2 === 1) {
      return t.palette.mode === 'dark' ? t.palette.grey[900] : t.palette.grey[50];
    }
    return t.palette.background.paper;
  };
}

function stickyErrorBg(t: Theme) {
  return t.palette.mode === 'dark' ? t.palette.grey[800] : '#fdecea';
}

function showBulkEditTips() {
  showInfo(
    `Bulk Edit — catalog spreadsheet. `
    + `PO paste columns: ${PO_PASTE_HINT} — copy selected rows and paste into PO line grid with Ctrl+V.`,
    { duration: 12000 },
  );
}

const nativeInputSx = {
  width: '100%',
  font: 'inherit',
  fontSize: '0.8125rem',
  lineHeight: 1.4,
  py: 0.5,
  px: 0.75,
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 0.5,
  bgcolor: 'background.paper',
  boxSizing: 'border-box',
  '&:focus': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: 0,
  },
};

function copyToast(copied: number, skipped: number) {
  let msg = `Copied ${copied} row${copied !== 1 ? 's' : ''}`;
  if (skipped > 0) msg += ` (${skipped} skipped — no SKU)`;
  showSuccess(msg);
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergeProduct(product: Product, draft?: Partial<Product>): Product {
  if (!draft) return product;
  return { ...product, ...draft };
}

function buildBulkPayload(
  product: Product,
  draft: Partial<Product>,
): ProductBulkUpdateItem | null {
  const payload: ProductBulkUpdateItem = { id: product.id };
  let changed = false;

  const keys: (keyof Product)[] = [
    'name', 'brand', 'countryOfOrigin', 'category', 'barcode', 'supplierId',
    'buyUom', 'uom', 'unitsPerBuyUom', 'sellMode', 'costPrice', 'sellingPrice',
    'packSellingPrice', 'discountPercent', 'offeredPrice', 'packDiscountPercent',
    'packOfferedPrice', 'lowStockThreshold', 'status', 'tags', 'nutritionInfo',
    'allergenInfo', 'images', 'description',
  ];

  for (const key of keys) {
    const next = draft[key];
    if (next === undefined) continue;
    const prev = product[key];
    const same = Array.isArray(next) && Array.isArray(prev)
      ? JSON.stringify(next) === JSON.stringify(prev)
      : next === prev;
    if (!same) {
      (payload as Record<string, unknown>)[key] = next;
      changed = true;
    }
  }

  return changed ? payload : null;
}

interface SelectOptions {
  suppliers: Supplier[];
  categories: string[];
  countries: readonly string[];
  uoms: { value: string; label: string }[];
  sellModes: { value: string; label: string }[];
  statuses: typeof PRODUCT_STATUS_OPTIONS;
}

interface SheetCellProps {
  product: Product;
  col: ProductSheetColumnDef;
  bulkEditMode: boolean;
  draft?: Partial<Product>;
  options: SelectOptions;
  fieldError?: string;
  onCellChange: (productId: string, field: keyof Product, value: unknown) => void;
}

const SheetCell = memo(function SheetCell({
  product,
  col,
  bulkEditMode,
  draft,
  options,
  fieldError,
  onCellChange,
}: SheetCellProps) {
  const merged = useMemo(() => mergeProduct(product, draft), [product, draft]);
  const display = useMemo(() => getSheetCellValue(merged, col), [merged, col]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const inputSx = fieldError
    ? { ...nativeInputSx, borderColor: 'error.main', bgcolor: 'error.50' }
    : nativeInputSx;

  if (!bulkEditMode || !col.editable || !col.field) {
    return (
      <Typography
        variant="body2"
        sx={{
          fontSize: 'inherit',
          fontWeight: col.key === 'sku' ? 600 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={fieldError ?? display}
      >
        {display || '—'}
      </Typography>
    );
  }

  const field = col.field;
  if (field === 'packQty' || field === 'poUnitCost' || field === 'packCost') {
    return <Typography variant="body2" sx={{ fontSize: 'inherit' }}>{display}</Typography>;
  }

  const pid = product.id;
  const inputProps = { onClick: stop, onFocus: stop };

  if (col.type === 'number') {
    const numField = field as keyof Product;
    const raw = merged[numField];
    const numValue = typeof raw === 'number' ? raw : typeof raw === 'string' ? raw : '';
    return (
      <Box
        component="input"
        type="number"
        value={numValue}
        step={col.key.includes('discount') ? 0.1 : 0.01}
        sx={inputSx}
        {...inputProps}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const v = e.target.value;
          onCellChange(pid, numField, v === '' ? 0 : Number(v));
        }}
      />
    );
  }

  if (col.type === 'select') {
    if (field === 'supplierId') {
      return (
        <Box
          component="select"
          value={merged.supplierId ?? ''}
          sx={inputSx}
          title={fieldError}
          {...inputProps}
          onChange={(e) => onCellChange(pid, 'supplierId', e.target.value)}
        >
          <option value="">None</option>
          {options.suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Box>
      );
    }
    if (field === 'category') {
      return (
        <Box
          component="select"
          value={merged.category ?? ''}
          sx={inputSx}
          title={fieldError}
          {...inputProps}
          onChange={(e) => onCellChange(pid, 'category', e.target.value)}
        >
          <option value="">None</option>
          {options.categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Box>
      );
    }
    if (field === 'countryOfOrigin') {
      return (
        <Box
          component="select"
          value={merged.countryOfOrigin ?? ''}
          sx={inputSx}
          title={fieldError}
          {...inputProps}
          onChange={(e) => onCellChange(pid, 'countryOfOrigin', e.target.value)}
        >
          <option value="">None</option>
          {options.countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Box>
      );
    }
    if (field === 'buyUom' || field === 'uom') {
      return (
        <Box
          component="select"
          value={(merged[field] as string) ?? ''}
          sx={inputSx}
          title={fieldError}
          {...inputProps}
          onChange={(e) => onCellChange(pid, field, e.target.value)}
        >
          <option value="">Select…</option>
          {options.uoms.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </Box>
      );
    }
    if (field === 'sellMode') {
      return (
        <Box
          component="select"
          value={merged.sellMode ?? 'unit'}
          sx={inputSx}
          title={fieldError}
          {...inputProps}
          onChange={(e) => onCellChange(pid, 'sellMode', e.target.value)}
        >
          {options.sellModes.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Box>
      );
    }
    if (field === 'status') {
      return (
        <Box
          component="select"
          value={merged.status ?? 'active'}
          sx={inputSx}
          title={fieldError}
          {...inputProps}
          onChange={(e) => onCellChange(pid, 'status', e.target.value as ProductStatus)}
        >
          {options.statuses.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Box>
      );
    }
  }

  if (field === 'tags' || field === 'images') {
    const list = (merged[field] as string[] | undefined) ?? [];
    return (
      <Box
        component="input"
        value={list.join(', ')}
        placeholder="Comma-separated"
        sx={inputSx}
        title={fieldError}
        {...inputProps}
        onChange={(e) => onCellChange(pid, field, parseList(e.target.value))}
      />
    );
  }

  const textField = field as keyof Product;
  if (col.type === 'multiline') {
    return (
      <Box
        component="textarea"
        value={(merged[textField] as string) ?? ''}
        rows={2}
        sx={{ ...inputSx, resize: 'vertical', minHeight: 40 }}
        title={fieldError}
        {...inputProps}
        onChange={(e) => onCellChange(pid, textField, e.target.value)}
      />
    );
  }

  return (
    <Box
      component="input"
      type="text"
      value={(merged[textField] as string) ?? ''}
      sx={inputSx}
      title={fieldError}
      {...inputProps}
      onChange={(e) => onCellChange(pid, textField, e.target.value)}
    />
  );
});

interface SheetRowProps {
  product: Product;
  draft?: Partial<Product>;
  bulkEditMode: boolean;
  selected: boolean;
  rowIndex: number;
  serialNumber: number;
  options: SelectOptions;
  fieldErrors?: ProductFieldErrors;
  serverError?: string;
  onToggle: (id: string) => void;
  onCellChange: (productId: string, field: keyof Product, value: unknown) => void;
}

const SheetRow = memo(function SheetRow({
  product,
  draft,
  bulkEditMode,
  selected,
  rowIndex,
  serialNumber,
  options,
  fieldErrors,
  serverError,
  onToggle,
  onCellChange,
}: SheetRowProps) {
  const hasSku = (product.sku ?? '').trim().length > 0;
  const rowDirty = !!draft;
  const fill = stickyRowBg(rowDirty, rowIndex, selected);

  return (
    <TableRow
      hover
      selected={selected}
      onClick={() => onToggle(product.id)}
      sx={{
        cursor: bulkEditMode ? 'default' : 'pointer',
        bgcolor: fill,
      }}
    >
      <TableCell
        padding="checkbox"
        onClick={(e) => e.stopPropagation()}
        sx={{
          ...cellSx,
          position: 'sticky',
          left: STICKY_CHECKBOX_LEFT,
          zIndex: 2,
          bgcolor: fill,
          backgroundImage: 'none',
          width: SHEET_CHECKBOX_COL_WIDTH,
          minWidth: SHEET_CHECKBOX_COL_WIDTH,
          maxWidth: SHEET_CHECKBOX_COL_WIDTH,
        }}
      >
        <Checkbox
          size="small"
          checked={selected}
          disabled={bulkEditMode}
          onChange={() => onToggle(product.id)}
        />
      </TableCell>
      <TableCell
        align="center"
        sx={{
          ...cellSx,
          position: 'sticky',
          left: STICKY_SN_LEFT,
          zIndex: 2,
          bgcolor: fill,
          backgroundImage: 'none',
          width: SHEET_SN_COL_WIDTH,
          minWidth: SHEET_SN_COL_WIDTH,
          maxWidth: SHEET_SN_COL_WIDTH,
          color: 'text.secondary',
          boxShadow: (t) => `2px 0 0 ${t.palette.divider}`,
        }}
      >
        {serialNumber}
      </TableCell>
      {PRODUCT_SHEET_COLUMNS.map((col, index) => {
        const fieldKey = col.field && col.field !== 'packQty' && col.field !== 'poUnitCost' && col.field !== 'packCost'
          ? col.field as keyof Product
          : undefined;
        const fieldError = fieldKey ? fieldErrors?.[fieldKey] : undefined;
        const showServerError = col.key === 'sku' && serverError;
        const isName = col.key === 'name';
        const colWidth = PRODUCT_SHEET_COLUMNS[index].width;
        const cellFill = fieldError || showServerError ? stickyErrorBg : fill;

        return (
          <TableCell
            key={col.key}
            align={isSheetColumnRightAligned(index) ? 'right' : 'left'}
            sx={{
              ...cellSx,
              width: colWidth,
              minWidth: colWidth,
              maxWidth: colWidth,
              ...(isName
                ? {
                    position: 'sticky',
                    left: STICKY_NAME_LEFT,
                    zIndex: 2,
                    bgcolor: cellFill,
                    backgroundImage: 'none',
                    boxShadow: (t) => `2px 0 0 ${t.palette.divider}`,
                  }
                : {
                    ...(fieldError || showServerError ? { bgcolor: cellFill } : {}),
                  }),
              color: !hasSku && col.key === 'sku' ? 'error.main' : 'inherit',
            }}
            title={fieldError ?? (showServerError || undefined)}
          >
            <SheetCell
              product={product}
              col={col}
              bulkEditMode={bulkEditMode}
              draft={draft}
              options={options}
              fieldError={fieldError}
              onCellChange={onCellChange}
            />
          </TableCell>
        );
      })}
    </TableRow>
  );
});

export function ProductSheetView({
  products,
  loading,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  stockFilter,
  canCreatePo = false,
  canBulkEdit = false,
  sortBy,
  sortOrder = 'asc',
  onSort,
}: ProductSheetViewProps) {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [bulkEditActivating, setBulkEditActivating] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<Product>>>({});
  const [validationErrors, setValidationErrors] = useState<ProductValidationMap>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const bulkMutation = useBulkUpdateProducts();
  const { data: suppliersData } = useSuppliers({ pageSize: DROPDOWN_PAGE_SIZE });
  const dbCategories = useCategoryNames();
  const categoryOptions = useMemo(
    () => (dbCategories.length > 0 ? dbCategories : [...PRODUCT_CATEGORIES]),
    [dbCategories],
  );
  const uomOptions = useUomOptions();
  const suppliers = suppliersData?.data ?? [];

  const selectOptions = useMemo<SelectOptions>(() => ({
    suppliers,
    categories: categoryOptions,
    countries: COUNTRIES,
    uoms: uomOptions,
    sellModes: [
      { value: 'unit', label: 'Pack' },
      { value: 'piece', label: 'Piece' },
      { value: 'both', label: 'Both' },
    ],
    statuses: PRODUCT_STATUS_OPTIONS,
  }), [suppliers, categoryOptions, uomOptions]);

  const productsRef = useRef(products);
  productsRef.current = products;

  const displayProducts = useMemo(
    () => filterByStock(products, stockFilter ?? ''),
    [products, stockFilter],
  );

  const isDirty = Object.keys(drafts).length > 0;

  const pageFilteredEmpty =
    !loading && products.length > 0 && displayProducts.length === 0 && !!stockFilter;

  useEffect(() => {
    if (!bulkEditMode) {
      setDrafts({});
      setValidationErrors({});
      setServerErrors({});
    }
    setSelectedIds(new Set());
  }, [page, pageSize, products, stockFilter, bulkEditMode]);

  const allPageSelected =
    displayProducts.length > 0 && displayProducts.every((p) => selectedIds.has(p.id));
  const somePageSelected =
    displayProducts.some((p) => selectedIds.has(p.id)) && !allPageSelected;

  const selectedWithSku = useMemo(
    () => displayProducts.filter(
      (p) => selectedIds.has(p.id) && (p.sku ?? '').trim().length > 0,
    ),
    [displayProducts, selectedIds],
  );

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(displayProducts.map((p) => p.id)));
  };

  const toggleRow = useCallback((id: string) => {
    if (bulkEditMode) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [bulkEditMode]);

  const handleCopySelected = async () => {
    const selected = displayProducts.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) {
      showWarning('Select at least one row to copy');
      return;
    }
    setCopying(true);
    try {
      const { copied, skipped } = await copyProductsToClipboard(selected);
      copyToast(copied, skipped);
    } catch (err) {
      showError(getErrorMessage(err));
    } finally {
      setCopying(false);
    }
  };

  const handleCreatePurchaseOrder = () => {
    if (selectedWithSku.length === 0) {
      showWarning('Select at least one product with a SKU');
      return;
    }
    navigate('/purchase-orders/new', { state: { prefillProducts: selectedWithSku } });
  };

  const handleCellChange = useCallback((productId: string, field: keyof Product, value: unknown) => {
    const product = productsRef.current.find((p) => p.id === productId);
    if (!product) return;
    setServerErrors((prev) => {
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setDrafts((prev) => {
      const current = { ...prev[productId], [field]: value } as Partial<Product>;
      const pricingFields: (keyof Product)[] = [
        'costPrice', 'sellingPrice', 'packSellingPrice', 'unitsPerBuyUom',
        'discountPercent', 'offeredPrice', 'packDiscountPercent', 'packOfferedPrice', 'sellMode',
      ];
      const withPricing = pricingFields.includes(field)
        ? applyDraftPricing(product, current, field)
        : current;
      const nextDrafts = { ...prev, [productId]: withPricing };
      const rowErrors = validateProductRow(product, withPricing);
      setValidationErrors((ve) => {
        const next = { ...ve };
        if (Object.keys(rowErrors).length > 0) {
          next[productId] = rowErrors;
        } else {
          delete next[productId];
        }
        return next;
      });
      return nextDrafts;
    });
  }, []);

  const handleEnableBulkEdit = () => {
    setBulkEditActivating(true);
    requestAnimationFrame(() => {
      startTransition(() => {
        setBulkEditMode(true);
        setBulkEditActivating(false);
      });
    });
  };

  const handleCancelEdit = () => {
    setDrafts({});
    setValidationErrors({});
    setServerErrors({});
    setBulkEditMode(false);
  };

  const handleSave = async () => {
    const clientErrors = validateDrafts(displayProducts, drafts);
    const errorCount = countValidationErrors(clientErrors);
    if (errorCount > 0) {
      setValidationErrors(clientErrors);
      showWarning(`${errorCount} cell${errorCount !== 1 ? 's' : ''} failed validation — fix highlighted fields before saving`);
      return;
    }

    const updates: ProductBulkUpdateItem[] = [];
    for (const product of displayProducts) {
      const draft = drafts[product.id];
      if (!draft) continue;
      const item = buildBulkPayload(product, draft);
      if (item) updates.push(item);
    }
    if (updates.length === 0) {
      showWarning('No changes to save');
      return;
    }
    try {
      const result = await bulkMutation.mutateAsync(updates);
      if (result.errors.length > 0) {
        const failedIds = new Set(result.errors.map((e) => e.id));
        const nextServerErrors: Record<string, string> = {};
        for (const err of result.errors) {
          nextServerErrors[err.id] = err.detail;
        }
        setServerErrors(nextServerErrors);
        setDrafts((prev) => {
          const next: Record<string, Partial<Product>> = {};
          for (const [id, draft] of Object.entries(prev)) {
            if (failedIds.has(id)) next[id] = draft;
          }
          return next;
        });
        setValidationErrors((prev) => {
          const next: ProductValidationMap = {};
          for (const [id, errs] of Object.entries(prev)) {
            if (failedIds.has(id)) next[id] = errs;
          }
          return next;
        });
        showWarning(`Saved ${result.updated} row(s); ${result.errors.length} failed`);
      } else {
        showSuccess(`Saved ${result.updated} product${result.updated !== 1 ? 's' : ''}`);
        setDrafts({});
        setValidationErrors({});
        setServerErrors({});
        setBulkEditMode(false);
      }
    } catch (err) {
      showError(getErrorMessage(err));
    }
  };

  const colAlign = (index: number): 'left' | 'right' =>
    isSheetColumnRightAligned(index) ? 'right' : 'left';

  const colWidths = useMemo(() => productSheetColWidths(), []);
  const tableMinWidth = useMemo(() => productSheetTableMinWidth(), []);

  return (
    <Paper
      variant="outlined"
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        width: '100%',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'action.hover',
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Tooltip title="Show tips">
          <IconButton size="small" onClick={showBulkEditTips} aria-label="Show tips">
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {canBulkEdit && !bulkEditMode && (
          <Button
            size="small"
            variant="contained"
            startIcon={bulkEditActivating ? <CircularProgress size={14} color="inherit" /> : <EditIcon />}
            disabled={bulkEditActivating || loading}
            onClick={handleEnableBulkEdit}
          >
            Bulk edit
          </Button>
        )}
        {canBulkEdit && bulkEditMode && (
          <>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<SaveIcon />}
              disabled={!isDirty || bulkMutation.isPending}
              onClick={() => void handleSave()}
            >
              Save changes
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<CloseIcon />}
              disabled={bulkMutation.isPending}
              onClick={handleCancelEdit}
            >
              Cancel
            </Button>
          </>
        )}
        {!bulkEditMode && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            disabled={copying || selectedIds.size === 0}
            onClick={() => void handleCopySelected()}
          >
            Copy selected
          </Button>
        )}
        {canCreatePo && !bulkEditMode && (
          <Button
            size="small"
            variant="contained"
            color="secondary"
            startIcon={<ReceiptLongIcon />}
            disabled={selectedWithSku.length === 0}
            onClick={handleCreatePurchaseOrder}
          >
            Create Purchase Order
          </Button>
        )}
      </Box>

      {bulkEditMode && (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          Edit any cell below, then Save changes. SKU and Stock are read-only — adjust stock from Inventory.
          {displayProducts.length > 40 && (
            <> For smoother editing on large pages, use 25 rows per page.</>
          )}
        </Alert>
      )}

      {pageFilteredEmpty && (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          No products on this page match the stock filter.
        </Alert>
      )}

      <TableContainer
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          userSelect: bulkEditMode ? 'auto' : 'text',
        }}
      >
        <Table
          stickyHeader
          size="small"
          sx={{
            tableLayout: 'fixed',
            minWidth: tableMinWidth,
            borderCollapse: 'collapse',
          }}
        >
          <colgroup>
            {colWidths.map((w, i) => (
              <col key={i} style={{ width: w, minWidth: w }} />
            ))}
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell
                padding="checkbox"
                sx={{
                  ...headerSx,
                  left: STICKY_CHECKBOX_LEFT,
                  zIndex: 4,
                  width: SHEET_CHECKBOX_COL_WIDTH,
                  minWidth: SHEET_CHECKBOX_COL_WIDTH,
                  maxWidth: SHEET_CHECKBOX_COL_WIDTH,
                }}
              >
                <Checkbox
                  size="small"
                  checked={allPageSelected}
                  indeterminate={somePageSelected}
                  disabled={displayProducts.length === 0 || bulkEditMode}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </TableCell>
              <TableCell
                align="center"
                sx={{
                  ...headerSx,
                  left: STICKY_SN_LEFT,
                  zIndex: 4,
                  width: SHEET_SN_COL_WIDTH,
                  minWidth: SHEET_SN_COL_WIDTH,
                  maxWidth: SHEET_SN_COL_WIDTH,
                  boxShadow: (t) => `2px 0 0 ${t.palette.divider}`,
                }}
              >
                #
              </TableCell>
              {PRODUCT_SHEET_COLUMNS.map((col, index) => {
                const isName = col.key === 'name';
                const colWidth = col.width;
                const headerStyle = {
                  ...(isPoPasteColumn(index) ? poHeaderSx : headerSx),
                  width: colWidth,
                  minWidth: colWidth,
                  maxWidth: colWidth,
                  ...(isName
                    ? {
                        left: STICKY_NAME_LEFT,
                        zIndex: 4,
                        boxShadow: (t: Theme) =>
                          `2px 0 0 ${t.palette.divider}`,
                      }
                    : {}),
                };
                return (
                  <TableCell
                    key={col.key}
                    align={colAlign(index)}
                    sortDirection={col.sortKey && sortBy === col.sortKey ? sortOrder : false}
                    sx={headerStyle}
                    title={col.label}
                  >
                    {col.sortKey && onSort && !bulkEditMode ? (
                      <TableSortLabel
                        active={sortBy === col.sortKey}
                        direction={sortBy === col.sortKey ? sortOrder : 'asc'}
                        onClick={() => onSort(col.sortKey!)}
                        sx={{
                          maxWidth: '100%',
                          '& .MuiTableSortLabel-icon': { flexShrink: 0 },
                        }}
                      >
                        <Box
                          component="span"
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {col.label}
                        </Box>
                      </TableSortLabel>
                    ) : (
                      col.label
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading || bulkEditActivating ? (
              <TableRow>
                <TableCell colSpan={PRODUCT_SHEET_COLUMNS.length + 2} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={32} />
                </TableCell>
              </TableRow>
            ) : displayProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={PRODUCT_SHEET_COLUMNS.length + 2} align="center" sx={{ py: 6 }}>
                  <Typography color="text.secondary">
                    {pageFilteredEmpty ? 'No matching products on this page' : 'No products found'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              displayProducts.map((product, rowIndex) => (
                <SheetRow
                  key={product.id}
                  product={product}
                  draft={drafts[product.id]}
                  bulkEditMode={bulkEditMode}
                  selected={selectedIds.has(product.id)}
                  rowIndex={rowIndex}
                  serialNumber={page * pageSize + rowIndex + 1}
                  options={selectOptions}
                  fieldErrors={validationErrors[product.id]}
                  serverError={serverErrors[product.id]}
                  onToggle={toggleRow}
                  onCellChange={handleCellChange}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={total ?? displayProducts.length}
        page={page}
        onPageChange={(_, p) => {
          if (isDirty) {
            showWarning('Save or cancel bulk edits before changing page');
            return;
          }
          onPageChange(p);
        }}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => {
          if (isDirty) {
            showWarning('Save or cancel bulk edits before changing page size');
            return;
          }
          onPageSizeChange(Number(e.target.value));
          onPageChange(0);
        }}
        rowsPerPageOptions={[25, 50, 100]}
      />
    </Paper>
  );
}
