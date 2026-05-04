/**
 * Default rotate-by date for any newly-saved API credential.
 *
 * "Today + 365 days." Used by every form that accepts a credential
 * (Vercel API token, Resend API key, GitHub PAT, Jira token) when
 * the user supplies a fresh secret without picking a date. The
 * point is to make sure the credential scanner always has
 * *something* to remind on — silent saves with no expiry are the
 * scenario this whole feature was built to prevent.
 *
 * Returns ISO `YYYY-MM-DD` (calendar-day, no time). Computed in
 * UTC so two users in different timezones who paste a key at the
 * same moment get the same default — DATE columns are tz-naive,
 * so a local-time `+1y` would drift by a day across DST changes.
 */
export function defaultExpiryYear(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
