import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Link,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import SaveIcon from '@mui/icons-material/Save';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import {
  COUNTRIES,
  DROPDOWN_PAGE_SIZE,
  PRODUCT_CATEGORIES,
  PRODUCT_STATUS_OPTIONS,
  QUERY_KEYS,
  STALE_TIME,
} from '@/constants';
import { PRODUCT_FIELD_LABELS } from '@/constants/productFieldLabels';
import { useBulkCreateProducts } from '@/hooks/useProducts';
import { useCategoryNames } from '@/hooks/useCategories';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useUomOptions } from '@/hooks/useUoms';
import { productService } from '@/services';
import { getErrorMessage } from '@/services/apiClient';
import type { ProductBulkCreateItem, ProductStatus, Supplier } from '@/types';
import { defaultPrimaryUom, normalizeProductUoms } from '@/utils/uomNormalize';
import { showInfo, showSuccess } from '@/utils/toast';
import {
  downloadBulkAddSampleExcel,
  parseBulkAddExcelFile,
  parseBulkAddTsv,
  type BulkAddParseContext,
} from './bulkAddExcel';
import {
  type BulkAddExistingLookup,
  type BulkAddField,
  type BulkAddFieldErrors,
  type BulkAddRow,
  type BulkAddSellMode,
  type BulkAddValidationMap,
  countBulkAddErrors,
  DEFAULT_LOW_STOCK,
  emptyBulkAddRow,
  isPopulatedBulkAddRow,
  validateBulkAddRows,
} from './bulkAddValidation';

const INITIAL_ROW_COUNT = 10;

const BULK_ADD_SELL_MODE_OPTIONS = [
  { value: 'unit', label: 'unit' },
  { value: 'piece', label: 'piece' },
  { value: 'both', label: 'both' },
] as const;

function showBulkAddTips() {
  showInfo(
    'Import Excel or paste rows into the grid. '
    + 'Products → Export Excel uses the same columns (edit offline, then Import here). '
    + 'Blank name and SKU rows are skipped on save. '
    + 'Duplicate names/SKUs (in-grid or catalog) are blocked. '
    + 'SKU: leave blank only with Category set (server assigns CCNNNN), or use Generate SKUs. '
    + 'Low stock: set per row in the Low stock column (default 10 for new rows).',
    { duration: 12000 },
  );
}
const EMPTY_SUPPLIERS: Supplier[] = [];
const FALLBACK_CATEGORIES = [...PRODUCT_CATEGORIES];

type ColKind = 'text' | 'number' | 'select';

type BulkAddCol = {
  key: BulkAddField;
  label: string;
  width: number;
  kind: ColKind;
  sticky?: boolean;
  /** Sticky left offset in px (after # column at 0). */
  stickyLeft?: number;
};

