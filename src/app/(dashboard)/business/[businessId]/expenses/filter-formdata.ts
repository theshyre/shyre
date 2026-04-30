/**
 * Bridge between client-side `ExpenseFilters` state and the
 * FormData shape that bulk server actions consume when running in
 * "select all matching" mode (`scope=filters`). The two halves of
 * this module — `appendFilterParams` (client) and
 * `readFilterParamsFromFormData` (server) — must round-trip
 * cleanly, which is what the test next door verifies.
 *
 * Filter values are namespaced with the `filter_` prefix so they
 * don't collide with action-target params (e.g., the action's
 * own `category` for setCategory or `project_id` for setProject).
 */
import type { ExpenseFilters } from "./filter-params";

/** Pack the active filter spec into a FormData under
 *  `filter_*` keys. Empty / null fields are omitted so the
 *  FormData stays compact. Categories are appended (one
 *  `filter_category` entry per value) so multi-category filters
 *  survive without a CSV-encoding step. */
export function appendFilterParams(
  fd: FormData,
  filters: ExpenseFilters,
): void {
  if (filters.q) fd.set("filter_q", filters.q);
  if (filters.from) fd.set("filter_from", filters.from);
  if (filters.to) fd.set("filter_to", filters.to);
  for (const c of filters.categories) fd.append("filter_category", c);
  if (filters.project !== null) fd.set("filter_project", filters.project);
  if (filters.billable !== null) {
    fd.set("filter_billable", String(filters.billable));
  }
}

/** Read `filter_*` keys back from a FormData into the
 *  `Record<string, string | string[] | undefined>` shape that
 *  `parseExpenseFilters` expects. Strips the `filter_` prefix.
 *  Multi-value `filter_category` is joined with commas — the
 *  parser accepts both `?category=a,b` and repeated forms. */
export function readFilterParamsFromFormData(
  fd: FormData,
): Record<string, string | string[] | undefined> {
  const raw: Record<string, string | string[] | undefined> = {};
  for (const k of ["q", "from", "to", "project", "billable"] as const) {
    const v = fd.get(`filter_${k}`);
    if (typeof v === "string" && v !== "") raw[k] = v;
  }
  const cats = fd
    .getAll("filter_category")
    .map((v) => String(v))
    .filter((s) => s !== "");
  if (cats.length > 0) raw.category = cats.join(",");
  return raw;
}
