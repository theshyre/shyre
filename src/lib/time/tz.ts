/**
 * Timezone-aware helpers.
 *
 * The server runs in UTC but users expect all dates in THEIR local TZ.
 * We carry the client's offset (minutes WEST of UTC, per JS convention —
 * same as `new Date().getTimezoneOffset()`) in the `tz_offset` cookie.
 *
 * Dates flow through the UI as plain local-date strings (YYYY-MM-DD).
 * They only become UTC timestamps when hitting the DB, and that conversion
 * always goes through these helpers with the user's offset.
 */

const COOKIE_NAME = "tz_offset";

/**
 * Parse a cookie-stored tz offset. Defaults to 0 (UTC) when missing/bad.
 */
export function parseTzOffset(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  // Sanity: valid offsets are roughly -720..+840 minutes
  if (n < -840 || n > 840) return 0;
  return n;
}

export const TZ_COOKIE_NAME = COOKIE_NAME;

/**
 * Local-date string (YYYY-MM-DD) of the current moment in a given TZ.
 */
export function getLocalToday(tzOffsetMin: number, nowMs: number = Date.now()): string {
  // Subtract the offset to get "what the user's wall clock reads, expressed
  // as if it were UTC." Then pull year/month/day from that shifted Date.
  const shifted = new Date(nowMs - tzOffsetMin * 60 * 1000);
  return fmtYmdUtc(shifted);
}

/**
 * Local-date string for the Monday of the week containing the given local date.
 */
export function getLocalWeekStart(dateStr: string): string {
  const d = parseLocalDateUtc(dateStr);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return fmtYmdUtc(d);
}

/**
 * Local-date string N days after the given local date.
 */
export function addLocalDays(dateStr: string, days: number): string {
  const d = parseLocalDateUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtYmdUtc(d);
}

/**
 * Convert a local-date string to the UTC timestamp representing that date's
 * midnight in the given timezone.
 *
 *   localDateMidnightUtc("2026-04-13", 420)  // PDT (UTC-7, offset 420)
 *     → 2026-04-13T07:00:00.000Z
 */
export function localDateMidnightUtc(dateStr: string, tzOffsetMin: number): Date {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) throw new Error(`Invalid local date: ${dateStr}`);
  const utc = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return new Date(utc + tzOffsetMin * 60 * 1000);
}

/**
 * Convert a UTC timestamp to its local-date string in the user's TZ.
 */
export function utcToLocalDateStr(
  iso: string | Date,
  tzOffsetMin: number,
): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const shifted = new Date(d.getTime() - tzOffsetMin * 60 * 1000);
  return fmtYmdUtc(shifted);
}

/**
 * Validate a YYYY-MM-DD string. Returns the string if valid, null otherwise.
 */
export function validateLocalDateStr(s: string | undefined): string | null {
  if (!s) return null;
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Round-trip through Date to catch e.g. Feb 30
  const test = new Date(Date.UTC(y, m - 1, d));
  if (
    test.getUTCFullYear() !== y ||
    test.getUTCMonth() !== m - 1 ||
    test.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

// ---------- helpers ----------

function parseLocalDateUtc(dateStr: string): Date {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) throw new Error(`Invalid local date: ${dateStr}`);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function fmtYmdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
