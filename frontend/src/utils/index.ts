import { CURRENCY_SYMBOL, UOM_OPTIONS } from '@/constants';
import type { ProductStatus, UserRole } from '@/types';
import { formatDisplayDate, type CalendarSystem } from '@/utils/nepaliDate';

export { formatDisplayDate, formatDualCalendar, adToBs, bsToAd } from '@/utils/nepaliDate';
export type { CalendarSystem } from '@/utils/nepaliDate';

export const isAdmin = (role?: UserRole): boolean => role === 'admin';
export const isAdminOrManager = (role?: UserRole): boolean => role === 'admin' || role === 'manager';
export const isCashier = (role?: UserRole): boolean => role === 'cashier';

export function canManageSuppliers(role?: UserRole): boolean {
  return isAdminOrManager(role);
}

export function canManagePurchaseOrders(role?: UserRole): boolean {
  return isAdminOrManager(role);
}

export function canViewAdminReports(role?: UserRole): boolean {
  return isAdminOrManager(role);
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
): void {
  const escape = (value: string | number) => {
    const s = String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const content = [headers.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function formatAmount(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return amount.toLocaleString('en-NP', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const sign = amount < 0 ? '−' : '';
  return `${sign}${CURRENCY_SYMBOL} ${formatAmount(Math.abs(amount))}`;
}

/** Signed ledger line, e.g. +Rs. 500 or −Rs. 200 */
export function formatSignedCurrency(amount: number | null | undefined, direction: 'in' | 'out' | string): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const sign = direction === 'in' ? '+' : direction === 'out' ? '−' : '';
  return `${sign}${CURRENCY_SYMBOL} ${formatAmount(Math.abs(amount))}`;
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  opening_cash: 'Opening cash',
  closing_cash: 'Closing cash',
  closing_bank: 'Bank closing',
  closing_esewa: 'eSewa closing',
  opening_cash_balance: 'Opening cash balance',
  opening_bank_balance: 'Opening bank balance',
  opening_esewa_balance: 'Opening eSewa balance',
  from_wallet: 'From',
  to_wallet: 'To',
  held_by_name: 'Held by',
  deposit_wallet: 'Deposit to',
  taken_date: 'Taken date',
  resolved_date: 'Resolved date',
  amount: 'Amount',
  wallet: 'Wallet',
  direction: 'Direction',
  status: 'Status',
  date: 'Date',
  remarks: 'Remarks',
};

export function formatAuditAction(action: string): string {
  const labels: Record<string, string> = {
    day_close_create: 'Day close created',
    day_close_update: 'Day close updated',
    day_close_close: 'Day closed (locked)',
    day_close_reopen: 'Day reopened',
    day_close_post_variance: 'Variance posted to ledger',
    wallet_transfer: 'Wallet transfer',
    wallet_adjustment: 'Wallet adjustment',
    cash_custody_take: 'Cash taken — staff custody',
    cash_custody_return: 'Cash returned to till',
    cash_custody_deposit: 'Cash deposited from custody',
  };
  return labels[action] ?? action.replace(/_/g, ' ');
}

export function formatAuditField(key: string, value: unknown): string {
  const label = AUDIT_FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
  if (value == null || value === '') return `${label}: —`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${label}: ${formatCurrency(value)}`;
  }
  return `${label}: ${String(value)}`;
}

export function summarizeAuditValues(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return '—';
  const preview = keys.slice(0, 4).map((k) => formatAuditField(k, data[k])).join(' · ');
  return keys.length > 4 ? `${preview} …` : preview;
}

export function uomLabel(value: string, options?: ReadonlyArray<{ value: string; label: string }>): string {
  const list = options ?? UOM_OPTIONS;
  return list.find((o) => o.value === value)?.label ?? value;
}

export function formatPricePerUom(price: number, uom: string): string {
  return `${formatCurrency(price)} / ${uom}`;
}

export function formatDate(
  date: string | Date,
  calendar: CalendarSystem = 'AD',
): string {
  return formatDisplayDate(date, calendar);
}

/** Manufacturer / batch expiry — always Gregorian (AD). */
export function formatExpiryDate(date: string | Date): string {
  return formatDisplayDate(date, 'AD');
}

/** Parse API datetimes; timezone-less ISO is treated as UTC (Mongo/Beanie naive). */
export function parseApiDateTime(date: string | Date): Date {
  if (date instanceof Date) return date;
  const raw = String(date).trim();
  // YYYY-MM-DDTHH:mm:ss(.sss)? with no Z or ±offset → assume UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) {
    return new Date(`${raw}Z`);
  }
  return new Date(raw);
}

export function formatDateTime(date: string | Date): string {
  return parseApiDateTime(date).toLocaleString('en-US', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function calculateTax(subtotal: number, taxRate: number): number {
  return Math.round(subtotal * (taxRate / 100) * 100) / 100;
}

export function calculateCartTotal(
  items: { price: number; quantity: number; discount: number }[],
  taxRate: number,
  loyaltyDiscount = 0,
): { subtotal: number; discount: number; tax: number; total: number } {
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const itemDiscount = items.reduce(
    (sum, item) => sum + item.discount * item.quantity,
    0,
  );
  const discount = itemDiscount + loyaltyDiscount;
  const taxable = subtotal - discount;
  const tax = calculateTax(taxable, taxRate);
  const total = taxable + tax;

  return { subtotal, discount, tax, total };
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function productStatusOf(status?: ProductStatus): ProductStatus {
  return status ?? 'active';
}

export function productStatusLabel(status?: ProductStatus): string {
  switch (productStatusOf(status)) {
    case 'seasonal':
      return 'Seasonal';
    case 'discontinued':
      return 'Discontinued';
    default:
      return 'Active';
  }
}

export function productStatusColor(
  status?: ProductStatus,
): 'success' | 'warning' | 'default' {
  switch (productStatusOf(status)) {
    case 'seasonal':
      return 'warning';
    case 'discontinued':
      return 'default';
    default:
      return 'success';
  }
}
