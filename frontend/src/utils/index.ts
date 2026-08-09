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

export function formatAmount(amount: number): string {
  return amount.toLocaleString('en-NP', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCurrency(amount: number): string {
  return `${CURRENCY_SYMBOL} ${formatAmount(amount)}`;
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

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-US', {
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
