/**
 * Allow-lists for the integrations surface (SAL-051). Mirrored by CHECK
 * constraints in `20260718150000_integrations_foundation.sql`; parity is
 * enforced by `src/__tests__/db-parity.test.ts`.
 */

/** `integration_tokens.scopes` — the v1 capabilities. `entries:read` +
 *  `entries:delete` were added 2026-07-23 for the entry-mutation API
 *  (GET/list, soft-DELETE); `entries:delete` deliberately reverses the
 *  original SAL-051 "no delete scope" decision, bounded by agent-created-only
 *  + uninvoiced + soft-delete + audit (see 20260723120000). Still no
 *  invoice/customer/settings scope: those tables are unreachable through this
 *  surface entirely (security review). */
export const ALLOWED_API_SCOPES = new Set([
  "context:read",
  "timer:read",
  "timer:write",
  "entries:read",
  "entries:write",
  "entries:delete",
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
