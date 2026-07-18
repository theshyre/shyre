/**
 * The `proposals` columns a new version copies from its source document
 * (freeze-and-reissue: `createProposalVersionAction` reads `select("*")` but
 * must insert a hand-picked list). Kept OUT of `actions.ts` because a
 * `"use server"` module may only export async functions.
 *
 * When adding a proposals column, decide explicitly: does it belong on a
 * version copy? Content/terms columns → add here. Lifecycle state (status,
 * accepted_total, timestamps), identity (id, proposal_number, version chain),
 * and billing artifacts (deposit_invoice_id) never copy — a new version starts
 * its own lifecycle. `version-copy.test.ts` pins both lists.
 */
export const VERSION_COPY_COLUMNS = [
  "customer_id",
  "signer_contact_id",
  "signing_mode",
  "title",
  // Fresh issue date (DB default = today); the validity window is copied for
  // the author to adjust in the new draft — so valid_until copies, issued_date
  // deliberately does not.
  "valid_until",
  "payment_terms_days",
  "payment_terms_label",
  "deposit_type",
  "deposit_value",
  "warranty_days",
  "terms_notes",
  "overview_markdown",
  "sign_theme",
  "currency",
] as const;

export type VersionCopyColumn = (typeof VERSION_COPY_COLUMNS)[number];

/** Pick the copied columns off a `select("*")` proposals row, as the insert
 *  payload fragment for the new version. */
export function pickVersionCopyColumns(
  source: Record<string, unknown>,
): Record<VersionCopyColumn, unknown> {
  return Object.fromEntries(
    VERSION_COPY_COLUMNS.map((column) => [column, source[column]]),
  ) as Record<VersionCopyColumn, unknown>;
}
