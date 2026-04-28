/**
 * Pure helpers for surfacing credential-expiration warnings.
 *
 * Used by the profile page (banner above the form) and any future
 * surface that wants to remind the user a token is about to expire.
 *
 * Boundaries:
 *   - 'critical' — within 3 days (warn loudly, recommend renewal now)
 *   - 'warning'  — within 14 days
 *   - 'ok'       — more than 14 days out
 *   - 'expired'  — date is in the past
 *   - null       — user didn't enter a date (don't render anything)
 */

export type ExpiryStatus = "ok" | "warning" | "critical" | "expired";

const WARNING_DAYS = 14;
const CRITICAL_DAYS = 3;

/**
 * Days from `today` to `expiresOn`. Returns null when either input
 * is malformed. Negative when expired.
 *
 * `new Date("2026-05-13")` parses as UTC midnight, which is the
 * *previous day* in any TZ behind UTC — so a token entered with
 * "expires May 13" gets reported as expiring May 12 for a user in
 * PT. Parse YYYY-MM-DD explicitly as a local-midnight Date so the
 * pill matches what the user typed in.
 */
export function daysUntilExpiry(
  expiresOn: string | null | undefined,
  today: Date = new Date(),
): number | null {
  if (!expiresOn) return null;

  let expiry: Date;
  const ymd = expiresOn.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    expiry = new Date(y, m - 1, d);
  } else {
    // Full ISO timestamp — let Date parse as-is.
    expiry = new Date(expiresOn);
  }
  if (Number.isNaN(expiry.getTime())) return null;

  // Compare at day granularity — tokens expire end-of-day in
  // the user's local TZ, so we floor both sides to local midnight.
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const expiryMidnight = new Date(
    expiry.getFullYear(),
    expiry.getMonth(),
    expiry.getDate(),
  );
  const ms = expiryMidnight.getTime() - todayMidnight.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Categorize an expiration date. Returns null when the user hasn't
 * supplied a date — caller should render no warning in that case.
 */
export function expiryStatus(
  expiresOn: string | null | undefined,
  today: Date = new Date(),
): ExpiryStatus | null {
  const days = daysUntilExpiry(expiresOn, today);
  if (days === null) return null;
  if (days < 0) return "expired";
  if (days <= CRITICAL_DAYS) return "critical";
  if (days <= WARNING_DAYS) return "warning";
  return "ok";
}
