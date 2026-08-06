import * as XLSX from 'xlsx';

export type BackfillField =
  | 'saleDate'
  | 'transactionNo'
  | 'sku'
  | 'barcode'
  | 'quantity'
  | 'unitPrice'
  | 'discountAmount'
  | 'paymentMethod'
  | 'customerPhone'
  | 'customerName'
  | 'notes';

export interface BackfillPreviewRow {
  key: string;
  row: number;
  saleDate: string;
  transactionNo: string;
  sku: string;
  barcode: string;
  productName: string;
  quantity: number;
  unitPrice: number | null;
  discountAmount: number;
  paymentMethod: string;
  customerPhone: string;
  customerName: string;
  notes: string;
  /** Set after catalog lookup — true if SKU/barcode not found */
  productMissing?: boolean;
  /** True when unitPrice was filled from catalog (Excel blank) */
  priceFromCatalog?: boolean;
}

export type BackfillFieldErrorKey =
  | 'saleDate'
  | 'transactionNo'
  | 'sku'
  | 'barcode'
  | 'quantity'
  | 'paymentMethod'
  | 'productName';

export type BackfillFieldErrors = Partial<Record<BackfillFieldErrorKey, string>>;
export type BackfillRowErrors = Record<string, BackfillFieldErrors>;

const PAYMENT_ALIASES: Record<string, string> = {
  cash: 'cash',
  bank: 'bank',
  esewa: 'esewa',
  'e-sewa': 'esewa',
  eseva: 'esewa',
  khalti: 'esewa',
  card: 'bank',
};

export function normalizePaymentMethod(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  return PAYMENT_ALIASES[key] ?? null;
}

export const BACKFILL_IMPORT_HEADERS: { field: BackfillField; label: string }[] = [
  { field: 'saleDate', label: 'Sale Date' },
  { field: 'transactionNo', label: 'Transaction No' },
  { field: 'sku', label: 'SKU' },
  { field: 'barcode', label: 'Barcode' },
  { field: 'quantity', label: 'Quantity' },
  { field: 'unitPrice', label: 'Unit Price' },
  { field: 'discountAmount', label: 'Discount Amount' },
  { field: 'paymentMethod', label: 'Payment Method' },
  { field: 'customerPhone', label: 'Customer Phone' },
  { field: 'customerName', label: 'Customer Name' },
  { field: 'notes', label: 'Notes' },
];

const HEADER_ALIASES: Record<string, BackfillField> = {
  'sale date': 'saleDate',
  saledate: 'saleDate',
  date: 'saleDate',
  'transaction no': 'transactionNo',
  'transaction no.': 'transactionNo',
  'transaction number': 'transactionNo',
  transactionno: 'transactionNo',
  txn: 'transactionNo',
  'txn no': 'transactionNo',
  sku: 'sku',
  barcode: 'barcode',
  quantity: 'quantity',
  qty: 'quantity',
  'unit price': 'unitPrice',
  unitprice: 'unitPrice',
  price: 'unitPrice',
  'discount amount': 'discountAmount',
  discount: 'discountAmount',
  'discount amount (npr)': 'discountAmount',
  'payment method': 'paymentMethod',
  payment: 'paymentMethod',
  'customer phone': 'customerPhone',
  phone: 'customerPhone',
  'customer name': 'customerName',
  customer: 'customerName',
  notes: 'notes',
  note: 'notes',
};

function normHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cellStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Excel serial date or string → YYYY-MM-DD */
function parseSaleDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const mm = String(parsed.m).padStart(2, '0');
      const dd = String(parsed.d).padStart(2, '0');
      return `${parsed.y}-${mm}-${dd}`;
    }
  }
  const raw = cellStr(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return raw;
}

