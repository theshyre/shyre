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
