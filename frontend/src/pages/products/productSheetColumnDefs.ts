import type { Product, ProductStatus } from '@/types';
import { PRODUCT_FIELD_LABELS } from '@/constants/productFieldLabels';
import {
  buyUnitCost,
  packCost,
  computeProductPricing,
} from '@/utils/productPricing';
import { productStatusLabel } from '@/utils';

export type SheetColumnType = 'text' | 'number' | 'select' | 'computed' | 'multiline';

export interface ProductSheetColumnDef {
  key: string;
  label: string;
  editable: boolean;
  align?: 'left' | 'right';
  poPaste?: boolean;
  type: SheetColumnType;
  sortKey?: 'sku' | 'name';
  width: number;
  /** Product field key for editable columns */
  field?: keyof Product | 'packQty' | 'poUnitCost' | 'packCost';
}

/** Fixed PO clipboard column count (sku, name, qty, buyUom, units, cost). */
export const PO_PASTE_COLUMN_COUNT = 6;

/** @deprecated Prefer isPoPasteColumn(index); kept for re-exports. */
export const PO_COLUMN_END_INDEX = -1;
/** @deprecated Extra-column divider removed after Bulk Add column parity. */
export const EXTRA_COLUMN_START_INDEX = -1;

/**
 * Bulk Edit columns — shared fields match Bulk Add order;
 * sheet-only computed columns tucked beside related fields.
 */
export const PRODUCT_SHEET_COLUMNS: ProductSheetColumnDef[] = [
  // Identity (Bulk Add parity)
  { key: 'name', label: PRODUCT_FIELD_LABELS.name, editable: true, poPaste: true, type: 'text', sortKey: 'name', width: 180, field: 'name' },
  { key: 'sku', label: PRODUCT_FIELD_LABELS.sku, editable: false, poPaste: true, type: 'text', sortKey: 'sku', width: 110, field: 'sku' },
  { key: 'brand', label: PRODUCT_FIELD_LABELS.brand, editable: true, type: 'text', width: 90, field: 'brand' },
  { key: 'category', label: PRODUCT_FIELD_LABELS.category, editable: true, type: 'select', width: 100, field: 'category' },
  { key: 'barcode', label: PRODUCT_FIELD_LABELS.barcode, editable: true, type: 'text', width: 100, field: 'barcode' },
  { key: 'supplier', label: PRODUCT_FIELD_LABELS.supplier, editable: true, type: 'select', width: 120, field: 'supplierId' },
  { key: 'country', label: PRODUCT_FIELD_LABELS.country, editable: true, type: 'select', width: 100, field: 'countryOfOrigin' },
  { key: 'description', label: PRODUCT_FIELD_LABELS.description, editable: true, type: 'multiline', width: 140, field: 'description' },
  // UOM / sell
  { key: 'buyUom', label: PRODUCT_FIELD_LABELS.buyUom, editable: true, poPaste: true, type: 'select', width: 72, field: 'buyUom' },
  { key: 'baseUom', label: PRODUCT_FIELD_LABELS.baseUom, editable: true, type: 'select', width: 72, field: 'uom' },
  { key: 'unitsPerPack', label: PRODUCT_FIELD_LABELS.unitsPerPack, editable: true, poPaste: true, align: 'right', type: 'number', width: 80, field: 'unitsPerBuyUom' },
  { key: 'packQty', label: PRODUCT_FIELD_LABELS.packQty, editable: false, poPaste: true, align: 'right', type: 'computed', width: 64, field: 'packQty' },
  { key: 'sellMode', label: PRODUCT_FIELD_LABELS.sellMode, editable: true, type: 'select', width: 88, field: 'sellMode' },
  // Pricing
  { key: 'unitCost', label: PRODUCT_FIELD_LABELS.unitCost, editable: true, align: 'right', type: 'number', width: 80, field: 'costPrice' },
  { key: 'poUnitCost', label: PRODUCT_FIELD_LABELS.poUnitCost, editable: false, poPaste: true, align: 'right', type: 'computed', width: 88, field: 'poUnitCost' },
  { key: 'packCost', label: PRODUCT_FIELD_LABELS.packCost, editable: false, align: 'right', type: 'computed', width: 80, field: 'packCost' },
  { key: 'unitPrice', label: PRODUCT_FIELD_LABELS.unitPrice, editable: true, align: 'right', type: 'number', width: 80, field: 'sellingPrice' },
  { key: 'packPrice', label: PRODUCT_FIELD_LABELS.packPrice, editable: true, align: 'right', type: 'number', width: 80, field: 'packSellingPrice' },
  { key: 'margin', label: PRODUCT_FIELD_LABELS.marginPercent, editable: false, align: 'right', type: 'computed', width: 72, field: 'marginPercent' },
  { key: 'packSavings', label: PRODUCT_FIELD_LABELS.packSavings, editable: false, align: 'right', type: 'computed', width: 88, field: 'discountedAmount' },
  // Offers
  { key: 'discount', label: PRODUCT_FIELD_LABELS.discountPercent, editable: true, align: 'right', type: 'number', width: 80, field: 'discountPercent' },
  { key: 'offered', label: PRODUCT_FIELD_LABELS.offeredPrice, editable: true, align: 'right', type: 'number', width: 88, field: 'offeredPrice' },
  { key: 'packDiscount', label: PRODUCT_FIELD_LABELS.packDiscountPercent, editable: true, align: 'right', type: 'number', width: 96, field: 'packDiscountPercent' },
  { key: 'packOffered', label: PRODUCT_FIELD_LABELS.packOfferedPrice, editable: true, align: 'right', type: 'number', width: 96, field: 'packOfferedPrice' },
  // Ops / meta
  { key: 'lowStock', label: PRODUCT_FIELD_LABELS.lowStock, editable: true, align: 'right', type: 'number', width: 72, field: 'lowStockThreshold' },
  { key: 'status', label: PRODUCT_FIELD_LABELS.status, editable: true, type: 'select', width: 88, field: 'status' },
  { key: 'tags', label: PRODUCT_FIELD_LABELS.tags, editable: true, type: 'text', width: 100, field: 'tags' },
  { key: 'nutrition', label: PRODUCT_FIELD_LABELS.nutrition, editable: true, type: 'multiline', width: 100, field: 'nutritionInfo' },
  { key: 'allergens', label: PRODUCT_FIELD_LABELS.allergens, editable: true, type: 'multiline', width: 100, field: 'allergenInfo' },
  { key: 'images', label: PRODUCT_FIELD_LABELS.images, editable: true, type: 'text', width: 100, field: 'images' },
  { key: 'stock', label: PRODUCT_FIELD_LABELS.stock, editable: false, align: 'right', type: 'computed', width: 64, field: 'stock' },
];

