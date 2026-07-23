/**
 * Send-readiness for a document sign-off. Pure — the detail page renders the
 * checklist and the send action (PR 3) refuses until it's empty. Mirrors
 * `proposalSendReadiness`: completeness is checked HERE, not in the draft
 * schema, so a work-in-progress draft can always be saved.
 */

export type SignoffReadinessIssueKey =
  | "titleMissing"
  | "bodyEmpty"
  | "noSigners";

export interface SignoffReadinessInput {
  title: string | null | undefined;
  bodyMarkdown: string | null | undefined;
  signerCount: number;
}

export function signoffSendReadiness(
  input: SignoffReadinessInput,
): SignoffReadinessIssueKey[] {
  const issues: SignoffReadinessIssueKey[] = [];
  if (!input.title || input.title.trim() === "") issues.push("titleMissing");
  if (!input.bodyMarkdown || input.bodyMarkdown.trim() === "") {
    issues.push("bodyEmpty");
  }
  if (input.signerCount < 1) issues.push("noSigners");
  return issues;
}

/** A sign-off is editable (draft edits + roster changes) only while `draft`. */
export function isSignoffEditable(status: string): boolean {
  return status === "draft";
}

/** Deletable states: a draft (never sent) or a canceled one. Anything that was
 *  sent + signed is part of the audit record (soft-delete only, and only
 *  draft/canceled hard-delete per the send-lock guard). */
export function isSignoffDeletable(status: string): boolean {
  return status === "draft" || status === "canceled";
}
