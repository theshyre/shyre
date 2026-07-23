/**
 * Allow-lists for the generic document sign-off surface.
 *
 * Each set is mirrored by a CHECK constraint in
 * `20260723130000_signoff_foundation.sql`; parity is asserted in
 * `src/lib/sign/allow-lists.test.ts` against the migration text (the enums use
 * unique column names, but a dedicated test keeps them in lockstep — the
 * integrations-scopes precedent).
 */

/** `signoff_documents.document_type` — the kind of artifact being signed off.
 *  Release notes are the first type; SOWs / validation protocols can follow. */
export const SIGNOFF_DOCUMENT_TYPES = new Set(["release_notes"]);

/** `signoff_documents.status` — the lifecycle. `completed` = every required
 *  signer signed; `declined` = a signer refused; `superseded` = replaced by a
 *  newer version; `canceled` = withdrawn before completion. */
export const SIGNOFF_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "completed",
  "declined",
  "superseded",
  "canceled",
]);

/** `signoff_documents.signing_mode` — `all` (every rostered signer must sign,
 *  the release-notes default) or `first` (any one signer binds). */
export const SIGNOFF_SIGNING_MODES = new Set(["all", "first"]);

/** `signoff_acceptances.signature_meaning` — the Part-11 manifestation seed:
 *  what the signer is attesting to. Maps from the roster role. */
export const SIGNATURE_MEANINGS = new Set(["author", "reviewer", "approver"]);
