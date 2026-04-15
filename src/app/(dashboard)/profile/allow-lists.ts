/**
 * Allow-lists for user-settings string enums. Lifted out of actions.ts so
 * db-parity.test.ts can import them without dragging in "server-only".
 *
 * Every set here maps to a CHECK constraint in a Supabase migration.
 * Adding a value requires a migration in the same PR — enforced by
 * src/__tests__/db-parity.test.ts.
 */

export const ALLOWED_THEMES = new Set([
  "system",
  "light",
  "dark",
  "high-contrast",
  "warm",
]);
export const ALLOWED_LOCALES = new Set(["en", "es"]);
export const ALLOWED_WEEK_STARTS = new Set(["monday", "sunday"]);
export const ALLOWED_TEXT_SIZES = new Set(["compact", "regular", "large"]);
export const ALLOWED_TIME_FORMATS = new Set(["12h", "24h"]);
