/**
 * Shared expense formatting helpers — promoted from
 * `src/app/(dashboard)/business/[businessId]/expenses/format-helpers.ts`
 * during the phase-3 project-page restructure so cross-module
 * callers (project pages, invoice line-item description generation)
 * stop importing from inside another module's directory.
 *
 * Pure functions; no React, no Supabase. Safe to import from both
 * server and client code.
 */

/** Render a YYYY-MM-DD date as "Dec 16, 2019" — short enough to fit
 *  a narrow column without wrapping, more readable than the raw
 *  ISO. Returns the input verbatim on parse failure (defensive: a
 *  malformed date should still display something instead of
 *  throwing in a render path). */
export function formatExpenseDateDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  if (!y || !mo || !d) return iso;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  // Defensive validity check so a string like "2019-13-45" doesn't
  // produce a wrapped-around date silently.
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return iso;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Format a numeric amount in the row's currency for display. Uses
 *  Intl.NumberFormat so currency symbols and digit grouping match
 *  the user's locale. Falls back to "{currency} {amount}" when
 *  Intl rejects the currency code (a malformed CSV import). */
export function formatExpenseAmount(
  amount: number,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Human-readable label for an expense category slug — for
 *  customer-facing surfaces where i18n lookup isn't available
 *  (server-side line-item description generation). The slug
 *  "professional_services" becomes "Professional services" — title
 *  case on the first word, the rest stays lowercased so
 *  "Software" reads natural alongside "Professional services". */
export function humanizeExpenseCategory(slug: string): string {
  const spaced = slug.replace(/_/g, " ");
  if (spaced.length === 0) return spaced;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
