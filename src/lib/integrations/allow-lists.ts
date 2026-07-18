/**
 * Allow-lists for the integrations surface (SAL-051). Mirrored by CHECK
 * constraints in `20260718150000_integrations_foundation.sql`; parity is
 * enforced by `src/__tests__/db-parity.test.ts`.
 */

/** `integration_tokens.scopes` — the four v1 capabilities. Deliberately no
 *  delete scope, no invoice/customer/settings scope: those tables are
 *  unreachable through this surface entirely (security review, blocking
 *  req. 1). */
export const ALLOWED_API_SCOPES = new Set([
  "context:read",
  "timer:read",
  "timer:write",
  "entries:write",
]);

/** `time_entries.started_by_kind` — who/what initiated the entry.
 *  Multi-stream-timers Option B Phase 1. Display-only metadata: never
 *  touches rate, billability defaults beyond token config, or invoice
 *  math. */
export const ALLOWED_STARTED_BY_KINDS = new Set([
  "user",
  "agent",
  "integration",
  "import",
]);
