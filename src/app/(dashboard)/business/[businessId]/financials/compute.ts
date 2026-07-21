/**
 * Pure money math for the business Financials tab. Extracted from the
 * server page so every apportionment / aging rule is unit-testable. All
 * functions group PER ISO 4217 CURRENCY and never sum across currencies
 * (the app-wide rule the list card, reports, and expenses tiles all keep).
 *
 * Definitions (stated on the tab so a bookkeeper isn't misled):
 *   - Basis is HYBRID: revenue is recognized when PAID (cash), expenses
 *     when INCURRED (`incurred_on`). Not pure cash basis.
 *   - "Collected" = gross cash received (includes tax).
 *   - "Revenue" = income recognized, EX-TAX. Each payment is apportioned
 *     by its invoice's taxable-base / total ratio — sales tax is a
 *     remittable liability, never income (bookkeeper SAL lineage).
 *   - "Tax collected" = the remittable slice of collected cash.
 *   - "Expenses" = ALL operating expenses (billable included). Rebilled
 *     costs flow back as invoice income, so including them keeps Net
 *     honest and matches the Expenses tab + CSV definition.
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface PaymentSplitRow {
  amount: number | string | null;
  /** Currency of the PAYMENT row (not the invoice). */
  currency: string | null;
  invoiceSubtotal: number | string | null;
  invoiceDiscount: number | string | null;
  invoiceTaxAmount: number | string | null;
  invoiceTotal: number | string | null;
}

export interface CollectedSplit {
  /** Gross cash received (incl. tax), per currency. */
  collectedByCurrency: Map<string, number>;
  /** Income recognized (ex-tax), per currency. */
  revenueByCurrency: Map<string, number>;
  /** Remittable tax collected (liability), per currency. */
  taxByCurrency: Map<string, number>;
}

/**
 * Split recorded payments into gross Collected, ex-tax Revenue, and Tax
 * collected — apportioning each payment by its invoice's tax ratio so a
 * partial payment recognizes the right fraction of tax. Never divides by
 * zero: an invoice with a non-positive total contributes its payment as
 * pure ex-tax revenue (defensive; shouldn't occur).
 */
export function splitCollectedRevenue(
  rows: PaymentSplitRow[],
): CollectedSplit {
  const collected = new Map<string, number>();
  const revenue = new Map<string, number>();
  const tax = new Map<string, number>();

  for (const r of rows) {
    const code = (r.currency ?? "USD").toUpperCase();
    const amount = Number(r.amount ?? 0);
    const total = Number(r.invoiceTotal ?? 0);
    const subtotal = Number(r.invoiceSubtotal ?? 0);
    const discount = Number(r.invoiceDiscount ?? 0);
    const taxAmount = Number(r.invoiceTaxAmount ?? 0);

    collected.set(code, (collected.get(code) ?? 0) + amount);

    let exTax: number;
    let taxPortion: number;
    if (total > 0) {
      const taxableBase = subtotal - discount;
      exTax = amount * (taxableBase / total);
      taxPortion = amount * (taxAmount / total);
    } else {
      exTax = amount;
      taxPortion = 0;
    }
    revenue.set(code, (revenue.get(code) ?? 0) + exTax);
    tax.set(code, (tax.get(code) ?? 0) + taxPortion);
  }

  for (const m of [collected, revenue, tax]) {
    for (const [k, v] of m) m.set(k, round2(v));
  }
  return {
    collectedByCurrency: collected,
    revenueByCurrency: revenue,
    taxByCurrency: tax,
  };
}

export type AgingBucket =
  | "current"
  | "d1_30"
  | "d31_60"
  | "d61_90"
  | "d90_plus";

export const AGING_BUCKETS: AgingBucket[] = [
  "current",
  "d1_30",
  "d31_60",
  "d61_90",
  "d90_plus",
];

function emptyAging(): Record<AgingBucket, number> {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

/**
 * Aging bucket for an outstanding invoice by days past its due date.
 * A null due date (or a due date today/in the future) is "current".
 * Dates are compared at UTC midnight — the same boundary basis the rest
 * of the surface uses (documented limitation until businesses carry a
 * timezone).
 */
export function agingBucket(
  dueDate: string | null,
  today: Date,
): AgingBucket {
  if (!dueDate) return "current";
  const due = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return "current";
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const days = Math.floor((todayUtc.getTime() - due.getTime()) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export interface OutstandingRow {
  /** Invoice total minus same-currency payments already applied, >= 0. */
  amountDue: number;
  currency: string | null;
  /** YYYY-MM-DD or null. */
  dueDate: string | null;
}

export interface ArSummary {
  totalByCurrency: Map<string, number>;
  agingByCurrency: Map<string, Record<AgingBucket, number>>;
}

/**
 * Outstanding accounts receivable, per currency, with aging buckets.
 * Rows with a non-positive amount due (fully paid / overpaid) are
 * skipped. Callers net each invoice against its same-currency payments
 * before calling (mismatched-currency payments never reduce a balance).
 */
export function summarizeOutstanding(
  rows: OutstandingRow[],
  today: Date,
): ArSummary {
  const total = new Map<string, number>();
  const aging = new Map<string, Record<AgingBucket, number>>();

  for (const r of rows) {
    if (r.amountDue <= 0) continue;
    const code = (r.currency ?? "USD").toUpperCase();
    total.set(code, (total.get(code) ?? 0) + r.amountDue);
    const bucket = agingBucket(r.dueDate, today);
    const rec = aging.get(code) ?? emptyAging();
    rec[bucket] += r.amountDue;
    aging.set(code, rec);
  }

  for (const [k, v] of total) total.set(k, round2(v));
  for (const [, rec] of aging) {
    for (const b of AGING_BUCKETS) rec[b] = round2(rec[b]);
  }
  return { totalByCurrency: total, agingByCurrency: aging };
}
