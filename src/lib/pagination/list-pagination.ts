/**
 * Shared pagination parser for list pages. The pattern is "load
 * more" — each click bumps the URL's `?limit=N` param so the
 * server re-renders with more rows. URL-driven by design so
 * pagination state is bookmarkable and survives a refresh.
 *
 * Usage from a server component:
 *
 *   const { limit } = parseListPagination(searchParams);
 *   const { data, count } = await query
 *     .select(..., { count: "exact" })
 *     .range(0, limit - 1);
 *
 * Then render <PaginationFooter loaded={data.length} total={count} />
 * below the table; clicking "Load N more" navigates to a URL
 * with `?limit=N+step`.
 *
 * Keep this file Supabase-free + framework-free so it's reusable
 * across every list page (`/expenses`, `/customers`, `/invoices`,
 * `/trash`, etc.) and unit-testable without a route runtime.
 */

export interface ListPagination {
  /** Maximum rows the server should return for this render. */
  limit: number;
}

/** Default initial page size. Chosen to fit a typical recent-work
 *  view on a single laptop screen at Regular density without
 *  scrolling, while leaving the per-load click count at year-end
 *  reconciliation in the 3–6 range (rather than 20+ for a 25/page
 *  default). */
export const DEFAULT_LIST_LIMIT = 50;

/** Hard ceiling so a malicious URL or runaway "Load all" can't
 *  ask the server for an unbounded set. 5000 covers a multi-year
 *  audit on a single business; beyond that, the user should
 *  filter or export. */
export const MAX_LIST_LIMIT = 5000;

/** Parse the `?limit=N` URL param into a normalized
 *  ListPagination. Tolerant: malformed values fall back to the
 *  default rather than throwing, since URL params come from
 *  arbitrary callers (a bookmarked link, an external paste). */
export function parseListPagination(
  raw: Record<string, string | string[] | undefined>,
  defaultLimit: number = DEFAULT_LIST_LIMIT,
): ListPagination {
  const v = raw.limit;
  const s = Array.isArray(v) ? v[0] : v;
  if (s === undefined || s === null || s === "") {
    return { limit: defaultLimit };
  }
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) return { limit: defaultLimit };
  if (n > MAX_LIST_LIMIT) return { limit: MAX_LIST_LIMIT };
  return { limit: n };
}
