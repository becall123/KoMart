import * as XLSX from 'xlsx';
import { PRODUCT_FIELD_LABELS } from '@/constants/productFieldLabels';
import type { Product } from '@/types';
import {
  type BulkAddField,
  type BulkAddRow,
  emptyBulkAddRow,
} from './bulkAddValidation';

/** Header labels used in sample + import + export (order = column order). */
export const BULK_ADD_IMPORT_HEADERS: { field: BulkAddField; label: string }[] = [
  { field: 'name', label: PRODUCT_FIELD_LABELS.name },
  { field: 'sku', label: PRODUCT_FIELD_LABELS.sku },
  { field: 'brand', label: PRODUCT_FIELD_LABELS.brand },
  { field: 'category', label: PRODUCT_FIELD_LABELS.category },
  { field: 'barcode', label: PRODUCT_FIELD_LABELS.barcode },
  { field: 'supplierId', label: PRODUCT_FIELD_LABELS.supplier },
  { field: 'countryOfOrigin', label: PRODUCT_FIELD_LABELS.country },
  { field: 'description', label: PRODUCT_FIELD_LABELS.description },
  { field: 'buyUom', label: PRODUCT_FIELD_LABELS.buyUom },
  { field: 'uom', label: PRODUCT_FIELD_LABELS.baseUom },
  { field: 'unitsPerBuyUom', label: PRODUCT_FIELD_LABELS.unitsPerPack },
  { field: 'sellMode', label: PRODUCT_FIELD_LABELS.sellMode },
  { field: 'costPrice', label: PRODUCT_FIELD_LABELS.unitCost },
  { field: 'sellingPrice', label: PRODUCT_FIELD_LABELS.unitPrice },
  { field: 'packSellingPrice', label: PRODUCT_FIELD_LABELS.packPrice },
  { field: 'discountPercent', label: PRODUCT_FIELD_LABELS.discountPercent },
  { field: 'offeredPrice', label: PRODUCT_FIELD_LABELS.offeredPrice },
  { field: 'packDiscountPercent', label: PRODUCT_FIELD_LABELS.packDiscountPercent },
  { field: 'packOfferedPrice', label: PRODUCT_FIELD_LABELS.packOfferedPrice },
  { field: 'lowStockThreshold', label: PRODUCT_FIELD_LABELS.lowStock },
  { field: 'status', label: PRODUCT_FIELD_LABELS.status },
  { field: 'tags', label: PRODUCT_FIELD_LABELS.tags },
  { field: 'nutritionInfo', label: PRODUCT_FIELD_LABELS.nutrition },
  { field: 'allergenInfo', label: PRODUCT_FIELD_LABELS.allergens },
  { field: 'images', label: PRODUCT_FIELD_LABELS.images },
];

function joinList(values: string[] | undefined | null): string {
  if (!values?.length) return '';
  return values.map((v) => String(v).trim()).filter(Boolean).join(', ');
}

function numCell(value: number | undefined | null): string | number {
  if (value === undefined || value === null || Number.isNaN(value)) return '';
  return value;
}

/**
 * Serialize a catalog product into Bulk Add Excel cells (same order as import headers).
 * Values are import-friendly (supplier name, raw status/sellMode, comma-joined lists).
 */
export function productToBulkAddExportCells(product: Product): (string | number)[] {
  const byField: Record<BulkAddField, string | number> = {
    name: product.name ?? '',
    sku: product.sku ?? '',
    brand: product.brand ?? '',
    category: product.category ?? '',
    barcode: product.barcode ?? '',
    supplierId: product.supplierName ?? '',
    countryOfOrigin: product.countryOfOrigin ?? '',
    description: product.description ?? '',
    buyUom: product.buyUom ?? product.uom ?? '',
    uom: product.uom ?? '',
    unitsPerBuyUom: numCell(product.unitsPerBuyUom ?? 1),
    sellMode: product.sellMode ?? 'both',
    costPrice: numCell(product.costPrice),
    sellingPrice: numCell(product.sellingPrice),
    packSellingPrice: numCell(product.packSellingPrice),
    discountPercent: numCell(product.discountPercent),
    offeredPrice: numCell(product.offeredPrice),
    packDiscountPercent: numCell(product.packDiscountPercent),
    packOfferedPrice: numCell(product.packOfferedPrice),
    lowStockThreshold: numCell(product.lowStockThreshold),
    status: product.status ?? 'active',
    tags: joinList(product.tags),
    nutritionInfo: product.nutritionInfo ?? '',
    allergenInfo: product.allergenInfo ?? '',
    images: joinList(product.images),
  };
  return BULK_ADD_IMPORT_HEADERS.map((col) => byField[col.field]);
}
const HEADER_ALIASES: Record<string, BulkAddField> = {
  sku: 'sku',
  code: 'sku',
  name: 'name',
  'product name': 'name',
  product: 'name',
  brand: 'brand',
  category: 'category',
  barcode: 'barcode',
  supplier: 'supplierId',
  'supplier id': 'supplierId',
  'supplier name': 'supplierId',
  country: 'countryOfOrigin',
  'country of origin': 'countryOfOrigin',
  description: 'description',
  'buy uom': 'buyUom',
  'primary unit': 'buyUom',
  buyuom: 'buyUom',
  'base uom': 'uom',
  uom: 'uom',
  'secondary unit': 'uom',
  'units/pack': 'unitsPerBuyUom',
  'units per pack': 'unitsPerBuyUom',
  'units per buy': 'unitsPerBuyUom',
  unitsperbuyuom: 'unitsPerBuyUom',
  'sell mode': 'sellMode',
  sellmode: 'sellMode',
  cost: 'costPrice',
  'cost price': 'costPrice',
  'unit cost': 'costPrice',
  costprice: 'costPrice',
  price: 'sellingPrice',
  'selling price': 'sellingPrice',
  'unit price': 'sellingPrice',
  sellingprice: 'sellingPrice',
  'pack price': 'packSellingPrice',
  'pack selling price': 'packSellingPrice',
  packsellingprice: 'packSellingPrice',
  'discount %': 'discountPercent',
  'discount percent': 'discountPercent',
  discountpercent: 'discountPercent',
  'offered price': 'offeredPrice',
  offeredprice: 'offeredPrice',
  'pack discount %': 'packDiscountPercent',
  packdiscountpercent: 'packDiscountPercent',
  'pack offered price': 'packOfferedPrice',
  packofferedprice: 'packOfferedPrice',
  'low stock': 'lowStockThreshold',
  lowstock: 'lowStockThreshold',
  lowstockthreshold: 'lowStockThreshold',
  status: 'status',
  tags: 'tags',
  nutrition: 'nutritionInfo',
  nutritioninfo: 'nutritionInfo',
  allergens: 'allergenInfo',
  allergeninfo: 'allergenInfo',
  images: 'images',
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
}

