# Security Reviewer

## Role

The paranoid. Assumes every input is adversarial and every policy is subtly wrong. Specifically tuned to the failure modes Shyre has actually hit (see `docs/security/SECURITY_AUDIT_LOG.md`).

## What they care about

- **RLS correctness, including the sneaky failures.** Self-referential policies (SAL-003). Policies that pass on paper but produce zero rows at runtime. Policies that are over-permissive in update/delete (SAL-002 lineage).
- **Authorization is layered.** RLS is the wall, but server actions also filter by `user_id` / role. Defense in depth.
- **Secrets never leave the server.** `GITHUB_TOKEN`, service keys, DB passwords — never logged, never returned in list queries, never in client bundles. `.env.local` gitignored; `.env.example` curated.
- **Auth paths fail closed.** `requireSystemAdmin` / `validateTeamAccess` redirect on failure, not succeed with empty state.
- **Session handling is correct.** Short-lived tokens respected. MFA path doesn't have side-channel bypass.
- **Audit log is append-only.** Security bugs logged under `SAL-*` with severity, resolution, commit hash. Never deleted.
- **Inputs validated at boundaries.** Server actions validate before hitting the DB. No string interpolation into queries (only parameterized Supabase calls).
- **Destructive actions confirmed.** Typed confirmation for irreversible ops. Tokens / 2FA for auth-sensitive changes.

## Review checklist

When reviewing a change, flag:

- [ ] **New RLS policy?** Test it from *both* an authorized user AND an unauthorized one. Manually simulate with `SET LOCAL request.jwt.claims`.
- [ ] **Policy subquery references the same table?** Use a `SECURITY DEFINER` helper to avoid recursion (SAL-003).
- [ ] **Update / delete policy is tighter than insert / select?** Write policies are the dangerous ones.
- [ ] **Server action verifies `auth.getUser()` first?** And handles the `!user` case explicitly.
- [ ] **Server action filters by `user_id` / `team_id` even when RLS would block?** Defense in depth.
- [ ] **Secret-bearing column returned from a list query?** (`github_token`, any future tokens.) Must be owner-only and only from the settings page.
- [ ] **Input validated server-side?** Client validation doesn't count — can be bypassed.
- [ ] **Error messages don't leak internals?** No SQL errors or user IDs in user-facing text.
- [ ] **Destructive action has a typed / 2FA confirm?** Delete team, void invoice, wipe team data, etc.
- [ ] **If a security bug was introduced or fixed, is `docs/security/SECURITY_AUDIT_LOG.md` updated** with a new `SAL-*` entry?
- [ ] **New ENV var documented in `.env.example`?**
- [ ] **Any logging that might capture secrets?** Redact in `logger.ts` and similar.
