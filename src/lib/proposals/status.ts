/**
 * Proposal status transition graph — forward-only, mirroring
 * `src/lib/invoice-status.ts`. All reverse transitions are rejected;
 * correcting a sent proposal is a NEW version (P4 `superseded`), not a
 * status rollback.
 *
 *   draft → sent → viewed → accepted → converted
 *                 ↘ accepted        (a signer can accept without a recorded view
 *                 ↘ declined         — e.g. paper sign-off entered by the provider)
 *          viewed ↘ declined
 *   draft|sent|viewed → superseded  (replaced by a newer version, P4)
 *
 * declined / converted / superseded are terminal.
 */

import type { ProposalStatus } from "@/app/(dashboard)/proposals/allow-lists";

const ALLOWED_NEXT: Record<ProposalStatus, readonly ProposalStatus[]> = {
  draft: ["sent", "superseded"],
  sent: ["viewed", "accepted", "declined", "superseded"],
  viewed: ["accepted", "declined", "superseded"],
  accepted: ["converted"],
  declined: [],
  converted: [],
  superseded: [],
};

export function isValidProposalStatusTransition(
  from: string,
  to: string,
): boolean {
  const nexts = ALLOWED_NEXT[from as ProposalStatus];
  if (!nexts) return false;
  return (nexts as readonly string[]).includes(to);
}

/** Statuses reachable from `from` — drives which buttons render. */
export function allowedNextProposalStatuses(
  from: string,
): readonly ProposalStatus[] {
  return ALLOWED_NEXT[from as ProposalStatus] ?? [];
}
