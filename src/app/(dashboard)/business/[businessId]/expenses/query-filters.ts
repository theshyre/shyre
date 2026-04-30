import type { ExpenseFilters } from "./filter-params";

/**
 * Apply `ExpenseFilters` clauses to a Supabase query builder.
 * Single source of truth for filter→query translation, used by
 * BOTH the list page (`page.tsx`) AND bulk actions running in
 * filter-scope mode (`actions.ts` cross-page "select all
 * matching"). Without this shared helper, the action's filter
 * path could silently drift from what the user sees in the UI —
 * a class of bugs we want to make impossible.
 *
 * The generic `T` is structurally typed so it preserves the
 * caller's chain-type info: this stays chainable after the
 * helper returns. The constraint enumerates only the methods
 * we actually call, so a caller passing a builder that doesn't
 * support them gets a compile error rather than a runtime one.
 */
export function applyExpenseFilters<
  T extends {
    or(arg: string): T;
    gte(col: string, value: string): T;
    lte(col: string, value: string): T;
    in(col: string, values: string[]): T;
    is(col: string, value: null): T;
    eq(col: string, value: string | boolean): T;
  },
>(query: T, filters: ExpenseFilters): T {
  let q = query;

  // Text search: match vendor / description / notes via Postgres
  // ilike. Strip commas / parens from input — Supabase's `or()`
  // builder takes a comma-separated list of clauses; user input
  // with those characters would break the parser.
  if (filters.q) {
    const sanitized = filters.q.replace(/[,()]/g, " ").trim();
    if (sanitized) {
      const pattern = `%${sanitized}%`;
      q = q.or(
        `vendor.ilike.${pattern},description.ilike.${pattern},notes.ilike.${pattern}`,
      );
    }
  }

  if (filters.from) q = q.gte("incurred_on", filters.from);
  if (filters.to) q = q.lte("incurred_on", filters.to);

  if (filters.categories.length > 0) {
    q = q.in("category", filters.categories);
  }

  if (filters.project === "none") {
    q = q.is("project_id", null);
  } else if (filters.project !== null) {
    q = q.eq("project_id", filters.project);
  }

  if (filters.billable !== null) {
    q = q.eq("billable", filters.billable);
  }

  return q;
}
