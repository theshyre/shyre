/**
 * Drift-safe display dates for the web UI.
 *
 * `new Date("2026-07-16")` parses a DATE-ONLY string as UTC midnight, so
 * `toLocaleDateString` in any negative-offset timezone renders **Jul 15** —
 * off by one for every US user. Date-only strings are calendar dates, not
 * instants: parse the parts as a LOCAL date before localizing. Timestamps
 * (anything with a time component) carry their own zone and pass through.
 *
 * The PDF layer has its own fixed-format sibling (`formatPdfDate`); this one
 * is for on-screen text and follows the viewer's locale.
 */
export function formatDisplayDate(
  iso: string | null | undefined,
  locale?: string,
): string {
  if (!iso) return "—";
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      )
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Localized date + time for timestamptz strings ("Jul 16, 2026, 2:30 PM").
 *  Timestamps carry their zone, so no date-only special-casing needed. */
export function formatDisplayDateTime(
  iso: string | null | undefined,
  locale?: string,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
