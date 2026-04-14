# Security Audit Log

> **Append-only.** Never delete entries. Update resolution when fixed.

| ID | Date | Severity | Description | Status | Resolution |
|----|------|----------|-------------|--------|------------|
| SAL-001 | 2026-04-13 | Info | Initial project setup — RLS enabled on all tables, no secrets in code, auth middleware in place | Resolved | Baseline security established in commit `e67885f` |
| SAL-002 | 2026-04-13 | Medium | `stopTimerAction`, `updateTimeEntryAction`, `deleteTimeEntryAction` filtered by entry `id` only — RLS would still block cross-user writes, but defense-in-depth missing | Resolved | Added `.eq("user_id", userId)` filter in all three actions (time-entries Phase 1 redesign) |
| SAL-003 | 2026-04-14 | Low (availability, not confidentiality) | `system_admins` SELECT policy self-joined the same table (`EXISTS (SELECT 1 FROM system_admins …)`), triggering Postgres "infinite recursion detected in policy for relation system_admins". Supabase client returned `{data: null, error}`, `requireSystemAdmin` read that as "not admin", and every `/admin/*` route redirected sysadmins to `/`. Failed closed (no privilege escalation), but the admin surfaces were unreachable. | Resolved | Policy rewritten to `USING (public.is_system_admin())` — reuses the existing SECURITY DEFINER helper from migration 006, which bypasses RLS on its internal lookup. Commit `5221fc1`, migration `20260414232000_fix_system_admins_rls_recursion.sql`. Verified sysadmins read their row; non-sysadmins see zero. |