export type BulkAddParseContext = {
  nextId: () => number;
  primaryUom: string;
  defaultSupplierId: string;
  defaultLowStock: string;
  resolveSupplierId: (raw: string) => string;
  normalizeUom: (raw: string) => string;
};

function applyCell(
  row: BulkAddRow,
  field: BulkAddField,
  raw: string,
  ctx: BulkAddParseContext,
) {
  const value = raw.trim();
  if (!value) return;

  if (field === 'sellMode') {
    const v = value.toLowerCase();
    if (v === 'piece' || v === 'unit' || v === 'both') {
      row.sellMode = v;
      return;
    }
    if (v.includes('both') || (v.includes('pack') && v.includes('piece'))) {
      row.sellMode = 'both';
      return;
    }
    if (v.includes('piece')) {
      row.sellMode = 'piece';
      return;
    }
    if (v.includes('pack') || v.includes('box') || v === 'unit') {
      row.sellMode = 'unit';
    }
    return;
  }

  if (field === 'status') {
    const v = value.toLowerCase();
    if (v === 'active' || v === 'seasonal' || v === 'discontinued') {
      row.status = v;
    }
    return;
  }

  if (field === 'supplierId') {
    row.supplierId = ctx.resolveSupplierId(value);
    return;
  }

  if (field === 'buyUom' || field === 'uom') {
    row[field] = ctx.normalizeUom(value);
    return;
  }

  row[field] = value;
}

function parseMatrix(
  matrix: string[][],
  ctx: BulkAddParseContext,
): BulkAddRow[] {
  if (!matrix.length) return [];

  const first = matrix[0].map((c) => normalizeHeader(String(c ?? '')));
  const hasHeader = first.some((c) => c in HEADER_ALIASES || Object.values(PRODUCT_FIELD_LABELS).some(
    (label) => normalizeHeader(label) === c,
  ));

  let colMap: Array<BulkAddField | null>;
  let dataRows: string[][];

  if (hasHeader) {
    colMap = first.map((h) => {
      if (h in HEADER_ALIASES) return HEADER_ALIASES[h];
      const byLabel = BULK_ADD_IMPORT_HEADERS.find(
        (col) => normalizeHeader(col.label) === h,
      );
      return byLabel?.field ?? null;
    });
    dataRows = matrix.slice(1);
  } else {
    colMap = BULK_ADD_IMPORT_HEADERS.map((h) => h.field);
    dataRows = matrix;
  }

  return dataRows
    .filter((cells) => cells.some((c) => String(c ?? '').trim()))
    .map((cells) => {
      const row = emptyBulkAddRow(ctx.nextId(), ctx.primaryUom, {
        supplierId: ctx.defaultSupplierId,
        lowStockThreshold: ctx.defaultLowStock,
      });
      colMap.forEach((field, i) => {
        if (!field || cells[i] === undefined) return;
        applyCell(row, field, String(cells[i] ?? ''), ctx);
      });
      return row;
    });
}

/** Parse TSV / clipboard text into Bulk Add rows. */
export function parseBulkAddTsv(text: string, ctx: BulkAddParseContext): BulkAddRow[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  const matrix = lines.map((line) => line.split('\t'));
  return parseMatrix(matrix, ctx);
}

/** Parse .xlsx / .xls / .csv File into Bulk Add rows. */
export async function parseBulkAddExcelFile(
  file: File,
  ctx: BulkAddParseContext,
): Promise<BulkAddRow[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as string[][];
  return parseMatrix(
    matrix.map((row) => row.map((c) => String(c ?? ''))),
    ctx,
  );
}

/** Download a sample Excel template for Bulk Add. */
export function downloadBulkAddSampleExcel(): void {
  const headers = BULK_ADD_IMPORT_HEADERS.map((h) => h.label);
  const example = [
    'Shin Ramyun Spicy',
    '',
    'Nongshim',
    'Instant Noodles',
    '',
    '',
    'South Korea',
    '',
    'pack',
    'pcs',
    '5',
    'both',
    '80',
    '120',
    '550',
    '',
    '',
    '',
    '',
    '10',
    'active',
    'spicy,noodles',
    '',
    '',
    '',
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bulk Add');
  XLSX.writeFile(wb, 'komart-bulk-add-sample.xlsx');
}