const COLUMNS: BulkAddCol[] = [
  { key: 'name', label: PRODUCT_FIELD_LABELS.name, width: 180, kind: 'text', sticky: true, stickyLeft: 44 },
  { key: 'sku', label: PRODUCT_FIELD_LABELS.sku, width: 100, kind: 'text', sticky: true, stickyLeft: 224 },
  { key: 'brand', label: PRODUCT_FIELD_LABELS.brand, width: 120, kind: 'text' },
  { key: 'category', label: PRODUCT_FIELD_LABELS.category, width: 130, kind: 'select' },
  { key: 'barcode', label: PRODUCT_FIELD_LABELS.barcode, width: 120, kind: 'text' },
  { key: 'supplierId', label: PRODUCT_FIELD_LABELS.supplier, width: 150, kind: 'select' },
  { key: 'countryOfOrigin', label: PRODUCT_FIELD_LABELS.country, width: 130, kind: 'select' },
  { key: 'description', label: PRODUCT_FIELD_LABELS.description, width: 160, kind: 'text' },
  { key: 'buyUom', label: PRODUCT_FIELD_LABELS.buyUom, width: 110, kind: 'select' },
  { key: 'uom', label: PRODUCT_FIELD_LABELS.baseUom, width: 110, kind: 'select' },
  { key: 'unitsPerBuyUom', label: PRODUCT_FIELD_LABELS.unitsPerPack, width: 90, kind: 'number' },
  { key: 'sellMode', label: PRODUCT_FIELD_LABELS.sellMode, width: 140, kind: 'select' },
  { key: 'costPrice', label: PRODUCT_FIELD_LABELS.unitCost, width: 100, kind: 'number' },
  { key: 'sellingPrice', label: PRODUCT_FIELD_LABELS.unitPrice, width: 100, kind: 'number' },
  { key: 'packSellingPrice', label: PRODUCT_FIELD_LABELS.packPrice, width: 100, kind: 'number' },
  { key: 'discountPercent', label: PRODUCT_FIELD_LABELS.discountPercent, width: 90, kind: 'number' },
  { key: 'offeredPrice', label: PRODUCT_FIELD_LABELS.offeredPrice, width: 100, kind: 'number' },
  { key: 'packDiscountPercent', label: PRODUCT_FIELD_LABELS.packDiscountPercent, width: 100, kind: 'number' },
  { key: 'packOfferedPrice', label: PRODUCT_FIELD_LABELS.packOfferedPrice, width: 110, kind: 'number' },
  { key: 'lowStockThreshold', label: PRODUCT_FIELD_LABELS.lowStock, width: 90, kind: 'number' },
  { key: 'status', label: PRODUCT_FIELD_LABELS.status, width: 110, kind: 'select' },
  { key: 'tags', label: PRODUCT_FIELD_LABELS.tags, width: 140, kind: 'text' },
  { key: 'nutritionInfo', label: PRODUCT_FIELD_LABELS.nutrition, width: 140, kind: 'text' },
  { key: 'allergenInfo', label: PRODUCT_FIELD_LABELS.allergens, width: 140, kind: 'text' },
  { key: 'images', label: PRODUCT_FIELD_LABELS.images, width: 160, kind: 'text' },
];

const baseInputStyle: CSSProperties = {
  width: '100%',
  font: 'inherit',
  fontSize: '0.8125rem',
  lineHeight: 1.4,
  padding: '4px 6px',
  border: '1px solid #cfcfcf',
  borderRadius: 4,
  background: '#fff',
  boxSizing: 'border-box',
};

const errorInputStyle: CSSProperties = {
  ...baseInputStyle,
  borderColor: '#d32f2f',
  background: '#fff5f5',
};

