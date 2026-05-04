/**
 * Allow-lists for messaging-platform enums. Mirrors the CHECK
 * constraints on the corresponding columns; `db-parity.test.ts`
 * enforces.
 *
 * Adding a value:
 *   1. Add to the Set here.
 *   2. ALTER … DROP CONSTRAINT / ADD CONSTRAINT in a new migration.
 *   3. Run `npm test src/__tests__/db-parity.test.ts` — it'll fail
 *      if you forgot one or the other.
 */

/** message_outbox.status terminal + transient values. */
export const ALLOWED_OUTBOX_STATUS = new Set([
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed_retryable",
  "failed_permanent",
] as const);

/** message_outbox.related_kind — what the message is about. */
export const ALLOWED_RELATED_KINDS = new Set([
  "invoice",
  "invoice_reminder",
  "payment_thanks",
] as const);

/** verified_email_domains.status — Resend's domain-verification
 *  state machine, mirrored here for client-side filtering. */
export const ALLOWED_DOMAIN_STATUS = new Set([
  "pending",
  "verified",
  "failed",
] as const);
