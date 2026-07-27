import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
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
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { useBulkCreateProducts } from '@/hooks/useProducts';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useUomOptions } from '@/hooks/useUoms';
import { defaultPrimaryUom, hasUomConversion, normalizeProductUoms } from '@/utils/uomNormalize';
import { useCategoryNames } from '@/hooks/useCategories';
import { DROPDOWN_PAGE_SIZE, PRODUCT_CATEGORIES } from '@/constants';
import { productService } from '@/services';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import type { ProductBulkCreateItem } from '@/types';
import { noNumberSpinnerSx } from '@/pages/purchase-orders/inputStyles';

type ProductRow = {
  id: number;
  sku: string;
  name: string;
  brand: string;
  category: string;
  buyUom: string;
  uom: string;
  unitsPerBuyUom: string;
  costPrice: string;
  sellingPrice: string;
};

const INITIAL_ROW_COUNT = 10;

const emptyRow = (id: number, primaryUom = ''): ProductRow => ({
  id,
  sku: '',
  name: '',
  brand: '',
  category: '',
  buyUom: primaryUom,
  uom: primaryUom,
  unitsPerBuyUom: '1',
  costPrice: '0',
  sellingPrice: '0',
});

const HEADER_ALIASES: Record<string, keyof Omit<ProductRow, 'id'>> = {
  sku: 'sku',
  code: 'sku',
  name: 'name',
  'product name': 'name',
  product: 'name',
  brand: 'brand',
  category: 'category',
  'buy uom': 'buyUom',
  'base uom': 'uom',
  uom: 'uom',
  'units/pack': 'unitsPerBuyUom',
  'units per pack': 'unitsPerBuyUom',
  'units per buy': 'unitsPerBuyUom',
  cost: 'costPrice',
  'cost price': 'costPrice',
  'unit cost': 'costPrice',
  price: 'sellingPrice',
  'selling price': 'sellingPrice',
  'unit price': 'sellingPrice',
};

const compactFieldSx = {
  '& .MuiInputBase-root': { fontSize: '0.8125rem' },
};

function parsePaste(text: string, firstId: number): ProductRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const cells = lines.map((line) => line.split('\t').map((cell) => cell.trim()));
  const headers = cells[0].map((header) => HEADER_ALIASES[header.toLowerCase()]);
  const hasHeaders = headers.some(Boolean);
  const dataRows = hasHeaders ? cells.slice(1) : cells;
  const defaultColumns: Array<keyof Omit<ProductRow, 'id'>> = [
    'sku', 'name', 'brand', 'category', 'buyUom', 'uom', 'unitsPerBuyUom', 'costPrice', 'sellingPrice',
  ];
  return dataRows.filter((row) => row.some(Boolean)).map((cellsForRow, index) => {
    const row = emptyRow(firstId + index);
    cellsForRow.forEach((value, column) => {
      const key = hasHeaders ? headers[column] : defaultColumns[column];
      if (key) row[key] = value;
    });
    return row;
  });
}

function isPopulatedRow(row: ProductRow): boolean {
  return Boolean(
    row.name.trim()
    || row.sku.trim()
    || row.brand.trim()
    || row.category.trim()
    || row.costPrice.trim()
    || row.sellingPrice.trim(),
  );
}