const numberNoSpinnerCss = `
.bulk-add-num::-webkit-outer-spin-button,
.bulk-add-num::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.bulk-add-num {
  -moz-appearance: textfield;
  appearance: textfield;
}
.bulk-add-input:focus {
  outline: 2px solid #1976d2;
  outline-offset: 0;
}
`;

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function numOr(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function rowToPayload(
  row: BulkAddRow,
  rowNumber: number,
  primaryUom: string,
  fallbackSupplierId: string,
  fallbackLowStock: number,
): ProductBulkCreateItem {
  const uoms = normalizeProductUoms({
    buyUom: row.buyUom || primaryUom,
    uom: row.uom || row.buyUom || primaryUom,
    unitsPerBuyUom: numOr(row.unitsPerBuyUom, 1),
  });
  return {
    row: rowNumber,
    sku: row.sku.trim(),
    name: row.name.trim(),
    barcode: row.barcode.trim(),
    brand: row.brand.trim(),
    countryOfOrigin: row.countryOfOrigin.trim(),
    category: row.category.trim(),
    supplierId: row.supplierId || fallbackSupplierId,
    description: row.description.trim(),
    buyUom: uoms.buyUom,
    uom: uoms.uom,
    unitsPerBuyUom: uoms.unitsPerBuyUom,
    sellMode: row.sellMode,
    costPrice: numOr(row.costPrice, 0),
    sellingPrice: numOr(row.sellingPrice, 0),
    packSellingPrice: numOr(row.packSellingPrice, 0),
    discountPercent: numOr(row.discountPercent, 0),
    offeredPrice: numOr(row.offeredPrice, 0),
    packDiscountPercent: numOr(row.packDiscountPercent, 0),
    packOfferedPrice: numOr(row.packOfferedPrice, 0),
    images: parseList(row.images),
    stock: 0,
    lowStockThreshold: row.lowStockThreshold.trim()
      ? Math.max(0, Math.floor(numOr(row.lowStockThreshold, fallbackLowStock)))
      : fallbackLowStock,
    status: row.status,
    tags: parseList(row.tags),
    nutritionInfo: row.nutritionInfo.trim() || undefined,
    allergenInfo: row.allergenInfo.trim() || undefined,
  };
}

type SelectOpts = {
  suppliers: Supplier[];
  categories: string[];
  uoms: { value: string; label: string }[];
};

/** Local-draft text/number cell — typing stays off the urgent parent render path. */
const BulkAddTextCell = memo(function BulkAddTextCell({
  rowId,
  field,
  value,
  error,
  kind,
  onFieldChange,
}: {
  rowId: number;
  field: BulkAddField;
  value: string;
  error?: string;
  kind: 'text' | 'number';
  onFieldChange: (id: number, field: BulkAddField, value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);

  return (
    <input
      className={`bulk-add-input${kind === 'number' ? ' bulk-add-num' : ''}`}
      title={error || undefined}
      type={kind === 'number' ? 'number' : 'text'}
      value={local}
      style={error ? errorInputStyle : baseInputStyle}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        const next = e.target.value;
        setLocal(next);
        startTransition(() => onFieldChange(rowId, field, next));
      }}
      onBlur={() => {
        focused.current = false;
        onFieldChange(rowId, field, local);
      }}
    />
  );
});

const BulkAddSelectCell = memo(function BulkAddSelectCell({
  rowId,
  colKey,
  value,
  error,
  opts,
  onFieldChange,
}: {
  rowId: number;
  colKey: BulkAddField;
  value: string;
  error?: string;
  opts: SelectOpts;
  onFieldChange: (id: number, field: BulkAddField, value: string) => void;
}) {
  let options: { value: string; label: string }[] = [];
  if (colKey === 'category') {
    options = opts.categories.map((c) => ({ value: c, label: c }));
  } else if (colKey === 'supplierId') {
    options = opts.suppliers.map((s) => ({ value: s.id, label: s.name }));
  } else if (colKey === 'countryOfOrigin') {
    options = COUNTRIES.map((c) => ({ value: c, label: c }));
  } else if (colKey === 'buyUom' || colKey === 'uom') {
    options = opts.uoms;
  } else if (colKey === 'sellMode') {
    options = BULK_ADD_SELL_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  } else if (colKey === 'status') {
    options = PRODUCT_STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }));
  }

  return (
    <select
      className="bulk-add-input"
      title={error || undefined}
      value={value}
      style={error ? errorInputStyle : baseInputStyle}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onFieldChange(rowId, colKey, e.target.value)}
    >
      {(colKey === 'sellMode' || colKey === 'status') ? null : <option value="">—</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
});

