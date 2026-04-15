# Error log

`/admin/errors`. Append-only log of server-side errors captured in production. System admins only.

## What's logged

- Every server-side error via the Next.js `onRequestError` instrumentation hook — server components, server actions, route handlers, middleware.
- Every server action error that goes through `runSafeAction`.
- Errors explicitly passed to `logError(...)` from application code.

Client-side errors are not logged here. Add them explicitly from components that need them.

## Fields

- `error_code` — categorical code (e.g. `AUTH_FORBIDDEN`, `DATABASE_ERROR`, `NOT_FOUND`, `UNKNOWN`)
- `message` — developer-facing message, may include specifics
- `user_message_key` — i18n key used for the user-facing text
- `details` — JSONB bag with context (pg error code, field names, hint, etc.)
- `user_id` — who hit it (nullable)
- `team_id` — org context if relevant
- `url` / `action` — where it happened
- `stack_trace`
- `severity` — `error` | `warning` | `info`
- `resolved_at` / `resolved_by` — set when an admin marks it resolved

## Filters on the page

- **Severity**: Errors / Warnings / Info / All
- **Status**: Unresolved / Resolved / All
- **Page**: 50 per page

## Resolving

Click **Resolve** on any row. Marks it resolved with `resolved_at = now()` and `resolved_by = you`. Doesn't delete. The audit log is append-only by policy — never delete rows, just resolve.

## Triage guidance

- **AUTH_FORBIDDEN / AUTH_UNAUTHORIZED**: usually user-error (tried something they shouldn't). Frequent = UX issue to investigate.
- **DATABASE_ERROR with pg code 42501** (insufficient_privilege): an RLS policy is denying something that should be allowed. See `SAL-003` / `SAL-004` for the kind of root causes to look for.
- **DATABASE_ERROR with pg code 23505** (unique_violation): duplicate insert, usually a race. Investigate.
- **UNKNOWN**: unhandled. Read the stack trace.

## Fallback path

Error logging has two paths:
1. **Primary**: admin service-role client writes to `error_logs`. Requires `SUPABASE_SERVICE_ROLE_KEY` in the environment.
2. **Fallback**: `log_error_from_user` SECURITY DEFINER RPC. Works from any authenticated user session. Used when the admin client fails (missing env var, etc.)

If you see errors land via the fallback path, check [env configuration](env-configuration.md) — the primary path is misconfigured.

## Related

- [`src/instrumentation.ts`](../../../src/instrumentation.ts) — the onRequestError hook
- [`src/lib/logger.ts`](../../../src/lib/logger.ts) — the logError function
- [Security audit log](../../security/SECURITY_AUDIT_LOG.md) — distinct from this; tracks security-specific findings
