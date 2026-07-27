import { productStatusLabel } from '@/utils';
import type { Product } from '@/types';
import {
  PO_PASTE_COLUMN_COUNT,
  PO_PASTE_HEADERS,
  PRODUCT_SHEET_COLUMNS,
  productToSheetCells,
} from '@/pages/products/productSheetColumnDefs';
import { buyUnitCost } from '@/utils/productPricing';

export const PRODUCT_SHEET_HEADERS = PRODUCT_SHEET_COLUMNS.map((c) => c.label);

export { PO_PASTE_COLUMN_COUNT, PO_PASTE_HEADERS };

export { buyUnitCost };

function formatCost(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

/** PO paste rows — fixed 6-cell layout for PO line grid. */
export function productToPoPasteCells(product: Product): string[] {
  return [
    product.sku ?? '',
    product.name,
    '1',
    product.buyUom ?? product.uom ?? '',
    String(product.unitsPerBuyUom ?? 1),
    formatCost(buyUnitCost(product)),
  ];
}

function escapeTsvCell(value: string): string {
  if (/[\t\n\r"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function productsToTsv(
  products: Product[],
  options: { includeHeader?: boolean } = {},
): string {
  const { includeHeader = true } = options;
  const lines: string[] = [];
  if (includeHeader) {
    lines.push([...PO_PASTE_HEADERS].join('\t'));
  }
  for (const product of products) {
    lines.push(productToPoPasteCells(product).map(escapeTsvCell).join('\t'));
  }
  return lines.join('\n');
}

export function partitionCopyableProducts(products: Product[]): {
  copyable: Product[];
  skipped: number;
} {
  const copyable = products.filter((p) => (p.sku ?? '').trim().length > 0);
  return { copyable, skipped: products.length - copyable.length };
}

export async function copyProductsToClipboard(
  products: Product[],
): Promise<{ copied: number; skipped: number }> {
  const { copyable, skipped } = partitionCopyableProducts(products);
  if (copyable.length === 0) {
    throw new Error('No products with a SKU to copy');
  }
  const tsv = productsToTsv(copyable, { includeHeader: true });
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard is not available in this browser');
  }
  await navigator.clipboard.writeText(tsv);
  return { copied: copyable.length, skipped };
}

export { productToSheetCells, productStatusLabel };
