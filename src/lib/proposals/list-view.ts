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
 *   - `sent`        = sent + viewed (both are "in flight, awaiting a decision")
 *   - `in_progress` = converted, work not yet delivered (`delivered_at IS NULL`)
 *   - `delivered`   = converted + delivered (`delivered_at IS NOT NULL`)
 *   - `history`     = superseded (a replaced version — no longer in force)
 * `in_progress` / `delivered` both sit on the `converted` status and are
 * split by the `delivered_at` stamp (see `proposalFilterDelivered`), so an
 * owner can tell running engagements from finished ones. `all` is the default
 * and stays out of the URL.
 */
export const PROPOSAL_STATUS_FILTERS = [
  "all",
  "draft",
  "sent",
  "accepted",
  "in_progress",
  "delivered",
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
 *  `null` = no constraint (the `all` bucket). `in_progress` and `delivered`
 *  both resolve to `converted` — the `delivered_at` split is applied
 *  separately via `proposalFilterDelivered`. */
export function proposalFilterStatuses(
  filter: ProposalStatusFilter,
): string[] | null {
  switch (filter) {
    case "all":
      return null;
    case "sent":
      return ["sent", "viewed"];
    case "in_progress":
    case "delivered":
      return ["converted"];
    case "history":
      return ["superseded"];
    default:
      return [filter];
  }
}

/**
 * The `delivered_at` predicate a filter bucket adds on top of its status set.
 * `in_progress` and `delivered` both match `converted` rows and are separated
 * only by whether the engagement has been marked delivered:
 *   - `"undelivered"` → `delivered_at IS NULL`      (still running)
 *   - `"delivered"`   → `delivered_at IS NOT NULL`  (marked delivered)
 *   - `null`          → no delivery constraint (every other bucket)
 * Kept pure + separate from `proposalFilterStatuses` so the page can apply
 * `.is()` / `.not(..., "is", null)` without the helper touching Supabase.
 */
export function proposalFilterDelivered(
  filter: ProposalStatusFilter,
): "delivered" | "undelivered" | null {
  if (filter === "delivered") return "delivered";
  if (filter === "in_progress") return "undelivered";
  return null;
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

export interface SignoffProgress {
  signed: number;
  total: number;
}

/**
 * Read-time "partially signed" projection for a multi-signer proposal.
 *
 * In `all` mode the DB status stays `sent`/`viewed` until EVERY rostered
 * signer accepts — so a deal with one of two signatures in hand reads as
 * a bare "Viewed", which understates where it is. This computes the
 * signed/total pair the badge shows as "N of M signed", the same
 * read-time-projection pattern as `isProposalExpired` (the stored status
 * is never touched). Returns null when the projection doesn't apply:
 * single-signer / `first` mode, an already-decided proposal, or a
 * roster where nobody — or everybody — has signed.
 */
export function partialSignoffProgress(
  status: string,
  signingMode: string | null,
  signedCount: number,
  signerCount: number,
): SignoffProgress | null {
  if (signingMode !== "all") return null;
  if (!OUTSTANDING_PROPOSAL_STATUSES.has(status)) return null;
  if (signerCount < 2) return null;
  if (signedCount < 1 || signedCount >= signerCount) return null;
  return { signed: signedCount, total: signerCount };
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

export interface DeliveryProgress {
  /** Accepted top-level items whose converted project is closed out
   *  (`completed`). */
  delivered: number;
  /** Accepted top-level items — the delivery denominator. */
  total: number;
}

/**
 * Read-time "N of M phases delivered" projection for a CONVERTED proposal.
 *
 * An item counts as delivered only when it was accepted, was converted into a
 * project, AND that project is closed out (`completed`). This deliberately
 * excludes two footguns the persona review flagged:
 *   - Accepted-but-never-converted items (partial conversion) still count in
 *     `total` — so a proposal with a dangling unsold-scope phase never reads
 *     100% delivered.
 *   - A converted project that was `archived` (soft-deleted / abandoned) is
 *     NOT `completed`, so it does not count as delivered — abandoning a phase
 *     never inflates the delivered count.
 * `completedProjectIds` is the caller-supplied set of converted-project ids
 * whose project status satisfies `isProjectClosed` (completed, not archived).
 *
 * Framework/Supabase-free so the detail page and its tests share one rule.
 * The stored proposal status is never touched — delivery is a `delivered_at`
 * stamp, and this is the progress readout layered on top of it.
 */
export function proposalDeliveryProgress(
  acceptedItems: ReadonlyArray<{ convertedProjectId: string | null }>,
  completedProjectIds: ReadonlySet<string>,
): DeliveryProgress {
  let delivered = 0;
  for (const item of acceptedItems) {
    if (
      item.convertedProjectId !== null &&
      completedProjectIds.has(item.convertedProjectId)
    ) {
      delivered += 1;
    }
  }
  return { delivered, total: acceptedItems.length };
}

/**
 * Whether a converted proposal is READY to be marked delivered — every
 * accepted top-level item has a closed-out project. Drives the "all phases
 * closed — mark delivered?" nudge. Marking delivered is never BLOCKED by this
 * (an owner may assert delivery of the phases they sold while a later phase
 * dangles); the nudge only fires when the whole engagement is demonstrably
 * done. A zero-item proposal is never "ready" (nothing to deliver).
 */
export function isProposalDeliveryReady(progress: DeliveryProgress): boolean {
  return progress.total > 0 && progress.delivered === progress.total;
}
