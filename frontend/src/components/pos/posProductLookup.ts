import { productService } from '@/services';
import type { Product } from '@/types';
import { showWarning } from '@/utils/toast';

/** Exact barcode match first, then SKU (case-insensitive). Warns on duplicates. */
export function findExactBarcodeOrSku(list: Product[], code: string): Product | undefined {
  const key = code.trim().toLowerCase();
  if (!key) return undefined;

  const byBarcode = list.filter((p) => (p.barcode ?? '').trim().toLowerCase() === key);
  if (byBarcode.length > 0) {
    if (byBarcode.length > 1) {
      showWarning(`Multiple products share barcode ${code}; added first match.`);
    }
    return byBarcode[0];
  }

  const bySku = list.filter((p) => (p.sku ?? '').trim().toLowerCase() === key);
  if (bySku.length > 0) {
    if (bySku.length > 1) {
      showWarning(`Multiple products share SKU ${code}; added first match.`);
    }
    return bySku[0];
  }

  return undefined;
}

/**
 * Resolve a scanned/typed barcode or SKU: try in-memory candidates first,
 * then exact barcode/SKU API lookup (not substring search).
 */
export async function resolvePosProductByScan(
  code: string,
  candidates: Product[] = [],
): Promise<Product | undefined> {
  const trimmed = code.trim();
  if (!trimmed) return undefined;

  let product = findExactBarcodeOrSku(candidates, trimmed);
  if (product) return product;

  const res = await productService.getAll({
    exactCode: trimmed,
    sellableOnly: true,
    pageSize: 10,
    includeImages: false,
  });
  return findExactBarcodeOrSku(res.data, trimmed);
}
