/**
 * Pure helpers for the proposals LIST surface: URL status-filter
 * parsing, read-time expiry, sent-aging, and the outstanding
 * ("awaiting signature") rollup.
 *
 * Framework-free + Supabase-free so the page, the table, and the
 * dashboard cards share one definition of "outstanding" and one
 * expiry rule — and so it's unit-testable without a route runtime.
 *
 * Expiry is READ-TIME only (like invoice overdue): the DB status
 * stays `sent`/`viewed`; the UI derives "Expired" from
 * `valid_until < today`. Nothing here mutates state.
 */

/**
 * URL-facing filter buckets, in display order. Buckets are coarser
 * than raw statuses on purpose:
 *   - `sent`    = sent + viewed (both are "in flight, awaiting a decision")
 *   - `history` = superseded + converted (no longer actionable)
 * `all` is the default and stays out of the URL.
 */
export const PROPOSAL_STATUS_FILTERS = [
  "all",
  "draft",
  "sent",
  "accepted",
  "declined",
  "history",
] as const;

export type ProposalStatusFilter = (typeof PROPOSAL_STATUS_FILTERS)[number];

/** Tolerant URL-param parser — malformed / unknown values fall back
 *  to `all` rather than throwing (params come from arbitrary URLs). */
export function parseProposalStatusFilter(
  raw: string | string[] | undefined,
): ProposalStatusFilter {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return (PROPOSAL_STATUS_FILTERS as readonly string[]).includes(s ?? "")
    ? (s as ProposalStatusFilter)
    : "all";
}

/** Statuses a filter bucket matches, for a server-side `.in()`.
 *  `null` = no constraint (the `all` bucket). */
export function proposalFilterStatuses(
  filter: ProposalStatusFilter,
): string[] | null {
  switch (filter) {
    case "all":
      return null;
    case "sent":
      return ["sent", "viewed"];
    case "history":
      return ["superseded", "converted"];
    default:
      return [filter];
  }
}

/** Statuses that count as "outstanding" — sent for sign-off, not
 *  yet decided. Shared by the list rollup and the dashboard card. */
export const OUTSTANDING_PROPOSAL_STATUSES = new Set<string>([
  "sent",
  "viewed",
]);

/**
 * Whole days elapsed from a YYYY-MM-DD date to today (also
 * YYYY-MM-DD). Both are local-calendar dates so the math is pure
 * UTC-midnight arithmetic — no timezone drift, no DST surprises.
 * Returns null for a missing/malformed date or a future date.
 */
export function daysSinceIsoDate(
  dateIso: string | null,
  todayIso: string,
): number | null {
  if (!dateIso) return null;
  const from = Date.parse(`${dateIso}T00:00:00Z`);
  const to = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const days = Math.floor((to - from) / 86_400_000);
  return days >= 0 ? days : null;
}

/**
 * Read-time expiry: an in-flight (sent/viewed) proposal whose
 * `valid_until` has passed. YYYY-MM-DD strings compare correctly
 * lexicographically, mirroring the invoices list's overdue check.
 */
export function isProposalExpired(
  status: string,
  validUntil: string | null,
  todayIso: string,
): boolean {
  if (!OUTSTANDING_PROPOSAL_STATUSES.has(status)) return false;
  if (!validUntil) return false;
  return validUntil < todayIso;
}

export interface OutstandingSummary {
  count: number;
  total: number;
}

/** Count + summed total of in-flight (sent/viewed) proposals. */
export function summarizeOutstandingProposals(
  rows: ReadonlyArray<{ status: string; total: number }>,
): OutstandingSummary {
  let count = 0;
  let total = 0;
  for (const row of rows) {
    if (!OUTSTANDING_PROPOSAL_STATUSES.has(row.status)) continue;
    count += 1;
    total += row.total;
  }
  // Re-round: each row total is already 2-decimal, but float addition
  // can reintroduce 1e-13 noise that formatCurrency would hide while
  // tests (and CSV exports) would not.
  return { count, total: Math.round(total * 100) / 100 };
}

/**
 * The amount to show in a list row's Total column: the accepted
 * total once the client has authorized a subset (accepted /
 * converted), else the full proposal total.
 */
export function displayProposalTotal(
  status: string,
  total: number,
  acceptedTotal: number | null,
): number {
  if ((status === "accepted" || status === "converted") && acceptedTotal !== null) {
    return acceptedTotal;
  }
  return total;
}
