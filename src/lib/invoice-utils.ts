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

/**
 * Format a money amount with the appropriate currency symbol/code.
 * Uses Intl.NumberFormat under the hood — accepts any ISO 4217 code
 * the runtime knows; unknown codes fall back to a `<code> N.NN`
 * shape so we never throw on bad data. Defaults to USD for legacy
 * call sites that haven't been threaded with a currency yet.
 */
export function formatCurrency(amount: number, currency: string = "USD"): string {
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}