export function downloadBackfillSalesSampleExcel(): void {
  const headers = BACKFILL_IMPORT_HEADERS.map((h) => h.label);
  const examples = [
    ['2026-07-01', 'BF-1001', '01-0001', '', '2', '120', '10', 'cash', '', 'Walk-In', 'Sample multi-line sale'],
    ['2026-07-01', 'BF-1001', '', '8801234567890', '1', '80', '10', 'cash', '', 'Walk-In', ''],
    ['2026-07-02', 'BF-1002', '02-0005', '', '3', '50', '0', 'esewa', '9800000000', 'Sample Customer', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Backfill Sales');
  XLSX.writeFile(wb, 'komart-backfill-sales-sample.xlsx');
}

export function parseBackfillSalesExcel(file: ArrayBuffer): BackfillPreviewRow[] {
  const wb = XLSX.read(file, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];

  if (!matrix.length) return [];

  const headerRow = (matrix[0] ?? []).map((c) => normHeader(cellStr(c)));
  const colMap: (BackfillField | null)[] = headerRow.map((h) => {
    const exact = BACKFILL_IMPORT_HEADERS.find((col) => normHeader(col.label) === h);
    if (exact) return exact.field;
    return HEADER_ALIASES[h] ?? null;
  });

  if (!colMap.some((f) => f === 'transactionNo') || !colMap.some((f) => f === 'saleDate')) {
    throw new Error('Excel must include Sale Date and Transaction No columns');
  }

  const rows: BackfillPreviewRow[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const raw = matrix[i] ?? [];
    const record: Partial<Record<BackfillField, unknown>> = {};
    colMap.forEach((field, idx) => {
      if (!field) return;
      record[field] = raw[idx];
    });

    const transactionNo = cellStr(record.transactionNo);
    const saleDate = parseSaleDate(record.saleDate);
    const sku = cellStr(record.sku);
    const barcode = cellStr(record.barcode);
    const quantity = parseNumber(record.quantity);
    const unitPrice = parseNumber(record.unitPrice);
    const discountAmount = parseNumber(record.discountAmount) ?? 0;
    const paymentMethod = cellStr(record.paymentMethod);

    // Skip completely empty rows
    if (!transactionNo && !saleDate && !sku && !barcode && quantity == null) continue;

    rows.push({
      key: `r-${i + 1}`,
      row: i + 1,
      saleDate,
      transactionNo,
      sku,
      barcode,
      productName: '',
      quantity: quantity != null && quantity > 0 ? Math.floor(quantity) : 0,
      unitPrice: unitPrice != null && unitPrice >= 0 ? unitPrice : null,
      discountAmount: discountAmount >= 0 ? discountAmount : 0,
      paymentMethod,
      customerPhone: cellStr(record.customerPhone),
      customerName: cellStr(record.customerName),
      notes: cellStr(record.notes),
    });
  }
  return rows;
}

export function validateBackfillRows(rows: BackfillPreviewRow[]): BackfillRowErrors {
  const errors: BackfillRowErrors = {};
  for (const r of rows) {
    const e: BackfillFieldErrors = {};
    if (!r.saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(r.saleDate)) {
      e.saleDate = 'Sale Date required (YYYY-MM-DD)';
    }
    if (!r.transactionNo.trim()) {
      e.transactionNo = 'Transaction No is required';
    }
    if (!r.sku && !r.barcode) {
      e.sku = 'SKU or Barcode required';
      e.barcode = 'SKU or Barcode required';
    }
    if (r.quantity <= 0) {
      e.quantity = 'Quantity must be > 0';
    }
    if (!normalizePaymentMethod(r.paymentMethod)) {
      e.paymentMethod = 'Use cash, bank, or esewa';
    }
    if ((r.sku || r.barcode) && r.productMissing) {
      e.productName = 'Product not found';
      if (r.sku) e.sku = e.sku || 'Unknown SKU';
      if (r.barcode) e.barcode = e.barcode || 'Unknown barcode';
    }
    if (Object.keys(e).length) errors[r.key] = e;
  }
  return errors;
}

export function countBackfillErrors(errors: BackfillRowErrors): number {
  return Object.values(errors).reduce((n, row) => n + Object.keys(row).length, 0);
}

export function lineAmount(row: BackfillPreviewRow): number {
  if (row.unitPrice == null || row.quantity <= 0) return 0;
  return round2(row.unitPrice * row.quantity);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Allocate global discount across groups by subtotal; returns map transactionNo → share. */
export function allocateGlobalDiscount(
  groups: { transactionNo: string; subtotal: number }[],
  globalDiscount: number,
): Record<string, number> {
  const totalSub = groups.reduce((s, g) => s + g.subtotal, 0);
  const global = Math.max(0, round2(globalDiscount));
  const out: Record<string, number> = {};
  if (global <= 0 || groups.length === 0) {
    groups.forEach((g) => {
      out[g.transactionNo] = 0;
    });
    return out;
  }
  // Equal split when line prices are catalog-only (preview subtotals are 0).
  if (totalSub <= 0) {
    const each = round2(global / groups.length);
    let allocated = 0;
    groups.forEach((g, idx) => {
      if (idx === groups.length - 1) {
        out[g.transactionNo] = round2(Math.max(0, global - allocated));
        return;
      }
      out[g.transactionNo] = each;
      allocated = round2(allocated + each);
    });
    return out;
  }
  let allocated = 0;
  groups.forEach((g, idx) => {
    if (idx === groups.length - 1) {
      out[g.transactionNo] = round2(Math.max(0, global - allocated));
      return;
    }
    const share = round2((global * g.subtotal) / totalSub);
    out[g.transactionNo] = share;
    allocated = round2(allocated + share);
  });
  return out;
}