export function BulkProductFormPage() {
  const navigate = useNavigate();
  const nextId = useRef(INITIAL_ROW_COUNT + 1);
  const [rows, setRows] = useState<ProductRow[]>(() =>
    Array.from({ length: INITIAL_ROW_COUNT }, (_, id) => emptyRow(id + 1)),
  );
  const [supplierId, setSupplierId] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('10');
  const [error, setError] = useState('');
  const [pasteNotice, setPasteNotice] = useState('');
  const [generatingSkus, setGeneratingSkus] = useState(false);
  const createMutation = useBulkCreateProducts();
  const { data: suppliersData } = useSuppliers({ pageSize: DROPDOWN_PAGE_SIZE });
  const uomOptions = useUomOptions();
  const primaryUom = defaultPrimaryUom(uomOptions);
  const dbCategories = useCategoryNames();
  const categories = dbCategories.length ? dbCategories : PRODUCT_CATEGORIES;

  const populatedRows = rows.filter(isPopulatedRow);

  useEffect(() => {
    if (!primaryUom) return;
    setRows((current) =>
      current.map((row) =>
        !row.buyUom && !isPopulatedRow(row)
          ? { ...row, buyUom: primaryUom, uom: primaryUom }
          : row,
      ),
    );
  }, [primaryUom]);

  const change = (id: number, field: keyof Omit<ProductRow, 'id'>, value: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const addRow = () => setRows((current) => [...current, emptyRow(nextId.current++, primaryUom)]);

  const removeRow = (id: number) => {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current));
  };

  const normalizeUom = (value: string) => {
    const normalized = value.trim().toLowerCase();
    return uomOptions.find((option) =>
      option.value.toLowerCase() === normalized || option.label.toLowerCase() === normalized,
    )?.value ?? value;
  };

  const generateSkus = async () => {
    const targets = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !row.sku.trim() && row.name.trim() && row.category.trim());
    if (!targets.length) {
      const namedWithoutCategory = rows.some(
        (row) => !row.sku.trim() && row.name.trim() && !row.category.trim(),
      );
      setError(
        namedWithoutCategory
          ? 'Set Category on rows before generating SKUs.'
          : 'Add product names first. SKUs are only generated for named rows without a SKU.',
      );
      return;
    }

    setGeneratingSkus(true);
    setError('');
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
      setPasteNotice(`Generated ${skus.length} SKU${skus.length === 1 ? '' : 's'} from the server.`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setGeneratingSkus(false);
    }
  };

  const paste = (text: string) => {
    const imported = parsePaste(text, nextId.current);
    if (!imported.length) return;
    nextId.current += imported.length;
    setRows(imported.map((row) => ({
      ...row,
      buyUom: normalizeUom(row.buyUom),
      uom: normalizeUom(row.uom),
    })));
    setPasteNotice(`${imported.length} row${imported.length === 1 ? '' : 's'} added from Excel. Review, then save.`);
    setError('');
  };

  const save = async () => {
    setError('');
    if (!populatedRows.length) {
      setError('Add at least one product row.');
      return;
    }

    const invalid = populatedRows.find((row) =>
      !row.name.trim()
      || Number(row.costPrice) < 0
      || Number(row.sellingPrice) < 0
      || !Number.isFinite(Number(row.unitsPerBuyUom))
      || Number(row.unitsPerBuyUom) < 1,
    );
    if (invalid) {
      setError(`Complete product name, prices, and units/pack on row ${rows.indexOf(invalid) + 1}.`);
      return;
    }

    const needsCategoryForSku = populatedRows.find(
      (row) => !row.sku.trim() && !row.category.trim(),
    );
    if (needsCategoryForSku) {
      setError(
        `Row ${rows.indexOf(needsCategoryForSku) + 1}: set Category before saving without a SKU `
        + '(server assigns a 6-digit SKU from the category code).',
      );
      return;
    }

    const duplicate = populatedRows.find((row, index) =>
      row.sku.trim()
      && populatedRows.findIndex((other) => other.sku.trim().toLowerCase() === row.sku.trim().toLowerCase()) !== index,
    );
    if (duplicate) {
      setError(`SKU ${duplicate.sku} is repeated in the grid.`);
      return;
    }

    const products: ProductBulkCreateItem[] = populatedRows.map((row) => {
      const uoms = normalizeProductUoms({
        buyUom: row.buyUom || primaryUom,
        uom: row.uom || row.buyUom || primaryUom,
        unitsPerBuyUom: Number(row.unitsPerBuyUom),
      });
      return {
      row: rows.indexOf(row) + 1,
      sku: row.sku.trim(),
      name: row.name.trim(),
      barcode: '',
      brand: row.brand,
      countryOfOrigin: '',
      category: row.category,
      supplierId,
      description: '',
      buyUom: uoms.buyUom,
      uom: uoms.uom,
      unitsPerBuyUom: uoms.unitsPerBuyUom,
      sellMode: hasUomConversion(uoms.unitsPerBuyUom) ? 'piece' : 'unit',
      costPrice: Number(row.costPrice),
      sellingPrice: Number(row.sellingPrice),
      packSellingPrice: 0,
      discountPercent: 0,
      offeredPrice: 0,
      packDiscountPercent: 0,
      packOfferedPrice: 0,
      images: [],
      stock: 0,
      lowStockThreshold: Number(lowStockThreshold) || 0,
      status: 'active',
      tags: [],
    };
    });

    try {
      const result = await createMutation.mutateAsync(products);
      if (result.created) {
        showSuccess(`${result.created} product${result.created === 1 ? '' : 's'} added.`);
      }
      if (result.errors.length) {
        setError(result.errors.map((item) => `Row ${item.row} (${item.sku || 'no SKU'}): ${item.detail}`).join(' · '));
        return;
      }
      navigate('/products');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

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
            >
              Add products
            </Button>
          </Box>
        )}
      />

      {error && <Alert severity="error">{error}</Alert>}
      {pasteNotice && (
        <Alert severity="success" onClose={() => setPasteNotice('')}>
          {pasteNotice}
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
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Paste rows from Excel into the grid. SKU is optional — leave blank and the server will assign unique SKUs on save.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            <Chip size="small" label={`${populatedRows.length} row${populatedRows.length === 1 ? '' : 's'} ready`} />
            <Chip size="small" variant="outlined" label="SKU auto-generated on save if empty" />
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            select
            label="Primary supplier"
            size="small"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">None</MenuItem>
            {(suppliersData?.data ?? []).map((supplier) => (
              <MenuItem key={supplier.id} value={supplier.id}>{supplier.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Low-stock threshold"
            size="small"
            type="number"
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value)}
            slotProps={{ htmlInput: { min: 0 } }}
            sx={{ width: 140 }}
          />
          <Button
            startIcon={<ContentPasteIcon />}
            onClick={() => navigator.clipboard.readText().then(paste).catch(() => setError('Use Ctrl+V in any grid cell to paste from Excel.'))}
          >
            Paste
          </Button>
          <Button
            startIcon={<AutorenewIcon />}
            onClick={() => void generateSkus()}
            loading={generatingSkus}
          >
            Preview SKUs
          </Button>
        </Box>
      </Paper>

      <TableContainer
        component={Paper}
        variant="outlined"
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (text.includes('\t') || text.includes('\n')) {
            event.preventDefault();
            paste(text);
          }
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        <Table
          stickyHeader
          size="small"
          sx={{
            tableLayout: 'fixed',
            width: '100%',
            '& .MuiTableCell-root': { px: 0.75, py: 0.5 },
          }}
        >
          <colgroup>
            <col style={{ width: '3%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '3%' }} />
          </colgroup>
          <TableHead>
            <TableRow>
              {['SN', 'SKU', 'Product name *', 'Brand', 'Category', 'Primary Unit', 'Secondary Unit', 'Conversion Rate', 'Unit cost', 'Selling price', ''].map((label) => (
                <TableCell
                  key={label || 'actions'}
                  sx={{
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    bgcolor: 'background.paper',
                    fontSize: '0.75rem',
                  }}
                >
                  {label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.id} hover>
                <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }}>
                  {index + 1}
                </TableCell>
                <TableCell>
                  <TextField
                    value={row.sku}
                    onChange={(e) => change(row.id, 'sku', e.target.value)}
                    size="small"
                    fullWidth
                    placeholder="Auto"
                    sx={compactFieldSx}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    value={row.name}
                    onChange={(e) => change(row.id, 'name', e.target.value)}
                    size="small"
                    fullWidth
                    required
                    sx={compactFieldSx}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    value={row.brand}
                    onChange={(e) => change(row.id, 'brand', e.target.value)}
                    size="small"
                    fullWidth
                    sx={compactFieldSx}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    select
                    value={row.category}
                    onChange={(e) => change(row.id, 'category', e.target.value)}
                    size="small"
                    fullWidth
                    sx={compactFieldSx}
                  >
                    <MenuItem value="">None</MenuItem>
                    {categories.map((category) => (
                      <MenuItem key={category} value={category}>{category}</MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                {(['buyUom', 'uom'] as const).map((field) => (
                  <TableCell key={field}>
                    <TextField
                      select
                      value={row[field]}
                      onChange={(e) => change(row.id, field, e.target.value)}
                      size="small"
                      fullWidth
                      sx={compactFieldSx}
                    >
                      {uomOptions.map((uom) => (
                        <MenuItem key={uom.value} value={uom.value}>{uom.label}</MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                ))}
                {(['unitsPerBuyUom', 'costPrice', 'sellingPrice'] as const).map((field) => (
                  <TableCell key={field}>
                    <TextField
                      value={row[field]}
                      onChange={(e) => change(row.id, field, e.target.value)}
                      type="number"
                      size="small"
                      fullWidth
                      slotProps={{
                        htmlInput: {
                          min: field === 'unitsPerBuyUom' ? 1 : 0,
                          step: field === 'unitsPerBuyUom' ? 1 : 0.01,
                        },
                      }}
                      sx={{
                        ...compactFieldSx,
                        ...(field === 'costPrice' || field === 'sellingPrice' ? noNumberSpinnerSx : {}),
                      }}
                    />
                  </TableCell>
                ))}
                <TableCell align="center">
                  <IconButton aria-label="Remove row" size="small" onClick={() => removeRow(row.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <Button startIcon={<AddIcon />} onClick={addRow}>
          Add row
        </Button>
        <Typography variant="caption" color="text.secondary">
          Tip: paste tab-separated rows from Excel directly into the grid.
        </Typography>
      </Box>
    </Box>
  );
}
