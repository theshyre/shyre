/**
 * "Is this draft ready to send?" — the single source of truth for the send
 * gate. A draft persists in any state (save-as-you-go); completeness is only
 * required at the moment it goes out for sign-off. This helper lists exactly
 * what's still missing so the detail page can render a checklist AND the send
 * action can refuse with the same reasons (no drift between the two).
 *
 * Each issue's `key` is an i18n key under `proposals.readiness.*`; `params`
 * feed ICU placeholders. Item/phase structure problems are delegated to the
 * shared `validateProposalItems` domain rule (the same one the strict schema
 * and the form preview use), so "phases must sum to the item price" is stated
 * identically everywhere.
 */
import {
  validateProposalItems,
  type ProposalItemInput,
} from "@/lib/proposals/line-items";

export interface ReadinessIssue {
  key: string;
  params?: Record<string, string | number>;
}

export interface ProposalReadinessInput {
  title: string | null;
  signerContactId: string | null;
  items: readonly ProposalItemInput[];
}

/**
 * Returns the blockers preventing a draft from being sent. Empty array = ready.
 * Order is author-facing top-to-bottom: name it → line items → who signs.
 */
export function proposalSendReadiness(
  input: ProposalReadinessInput,
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  if (!input.title || input.title.trim() === "") {
    issues.push({ key: "titleMissing" });
  }

  // Item/phase completeness (empty list, blank titles, invalid prices, phase
  // sums) comes straight from the domain validator — reused verbatim so the
  // send checklist and the strict schema never disagree.
  for (const issue of validateProposalItems(input.items)) {
    issues.push({ key: issue.key, params: issue.params });
  }

  // The sign link + one-time code are emailed to the signer contact; without
  // one there is nowhere to send the proposal.
  if (!input.signerContactId) {
    issues.push({ key: "signerMissing" });
  }

  return issues;
}

/** Convenience predicate — a draft is sendable when nothing blocks it. */
export function isProposalSendable(input: ProposalReadinessInput): boolean {
  return proposalSendReadiness(input).length === 0;
}
