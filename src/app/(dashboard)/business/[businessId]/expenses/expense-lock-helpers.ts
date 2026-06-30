/**
 * Pure helpers for the phase-2 invoiced-expense lock. Lives outside
 * actions.ts so it can be exported without `"use server"` exposing
 * it as a network-callable action, and so it can be unit-tested with
 * a tiny supabase mock — bulk mutations rely on this gatekeeper, and
 * a regression that swallows it would silently double-bill invoiced
 * rows on the next bulk action.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Expense fields that stay editable while the expense is on a live
 * invoice. The invoice SNAPSHOTS the expense (its line description +
 * amount are frozen at creation; the detail page and PDF render from
 * the snapshot, not live from the expense), so editing this internal
 * metadata cannot alter the issued invoice. The fields the invoice
 * depends on — amount, currency, incurred_on (date), project_id,
 * billable — stay LOCKED.
 *
 * MUST stay byte-identical to the `meta` array in
 * `tg_expenses_invoice_lock_guard` (migration 20260630130000) — pinned
 * by `expense-lock-parity.test.ts`. The DB trigger is the real
 * enforcement boundary (a forged POST bypasses the action); this set
 * mirrors it for the action-layer gate and the per-field UI lock.
 */
export const INVOICED_EDITABLE_EXPENSE_FIELDS = new Set<string>([
  "external_reference",
  "description",
  "notes",
  "vendor",
  "category",
]);

/**
 * True when `field` is locked because the expense is on a live invoice.
 * Used by the UI to render the cell read-only (with a reason) instead
 * of letting the user attempt an edit that the action + trigger reject.
 */
export function isExpenseFieldLockedWhenInvoiced(field: string): boolean {
  return !INVOICED_EDITABLE_EXPENSE_FIELDS.has(field);
}

/**
 * Strip rows already on an invoice from a list of authorized ids.
 *
 * Returns the subset of `ids` whose `expenses.invoiced` is not `true`.
 * Treats `null` / `undefined` invoiced values as un-invoiced (matches
 * the legacy import semantics where pre-phase-2 rows have no value).
 * Empty input short-circuits without hitting the DB.
 *
 * Bulk mutations (update category / project / billable / delete)
 * call this after `resolveAuthorizedExpenseIds` so the role gate is
 * still the primary filter and the invoice-lock is the secondary
 * narrow. Restore intentionally does NOT apply this filter —
 * recovering a soft-deleted invoiced row is non-destructive.
 */
export async function filterUninvoicedExpenseIds(
  supabase: SupabaseClient,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("expenses")
    .select("id, invoiced")
    .in("id", ids);
  return (data ?? [])
    .filter((r) => r.invoiced !== true)
    .map((r) => r.id as string);
}
