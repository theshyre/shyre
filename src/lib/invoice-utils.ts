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
  /** Resolved discount in dollars after rate × subtotal computation
   *  (when caller passed a rate) or the explicit amount the caller
   *  supplied. Capped at `subtotal` so `total` can never go negative. */
  discountAmount: number;
  /** Percentage 0-100 when the caller specified a discount as a
   *  rate; otherwise null (flat-amount entry). Display-only. */
  discountRate: number | null;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export interface DiscountInput {
  /** Dollars; takes priority when both `amount` and `rate` are set. */
  amount?: number;
  /** Percentage (0-100); converted to a dollar amount via subtotal. */
  rate?: number;
}

export function calculateLineItemAmount(
  quantity: number,
  unitPrice: number
): number {
  return Math.round(quantity * unitPrice * 100) / 100;
}

/**
 * Calculate invoice totals with optional discount.
 *
 * Tax applies AFTER discount (US small-business norm; matches QBO +
 * Harvest). A single per-invoice tax_applies_before_discount toggle
 * is a future addition for jurisdictions that invert (some EU VAT,
 * some manufacturer-coupon rules) — out of scope here.
 *
 * Discount source-of-truth: caller supplies either an explicit
 * `amount` (preferred when known) or a `rate` (percentage); we
 * compute the missing one. Returned `discountAmount` is the dollar
 * value reconciliation uses; `discountRate` is the rate the user
 * typed (or null if they typed an amount). Discount is clamped at
 * `[0, subtotal]` so total can't go negative — a negative invoice
 * is a credit memo, a different document.
 */
export function calculateInvoiceTotals(
  lineItems: LineItemResult[],
  taxRate: number,
  discount: DiscountInput = {},
): InvoiceTotals {
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const roundedSubtotal = Math.round(subtotal * 100) / 100;

  // Resolve discount. Explicit amount wins; otherwise rate × subtotal.
  // Clamp to [0, subtotal] so a stale rate or hand-entered amount
  // can't push the total negative.
  let discountAmount = 0;
  let discountRate: number | null = null;
  if (typeof discount.amount === "number" && discount.amount > 0) {
    discountAmount = discount.amount;
  } else if (typeof discount.rate === "number" && discount.rate > 0) {
    discountRate = discount.rate;
    discountAmount =
      Math.round(roundedSubtotal * (discount.rate / 100) * 100) / 100;
  }
  if (discountAmount > roundedSubtotal) discountAmount = roundedSubtotal;
  if (discountAmount < 0) discountAmount = 0;
  discountAmount = Math.round(discountAmount * 100) / 100;

  const taxableBase = Math.round((roundedSubtotal - discountAmount) * 100) / 100;
  const taxAmount = Math.round(taxableBase * (taxRate / 100) * 100) / 100;
  const total = Math.round((taxableBase + taxAmount) * 100) / 100;

  return {
    subtotal: roundedSubtotal,
    discountAmount,
    discountRate,
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
