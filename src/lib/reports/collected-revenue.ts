/**
 * Cash-basis collected revenue (2026-07-18 decision — the "proper feature"
 * companion to the Time-Based Revenue relabel).
 *
 * Sums RECORDED PAYMENTS (`invoice_payments.paid_on` inside the period),
 * not invoice issuance — cash basis per the money-UI principles. Currencies
 * are NEVER summed across: the result is one bucket per currency, each with
 * its own by-client rollup, so a CAD retainer can't silently inflate a USD
 * total.
 */

export interface CollectedPaymentRow {
  amount: number;
  currency: string;
  /** Customer display name resolved by the caller ("—" when unknown). */
  customerName: string;
}

export interface CollectedCurrencyBucket {
  currency: string;
  total: number;
  paymentCount: number;
  byClient: Array<{ customerName: string; total: number }>;
}

export function summarizeCollectedPayments(
  rows: CollectedPaymentRow[],
): CollectedCurrencyBucket[] {
  const byCurrency = new Map<
    string,
    { total: number; paymentCount: number; byClient: Map<string, number> }
  >();
  for (const row of rows) {
    const currency = (row.currency || "USD").toUpperCase();
    let bucket = byCurrency.get(currency);
    if (!bucket) {
      bucket = { total: 0, paymentCount: 0, byClient: new Map() };
      byCurrency.set(currency, bucket);
    }
    bucket.total += row.amount;
    bucket.paymentCount += 1;
    bucket.byClient.set(
      row.customerName,
      (bucket.byClient.get(row.customerName) ?? 0) + row.amount,
    );
  }
  const round = (n: number): number => Math.round(n * 100) / 100;
  return Array.from(byCurrency.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, b]) => ({
      currency,
      total: round(b.total),
      paymentCount: b.paymentCount,
      byClient: Array.from(b.byClient.entries())
        .map(([customerName, total]) => ({ customerName, total: round(total) }))
        .sort((x, y) => y.total - x.total),
    }));
}