const BulkAddRowView = memo(function BulkAddRowView({
  row,
  index,
  errors,
  opts,
  canDelete,
  onFieldChange,
  onRemove,
}: {
  row: BulkAddRow;
  index: number;
  errors?: BulkAddFieldErrors;
  opts: SelectOpts;
  canDelete: boolean;
  onFieldChange: (id: number, field: BulkAddField, value: string) => void;
  onRemove: (id: number) => void;
}) {
  const populated = isPopulatedBulkAddRow(row);

  return (
    <tr
      style={{
        background: populated ? undefined : 'rgba(0,0,0,0.02)',
      }}
    >
      <td
        style={{
          position: 'sticky',
          left: 0,
          zIndex: 1,
          background: populated ? '#fff' : '#fafafa',
          padding: '4px 8px',
          borderBottom: '1px solid #e0e0e0',
          textAlign: 'center',
          fontSize: '0.8125rem',
          color: '#666',
          minWidth: 44,
        }}
      >
        {index + 1}
      </td>
      {COLUMNS.map((col) => (
        <td
          key={col.key}
          style={{
            padding: '4px',
            borderBottom: '1px solid #e0e0e0',
            minWidth: col.width,
            width: col.width,
            ...(col.sticky
              ? {
                  position: 'sticky' as const,
                  left: col.stickyLeft ?? 44,
                  zIndex: 1,
                  background: populated ? '#fff' : '#fafafa',
                  boxShadow: col.key === 'sku' ? '2px 0 0 #e0e0e0' : undefined,
                }
              : {}),
          }}
        >
          {col.kind === 'select' ? (
            <BulkAddSelectCell
              rowId={row.id}
              colKey={col.key}
              value={String(row[col.key] ?? '')}
              error={errors?.[col.key]}
              opts={opts}
              onFieldChange={onFieldChange}
            />
          ) : (
            <BulkAddTextCell
              rowId={row.id}
              field={col.key}
              value={String(row[col.key] ?? '')}
              error={errors?.[col.key]}
              kind={col.kind}
              onFieldChange={onFieldChange}
            />
          )}
        </td>
      ))}
      <td
        style={{
          padding: '4px',
          borderBottom: '1px solid #e0e0e0',
          position: 'sticky',
          right: 0,
          background: populated ? '#fff' : '#fafafa',
          zIndex: 1,
        }}
      >
        <Tooltip title="Remove row">
          <span>
            <IconButton size="small" disabled={!canDelete} onClick={() => onRemove(row.id)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </td>
    </tr>
  );
});

async function loadExistingProductKeys(): Promise<BulkAddExistingLookup> {
  const names = new Set<string>();
  const skus = new Set<string>();
  let page = 1;
  let totalPages = 1;
  do {
    const res = await productService.getAll({ page, pageSize: 100 });
    for (const p of res.data) {
      if (p.name?.trim()) names.add(p.name.trim().toLowerCase());
      if (p.sku?.trim()) skus.add(p.sku.trim().toLowerCase());
    }
    totalPages = res.totalPages || 1;
    page += 1;
  } while (page <= totalPages && page <= 40);
  return { names, skus };
}

export function BulkProductFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nextId = useRef(INITIAL_ROW_COUNT + 1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tipsShown = useRef(false);
  const [rows, setRows] = useState<BulkAddRow[]>(() =>
    Array.from({ length: INITIAL_ROW_COUNT }, (_, i) => emptyBulkAddRow(i + 1)),
  );
  const [defaultSupplierId, setDefaultSupplierId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<BulkAddValidationMap>({});
  const [pageError, setPageError] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [generatingSkus, setGeneratingSkus] = useState(false);
  const [importing, setImporting] = useState(false);

  const createMutation = useBulkCreateProducts();
  const { data: suppliersData } = useSuppliers({ pageSize: DROPDOWN_PAGE_SIZE });
  const suppliers = suppliersData?.data ?? EMPTY_SUPPLIERS;
  const uomOptions = useUomOptions();
  const primaryUom = defaultPrimaryUom(uomOptions);
  const dbCategories = useCategoryNames();
  const categories = dbCategories.length ? dbCategories : FALLBACK_CATEGORIES;

  const { data: existingKeys } = useQuery({
    queryKey: [...QUERY_KEYS.products, 'bulk-add-existing-keys'],
    queryFn: loadExistingProductKeys,
    staleTime: STALE_TIME.static,
  });

  const selectOpts = useMemo<SelectOpts>(
    () => ({ suppliers, categories, uoms: uomOptions }),
    [suppliers, categories, uomOptions],
  );

  const populatedCount = useMemo(
    () => rows.reduce((n, row) => n + (isPopulatedBulkAddRow(row) ? 1 : 0), 0),
    [rows],
  );
  const errorCount = useMemo(() => countBulkAddErrors(fieldErrors), [fieldErrors]);

  useEffect(() => {
    if (tipsShown.current) return;
    tipsShown.current = true;
    showBulkAddTips();
  }, []);

  // Autofill Primary UOM only — Secondary stays empty by default.
  useEffect(() => {
    if (!primaryUom) return;
    setRows((current) => {
      let changed = false;
      const next = current.map((row) => {
        if (row.buyUom) return row;
        changed = true;
        return { ...row, buyUom: primaryUom };
      });
      return changed ? next : current;
    });
  }, [primaryUom]);

  const updateField = useCallback((id: number, field: BulkAddField, value: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        if (field === 'sellMode') {
          return { ...row, sellMode: value as BulkAddSellMode };
        }
        if (field === 'status') {
          return { ...row, status: value as ProductStatus };
        }
        return { ...row, [field]: value };
      }),
    );
    setFieldErrors((prev) => {
      const rowErrs = prev[id];
      if (!rowErrs?.[field]) return prev;
      const { [field]: _removed, ...rest } = rowErrs;
      if (Object.keys(rest).length === 0) {
        const { [id]: _row, ...restMap } = prev;
        return restMap;
      }
      return { ...prev, [id]: rest };
    });
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      emptyBulkAddRow(nextId.current++, primaryUom, {
        supplierId: defaultSupplierId,
      }),
    ]);
  }, [primaryUom, defaultSupplierId]);

  const removeRow = useCallback((id: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
    setFieldErrors((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const normalizeUom = useCallback(
    (value: string) => {
      const normalized = value.trim().toLowerCase();
      return (
        uomOptions.find(
          (option) =>
            option.value.toLowerCase() === normalized
            || option.label.toLowerCase() === normalized,
        )?.value ?? value
      );
    },
    [uomOptions],
  );

  const makeParseCtx = useCallback((): BulkAddParseContext => ({
    nextId: () => nextId.current++,
    primaryUom,
    defaultSupplierId,
    defaultLowStock: DEFAULT_LOW_STOCK,
    resolveSupplierId: (raw) => {
      const match = suppliers.find(
        (s) => s.name.toLowerCase() === raw.toLowerCase() || s.id === raw,
      );
      return match?.id ?? '';
    },
    normalizeUom,
  }), [primaryUom, defaultSupplierId, suppliers, normalizeUom]);

  const mergeImportedRows = useCallback((imported: BulkAddRow[]) => {
    if (!imported.length) return;
    setRows((prev) => {
      const blank = prev.filter((r) => !isPopulatedBulkAddRow(r));
      const filled = prev.filter(isPopulatedBulkAddRow);
      return [...filled, ...imported, ...blank.slice(0, Math.max(0, 3))];
    });
    setFieldErrors({});
    showSuccess(
      `${imported.length} row${imported.length === 1 ? '' : 's'} loaded into the grid. Review, then save.`,
    );
    setPageError('');
  }, []);

  const generateSkus = async () => {
    const targets = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !row.sku.trim() && row.name.trim() && row.category.trim());
    if (!targets.length) {
      const namedWithoutCategory = rows.some(
        (row) => !row.sku.trim() && row.name.trim() && !row.category.trim(),
      );
      setPageError(
        namedWithoutCategory
          ? 'Set Category on rows before generating SKUs.'
          : 'Add product names first. SKUs are only generated for named rows without a SKU.',
      );
      return;
    }

    setGeneratingSkus(true);
    setPageError('');
    try {
      const exclude = rows.map((row) => row.sku.trim()).filter(Boolean);
      const { skus } = await productService.suggestSkus(
        targets.map(({ row }) => ({ brand: row.brand, category: row.category })),
        exclude,
      );
      setRows((current) => {
        const next = [...current];
        targets.forEach(({ index }, skuIndex) => {
          next[index] = { ...next[index], sku: skus[skuIndex] ?? '' };
        });
        return next;
      });
      showSuccess(`Generated ${skus.length} SKU${skus.length === 1 ? '' : 's'} from the server.`);
    } catch (err) {
      setPageError(getErrorMessage(err));
    } finally {
      setGeneratingSkus(false);
    }
  };

  const applyPaste = () => {
    const imported = parseBulkAddTsv(pasteText, makeParseCtx());
    if (!imported.length) {
      setPageError('No rows found in pasted text.');
      return;
    }
    mergeImportedRows(imported);
    setPasteOpen(false);
    setPasteText('');
  };

  const onExcelSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setPageError('');
    try {
      const imported = await parseBulkAddExcelFile(file, makeParseCtx());
      if (!imported.length) {
        setPageError('No data rows found in the Excel file.');
        return;
      }
      mergeImportedRows(imported);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to read Excel file');
    } finally {
      setImporting(false);
    }
  };

  const save = async () => {
    setPageError('');
    const populatedRows = rows.filter(isPopulatedBulkAddRow);
    if (!populatedRows.length) {
      setPageError('Add at least one product with a name or SKU.');
      return;
    }

    const errors = validateBulkAddRows(rows, existingKeys);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const n = countBulkAddErrors(errors);
      setPageError(`${n} cell${n !== 1 ? 's' : ''} need attention — highlighted in red.`);
      return;
    }

    const fallbackLow = Math.max(0, Math.floor(numOr(DEFAULT_LOW_STOCK, 10)));
    const bindings = populatedRows.map((row) => {
      const rowNum = rows.indexOf(row) + 1;
      return {
        id: row.id,
        rowNum,
        payload: rowToPayload(row, rowNum, primaryUom, defaultSupplierId, fallbackLow),
      };
    });

    try {
      const result = await createMutation.mutateAsync(bindings.map((b) => b.payload));
      const failedRowNums = new Set(result.errors.map((item) => item.row));
      const succeededIds = new Set(
        bindings.filter((b) => !failedRowNums.has(b.rowNum)).map((b) => b.id),
      );

      if (result.created) {
        showSuccess(`${result.created} product${result.created === 1 ? '' : 's'} added.`);
        if (succeededIds.size > 0) {
          setRows((prev) => {
            const remaining = prev.filter((row) => !succeededIds.has(row.id));
            return remaining.length > 0
              ? remaining
              : [emptyBulkAddRow(nextId.current++)];
          });
          setFieldErrors((prev) => {
            const next = { ...prev };
            for (const id of succeededIds) delete next[id];
            return next;
          });
          void queryClient.invalidateQueries({
            queryKey: [...QUERY_KEYS.products, 'bulk-add-existing-keys'],
          });
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.products });
        }
      }
      if (result.errors.length) {
        setPageError(
          result.errors
            .map((item) => `Row ${item.row} (${item.sku || 'no SKU'}): ${item.detail}`)
            .join('\n'),
        );
        return;
      }
      navigate('/products');
    } catch (err) {
      setPageError(getErrorMessage(err));
    }
  };

  const errorSummary = Object.entries(fieldErrors)
    .flatMap(([id, errs]) => {
      const idx = rows.findIndex((r) => r.id === Number(id));
      return Object.entries(errs).map(
        ([field, msg]) =>
          `Row ${idx + 1} ${COLUMNS.find((c) => c.key === field)?.label ?? field}: ${msg}`,
      );
    })
    .slice(0, 5);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        gap: 1.5,
      }}
    >
      <style>{numberNoSpinnerCss}</style>

      <PageHeader
        title="Bulk Add Products"
        breadcrumbs={[{ label: 'Products', path: '/products' }, { label: 'Bulk add' }]}
        action={(
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/products')}>
              Cancel
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={() => void save()}
              loading={createMutation.isPending}
              disabled={populatedCount === 0}
            >
              Add products{populatedCount > 0 ? ` (${populatedCount})` : ''}
            </Button>
          </Box>
        )}
      />

      {(pageError || errorCount > 0) && (
        <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>
          {pageError || `${errorCount} cells need attention`}
          {errorSummary.length > 0 && (
            <Box component="ul" sx={{ m: 0, pl: 2, mt: 0.5 }}>
              {errorSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {errorCount > errorSummary.length && (
                <li>…and {errorCount - errorSummary.length} more</li>
              )}
            </Box>
          )}
        </Alert>
      )}
      <Paper
        variant="outlined"
        sx={{
          px: 2,
          py: 1.5,
          display: 'flex',
          alignItems: { xs: 'stretch', md: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', minWidth: 0, flex: 1 }}>
          <Chip
            size="small"
            label={`${populatedCount} row${populatedCount === 1 ? '' : 's'} ready`}
          />
          <TextField
            select
            size="small"
            label="Default supplier"
            value={defaultSupplierId}
            onChange={(e) => setDefaultSupplierId(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">—</MenuItem>
            {suppliers.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          <Link
            component="button"
            type="button"
            variant="body2"
            onClick={() => downloadBulkAddSampleExcel()}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <DownloadIcon fontSize="inherit" />
            Download sample Excel
          </Link>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Tooltip title="Show tips">
            <IconButton size="small" onClick={showBulkAddTips} aria-label="Show tips">
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(e) => void onExcelSelected(e)}
          />
          <Button
            size="small"
            startIcon={<UploadFileIcon />}
            loading={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            Import Excel
          </Button>
          <Button
            size="small"
            startIcon={<ContentPasteIcon />}
            onClick={() => setPasteOpen((o) => !o)}
          >
            Paste
          </Button>
          <Button
            size="small"
            startIcon={<AutorenewIcon />}
            onClick={() => void generateSkus()}
            loading={generatingSkus}
          >
            Generate SKUs
          </Button>
          <Button size="small" startIcon={<AddIcon />} onClick={addRow}>
            Add row
          </Button>
        </Box>
      </Paper>

      {pasteOpen && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Paste TSV from Excel / Sheets. Optional header row with field names.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Name	SKU	Brand	Category	…"
            sx={{ mb: 1 }}
          />
          <Button
            variant="contained"
            size="small"
            onClick={applyPaste}
            disabled={!pasteText.trim()}
          >
            Import paste
          </Button>
        </Paper>
      )}

      <Paper
        variant="outlined"
        sx={{
          overflow: 'auto',
          flex: 1,
          minHeight: 0,
          maxHeight: 'calc(100vh - 260px)',
        }}
      >
        <Box
          component="table"
          sx={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%' }}
        >
          <Box component="thead" sx={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <Box component="tr" sx={{ bgcolor: 'grey.100' }}>
              <Box
                component="th"
                sx={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 3,
                  bgcolor: 'grey.100',
                  px: 1,
                  py: 1,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  borderBottom: '2px solid',
                  borderColor: 'divider',
                  textAlign: 'left',
                }}
              >
                #
              </Box>
              {COLUMNS.map((col) => (
                <Box
                  component="th"
                  key={col.key}
                  sx={{
                    px: 0.75,
                    py: 1,
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    borderBottom: '2px solid',
                    borderColor: 'divider',
                    textAlign: 'left',
                    minWidth: col.width,
                    whiteSpace: 'nowrap',
                    bgcolor: 'grey.100',
                    ...(col.sticky
                      ? {
                          position: 'sticky',
                          left: col.stickyLeft ?? 44,
                          zIndex: 3,
                          boxShadow:
                            col.key === 'sku'
                              ? ((t: Theme) => `2px 0 0 ${t.palette.divider}`)
                              : undefined,
                        }
                      : {}),
                  }}
                >
                  {col.label}
                </Box>
              ))}
              <Box
                component="th"
                sx={{
                  position: 'sticky',
                  right: 0,
                  zIndex: 3,
                  bgcolor: 'grey.100',
                  px: 1,
                  py: 1,
                  borderBottom: '2px solid',
                  borderColor: 'divider',
                  width: 48,
                }}
              />
            </Box>
          </Box>
          <tbody>
            {rows.map((row, index) => (
              <BulkAddRowView
                key={row.id}
                row={row}
                index={index}
                errors={fieldErrors[row.id]}
                opts={selectOpts}
                canDelete={rows.length > 1}
                onFieldChange={updateField}
                onRemove={removeRow}
              />
            ))}
          </tbody>
        </Box>
      </Paper>
    </Box>
  );
}
