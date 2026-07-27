import type { Product, ProductStatus } from '@/types';

export type BulkAddSellMode = NonNullable<Product['sellMode']>;

/** String-backed draft row for Bulk Add (create) grid. */
export type BulkAddRow = {
  id: number;
  sku: string;
  name: string;
  brand: string;
  category: string;
  barcode: string;
  supplierId: string;
  countryOfOrigin: string;
  description: string;
  buyUom: string;
  uom: string;
  unitsPerBuyUom: string;
  sellMode: BulkAddSellMode;
  costPrice: string;
  sellingPrice: string;
  packSellingPrice: string;
  discountPercent: string;
  offeredPrice: string;
  packDiscountPercent: string;
  packOfferedPrice: string;
  lowStockThreshold: string;
  status: ProductStatus;
  tags: string;
  nutritionInfo: string;
  allergenInfo: string;
  images: string;
};

export type BulkAddField = Exclude<keyof BulkAddRow, 'id'>;

export type BulkAddFieldErrors = Partial<Record<BulkAddField, string>>;

export type BulkAddValidationMap = Record<number, BulkAddFieldErrors>;

export const DEFAULT_LOW_STOCK = '10';

export type BulkAddExistingLookup = {
  names: Set<string>;
  skus: Set<string>;
};

/** Intentional content: name or SKU only (ignore UOM/price defaults). */
export function isPopulatedBulkAddRow(row: BulkAddRow): boolean {
  return Boolean(row.name.trim() || row.sku.trim());
}

function parseNonNeg(
  value: string,
  label: string,
  errors: BulkAddFieldErrors,
  field: BulkAddField,
): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    errors[field] = `${label} must be ≥ 0`;
    return 0;
  }
  return n;
}

function normKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Validate a populated Bulk Add row; returns field-level errors. */
export function validateBulkAddRow(row: BulkAddRow): BulkAddFieldErrors {
  const errors: BulkAddFieldErrors = {};

  if (!row.name.trim()) {
    errors.name = 'Name is required';
  }

  if (!row.buyUom.trim()) {
    errors.buyUom = 'Primary Unit is required';
  }

  const units = Number(row.unitsPerBuyUom);
  if (!Number.isFinite(units) || units < 1 || !Number.isInteger(units)) {
    errors.unitsPerBuyUom = 'Must be an integer ≥ 1';
  }

  if (units > 1 && !row.uom.trim()) {
    errors.uom = 'Secondary Unit is required when conversion is used';
  }

  parseNonNeg(row.costPrice, 'Unit cost', errors, 'costPrice');
  parseNonNeg(row.sellingPrice, 'Unit price', errors, 'sellingPrice');
  parseNonNeg(row.packSellingPrice, 'Pack price', errors, 'packSellingPrice');
  parseNonNeg(row.offeredPrice, 'Offered price', errors, 'offeredPrice');
  parseNonNeg(row.packOfferedPrice, 'Pack offered price', errors, 'packOfferedPrice');

  if (row.discountPercent.trim()) {
    const disc = Number(row.discountPercent);
    if (!Number.isFinite(disc) || disc < 0 || disc > 100) {
      errors.discountPercent = 'Must be 0–100';
    }
  }
  if (row.packDiscountPercent.trim()) {
    const packDisc = Number(row.packDiscountPercent);
    if (!Number.isFinite(packDisc) || packDisc < 0 || packDisc > 100) {
      errors.packDiscountPercent = 'Must be 0–100';
    }
  }

  if (row.lowStockThreshold.trim()) {
    const low = Number(row.lowStockThreshold);
    if (!Number.isFinite(low) || low < 0 || !Number.isInteger(low)) {
      errors.lowStockThreshold = 'Must be an integer ≥ 0';
    }
  }

  const packSellEnabled =
    (row.sellMode === 'unit' || row.sellMode === 'both')
    && Number.isFinite(units)
    && units > 1;
  if (packSellEnabled && Number(row.packSellingPrice || 0) <= 0) {
    errors.packSellingPrice = 'Pack price is required when selling whole packs/boxes';
  }

  if (!row.sku.trim() && !row.category.trim()) {
    errors.category = 'Category is required to generate SKU';
    if (!errors.sku) errors.sku = 'Enter a SKU or select a category';
  }

  return errors;
}

function mergeError(
  map: BulkAddValidationMap,
  rowId: number,
  field: BulkAddField,
  message: string,
) {
  const current = map[rowId] ?? {};
  if (!current[field]) {
    map[rowId] = { ...current, [field]: message };
  }
}

export function validateBulkAddRows(
  rows: BulkAddRow[],
  existing?: BulkAddExistingLookup,
): BulkAddValidationMap {
  const result: BulkAddValidationMap = {};
  const populated = rows.filter(isPopulatedBulkAddRow);

  for (const row of populated) {
    const errors = validateBulkAddRow(row);
    if (Object.keys(errors).length > 0) {
      result[row.id] = errors;
    }
  }

  // Duplicate names / SKUs within the grid
  const nameCounts = new Map<string, number[]>();
  const skuCounts = new Map<string, number[]>();
  for (const row of populated) {
    const nameKey = normKey(row.name);
    if (nameKey) {
      const list = nameCounts.get(nameKey) ?? [];
      list.push(row.id);
      nameCounts.set(nameKey, list);
    }
    const skuKey = normKey(row.sku);
    if (skuKey) {
      const list = skuCounts.get(skuKey) ?? [];
      list.push(row.id);
      skuCounts.set(skuKey, list);
    }
  }
  for (const ids of nameCounts.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      mergeError(result, id, 'name', 'Duplicate product name in this grid');
    }
  }
  for (const ids of skuCounts.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      mergeError(result, id, 'sku', 'Duplicate SKU in this grid');
    }
  }

  // Existing catalog name / SKU
  if (existing) {
    for (const row of populated) {
      const nameKey = normKey(row.name);
      if (nameKey && existing.names.has(nameKey)) {
        mergeError(result, row.id, 'name', 'A product with this name already exists');
      }
      const skuKey = normKey(row.sku);
      if (skuKey && existing.skus.has(skuKey)) {
        mergeError(result, row.id, 'sku', 'SKU already exists');
      }
    }
  }

  return result;
}

export function countBulkAddErrors(map: BulkAddValidationMap): number {
  return Object.values(map).reduce((sum, errs) => sum + Object.keys(errs).length, 0);
}

export function emptyBulkAddRow(
  id: number,
  primaryUom = '',
  defaults?: {
    supplierId?: string;
    lowStockThreshold?: string;
  },
): BulkAddRow {
  return {
    id,
    sku: '',
    name: '',
    brand: '',
    category: '',
    barcode: '',
    supplierId: defaults?.supplierId ?? '',
    countryOfOrigin: '',
    description: '',
    buyUom: primaryUom,
    uom: '', // Secondary stays empty until conversion is used
    unitsPerBuyUom: '1',
    sellMode: 'both',
    costPrice: '',
    sellingPrice: '',
    packSellingPrice: '',
    discountPercent: '',
    offeredPrice: '',
    packDiscountPercent: '',
    packOfferedPrice: '',
    lowStockThreshold: defaults?.lowStockThreshold ?? DEFAULT_LOW_STOCK,
    status: 'active',
    tags: '',
    nutritionInfo: '',
    allergenInfo: '',
    images: '',
  };
}
