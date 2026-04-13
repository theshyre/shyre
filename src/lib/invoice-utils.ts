/**
 * Invoice calculation and number generation utilities.
 */

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface LineItemResult extends LineItemInput {
  amount: number;
}

export interface InvoiceTotals {
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export function calculateLineItemAmount(
  quantity: number,
  unitPrice: number
): number {
  return Math.round(quantity * unitPrice * 100) / 100;
}

export function calculateInvoiceTotals(
  lineItems: LineItemResult[],
  taxRate: number
): InvoiceTotals {
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const roundedSubtotal = Math.round(subtotal * 100) / 100;
  const taxAmount = Math.round(roundedSubtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((roundedSubtotal + taxAmount) * 100) / 100;

  return {
    subtotal: roundedSubtotal,
    taxRate,
    taxAmount,
    total,
  };
}

export function generateInvoiceNumber(
  prefix: string,
  nextNum: number,
  year?: number
): string {
  const y = year ?? new Date().getFullYear();
  const padded = String(nextNum).padStart(3, "0");
  return `${prefix}-${y}-${padded}`;
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}
