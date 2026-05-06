/**
 * Allow-lists for projects.* enum-shaped columns. Mirrored by CHECK
 * constraints in the migrations; parity is enforced by
 * `src/__tests__/db-parity.test.ts`.
 *
 * Adding a value here without widening the CHECK in a migration in
 * the same PR will trip the parity test. Adding a CHECK value
 * without widening this set will let the app reject something the
 * DB would accept.
 */

/**
 * Allow-list for `projects.budget_period`. Added 2026-05-06 as part
 * of the recurring-budget expansion. NULL is also a valid state
 * (project has no recurring cap) — handled at the CHECK level via
 * `IS NULL OR budget_period IN (...)`.
 */
export const ALLOWED_BUDGET_PERIODS = new Set([
  "weekly",
  "monthly",
  "quarterly",
]);

/**
 * Allow-list for `projects.budget_carryover`. Default is `'none'`
 * (use it or lose it) and v1 implements only `'none'` behavior. The
 * other values exist to make the eventual rollover/pool support a
 * non-destructive migration when (if) a real customer asks for them.
 */
export const ALLOWED_BUDGET_CARRYOVER = new Set([
  "none",
  "within_quarter",
  "lifetime",
]);
