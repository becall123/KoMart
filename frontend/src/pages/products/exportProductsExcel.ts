import * as XLSX from 'xlsx';
import type { Product } from '@/types';
import {
  BULK_ADD_IMPORT_HEADERS,
  productToBulkAddExportCells,
} from '@/pages/products/bulkAddExcel';

/** Export products using the Bulk Add column contract (round-trip with Import Excel). */
export function exportProductsToExcel(products: Product[]): void {
  const headers = BULK_ADD_IMPORT_HEADERS.map((h) => h.label);
  const rows = products.map((p) => productToBulkAddExportCells(p));

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bulk Add');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `komart-products-${date}.xlsx`);
}
