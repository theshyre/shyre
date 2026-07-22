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
 * Billing mode for `projects.billing_mode`. Added 2026-07-22 for fixed-bid
 * projects. A `'fixed_bid'` project tracks time for profitability but bills via
 * its proposal (a fixed price), never hourly — so its time is excluded from the
 * hourly invoice builder (mirrors `is_internal`). Default `'hourly'` covers
 * every existing + ad-hoc project. Widening this set requires widening the
 * `projects_billing_mode_chk` CHECK in the same PR.
 */
export const BILLING_MODES = ["hourly", "fixed_bid"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];
export const ALLOWED_BILLING_MODES = new Set<string>(BILLING_MODES);

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

/**
 * Lifecycle statuses for `projects.status`, in display order. Mirrors
 * the inline CHECK in `001_initial_schema.sql`; parity enforced by
 * db-parity.test.ts (table-scoped to `projects`).
 *
 * Two axes share this one column:
 *   - lifecycle: active → paused → completed   (`completed` IS the
 *     "closed out" state — see 20260630120000_project_lifecycle_dates)
 *   - soft-delete: archived                    (hidden / trash layer)
 *
 * Do NOT add a 5th value (e.g. `closed`) — close-out maps onto
 * `completed` + a `closed_at` stamp, deliberately. Widening this set
 * requires widening the CHECK in the same PR.
 */
export const PROJECT_STATUSES = [
  "active",
  "paused",
  "completed",
  "archived",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ALLOWED_PROJECT_STATUSES = new Set<string>(PROJECT_STATUSES);

/**
 * The two statuses a contributor can pick directly in the edit form.
 * Terminal states (`completed` = close-out, `archived` = soft-delete)
 * are reached only through dedicated, audited verbs
 * (closeOutProjectAction / archive), never the raw status `<select>`.
 */
export const SELECTABLE_PROJECT_STATUSES = ["active", "paused"] as const;

/** Live statuses — project still accepts new time / is "open". */
export const LIVE_PROJECT_STATUSES = new Set<string>(["active", "paused"]);

/** Terminal statuses — project is closed out or archived. closed_at
 *  may be non-null only for these (enforced by CHECK). */
export const TERMINAL_PROJECT_STATUSES = new Set<string>([
  "completed",
  "archived",
]);

/** True when the project is closed out (terminal lifecycle, not the
 *  soft-delete/trash `archived` layer). */
export function isProjectClosed(status: string | null | undefined): boolean {
  return status === "completed";
}
