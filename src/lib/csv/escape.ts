/**
 * RFC 4180 CSV field escaping + spreadsheet formula-injection defense.
 * Generic — no Stint/time-entry knowledge — so every CSV export
 * surface in the app (time entries, invoices, customers, business
 * expenses, business history) shares one escaping implementation.
 */

/**
 * - Wrap in double quotes if the field contains a comma, quote, or newline
 * - Escape embedded quotes by doubling them
 * - Prefix a leading `=` `+` `-` `@` (and their tab/CR-prefixed variants)
 *   with a single quote: Excel/Sheets execute such cells as FORMULAS, so a
 *   customer named `=HYPERLINK(...)` in an export would run in the
 *   bookkeeper's spreadsheet (CSV-injection, SAL-048). The apostrophe is
 *   the standard "treat as text" marker and round-trips visibly rather
 *   than silently altering data.
 */
export function escapeCsvField(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (s === "") return "";
  // Numbers/booleans can't start with a formula trigger after String();
  // only guard genuine strings so exported amounts stay numeric cells.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
