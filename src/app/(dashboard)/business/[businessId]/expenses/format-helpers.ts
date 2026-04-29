/**
 * Pure formatting helpers used by the expenses table. Extracted
 * from `expense-row.tsx` so the locale + date-parsing logic is
 * unit-testable without rendering React.
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
