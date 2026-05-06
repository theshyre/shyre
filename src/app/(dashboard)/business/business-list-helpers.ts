/**
 * Pure helpers for the business list page (`/business`). Extracted
 * from `page.tsx` for testability — the page is a server component
 * that hits Supabase, but the math + formatting + role aggregation
 * are deterministic and worth pinning behaviorally.
 */

export type Role = "owner" | "admin" | "member";

/** ISO 8601 (UTC) cutoff for "12 months ago from `now`." */
export function rolling12MonthCutoff(now: Date = new Date()): string {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 12);
  return cutoff.toISOString();
}

/**
 * Highest role across the viewer's memberships in a business.
 * `owner` > `admin` > `member`. Drives whether financial KPIs
 * render — a member-only viewer sees the card without the dollars.
 */
export function maxRole(roles: Role[]): Role {
  return roles.reduce<Role>((max, r) => {
    if (r === "owner") return "owner";
    if (r === "admin" && max !== "owner") return "admin";
    return max;
  }, "member");
}

/**
 * Sum amounts grouped by ISO 4217 currency code. Currency codes are
 * uppercased; a missing or null currency falls back to "USD" so
 * legacy rows from before the multi-currency migration don't get
 * orphaned into a "" bucket.
 */
export function groupByCurrency(
  rows: Array<{ amount: number | string | null; currency: string | null }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const code = (row.currency ?? "USD").toUpperCase();
    const amt = Number(row.amount ?? 0);
    out.set(code, (out.get(code) ?? 0) + amt);
  }
  return out;
}

/**
 * Decide whether Net is computable for a business. Net is only
 * meaningful when both Revenue and Expenses are in one currency
 * AND it's the same currency on both sides. Mixed-currency cards
 * surface a "see breakdown" message instead of a wrong number.
 */
export function netForBusiness(
  revenueByCurrency: Map<string, number>,
  expensesByCurrency: Map<string, number>,
): { amount: number; currency: string } | null {
  const all = new Set<string>([
    ...revenueByCurrency.keys(),
    ...expensesByCurrency.keys(),
  ]);
  if (all.size !== 1) return null;
  const currency = Array.from(all)[0]!;
  const revenue = revenueByCurrency.get(currency) ?? 0;
  const expenses = expensesByCurrency.get(currency) ?? 0;
  return { amount: revenue - expenses, currency };
}

export type NetClass = "profit" | "loss" | "breakEven";

/** Classify a Net amount with a half-cent tolerance, so float
 *  subtraction doesn't produce a `Loss · -$0.00` footgun. */
export function classifyNet(amount: number): NetClass {
  if (amount > 0.005) return "profit";
  if (amount < -0.005) return "loss";
  return "breakEven";
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

/**
 * Render an amount with an explicit leading +/− sign for non-zero
 * values. Zero (within the half-cent tolerance) renders without a
 * sign. The minus is U+2212 (mathematical minus) for visual weight.
 */
export function formatSignedCurrency(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  const formatted = formatCurrency(abs, currency);
  if (amount > 0.005) return `+${formatted}`;
  if (amount < -0.005) return `−${formatted}`;
  return formatted;
}

/** Sort a per-currency map into a stable display order (alpha by
 *  ISO code) so card-to-card comparison reads the same way. */
export function sortByCurrency(
  map: Map<string, number>,
): Array<[string, number]> {
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}