export const PRODUCT_SHEET_HEADERS = PRODUCT_SHEET_COLUMNS.map((c) => c.label);

/** Headers for PO clipboard TSV — fixed order matching productToPoPasteCells. */
export const PO_PASTE_HEADERS = [
  PRODUCT_FIELD_LABELS.sku,
  PRODUCT_FIELD_LABELS.name,
  PRODUCT_FIELD_LABELS.packQty,
  PRODUCT_FIELD_LABELS.buyUom,
  PRODUCT_FIELD_LABELS.unitsPerPack,
  PRODUCT_FIELD_LABELS.poUnitCost,
] as const;

const RIGHT_ALIGNED_KEYS = new Set(
  PRODUCT_SHEET_COLUMNS.filter((c) => c.align === 'right').map((c) => c.key),
);

export const SHEET_CHECKBOX_COL_WIDTH = 40;
export const SHEET_SN_COL_WIDTH = 44;

export function productSheetColWidths(): number[] {
  return [
    SHEET_CHECKBOX_COL_WIDTH,
    SHEET_SN_COL_WIDTH,
    ...PRODUCT_SHEET_COLUMNS.map((c) => c.width),
  ];
}

export function productSheetTableMinWidth(): number {
  return productSheetColWidths().reduce((sum, w) => sum + w, 0);
}

export function isPoPasteColumn(index: number): boolean {
  return Boolean(PRODUCT_SHEET_COLUMNS[index]?.poPaste);
}

export function isSheetColumnRightAligned(index: number): boolean {
  const col = PRODUCT_SHEET_COLUMNS[index];
  return col ? RIGHT_ALIGNED_KEYS.has(col.key) : false;
}

function formatNum(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

export function getSheetCellValue(product: Product, col: ProductSheetColumnDef): string {
  switch (col.key) {
    case 'packQty':
      return '1';
    case 'poUnitCost':
      return formatNum(buyUnitCost(product));
    case 'packCost':
      return formatNum(packCost(product.costPrice ?? 0, product.unitsPerBuyUom ?? 1));
    case 'margin':
      return formatNum(product.marginPercent ?? 0);
    case 'packSavings':
      return formatNum(product.discountedAmount ?? 0);
    case 'tags':
      return (product.tags ?? []).join(', ');
    case 'images':
      return (product.images ?? []).join(', ');
    case 'status':
      return productStatusLabel(product.status as ProductStatus | undefined);
    case 'supplier':
      return product.supplierName ?? '';
    default: {
      const field = col.field;
      if (!field || field === 'packQty' || field === 'poUnitCost' || field === 'packCost') return '';
      const raw = product[field as keyof Product];
      if (raw == null) return '';
      if (Array.isArray(raw)) return raw.join(', ');
      return String(raw);
    }
  }
}

export function productToSheetCells(product: Product): string[] {
  return PRODUCT_SHEET_COLUMNS.map((col) => getSheetCellValue(product, col));
}

/** Recompute derived pricing fields after a draft edit. */
export function applyDraftPricing(
  product: Product,
  draft: Partial<Product>,
  changedField?: keyof Product,
): Partial<Product> {
  const merged = { ...product, ...draft };
  const unitSource = changedField === 'offeredPrice'
    ? 'offered' as const
    : changedField === 'discountPercent'
      ? 'percent' as const
      : 'auto' as const;
  const packSource = changedField === 'packOfferedPrice'
    ? 'offered' as const
    : changedField === 'packDiscountPercent'
      ? 'percent' as const
      : 'auto' as const;

  const pricing = computeProductPricing(
    {
      costPrice: merged.costPrice ?? 0,
      sellingPrice: merged.sellingPrice ?? 0,
      packSellingPrice: merged.packSellingPrice ?? 0,
      unitsPerBuyUom: merged.unitsPerBuyUom ?? 1,
      discountPercent: merged.discountPercent ?? 0,
      offeredPrice: merged.offeredPrice ?? 0,
      packDiscountPercent: merged.packDiscountPercent ?? 0,
      packOfferedPrice: merged.packOfferedPrice ?? 0,
    },
    { unitDiscountSource: unitSource, packDiscountSource: packSource },
  );

  return {
    ...draft,
    marginPercent: pricing.marginPercent,
    discountedAmount: pricing.discountedAmount,
    discountPercent: pricing.discountPercent,
    offeredPrice: pricing.offeredPrice,
    packDiscountPercent: pricing.packDiscountPercent,
    packOfferedPrice: pricing.packOfferedPrice,
  };
}
