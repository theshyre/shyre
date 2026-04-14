# Security Audit Log

> **Append-only.** Never delete entries. Update resolution when fixed.

| ID | Date | Severity | Description | Status | Resolution |
|----|------|----------|-------------|--------|------------|
| SAL-001 | 2026-04-13 | Info | Initial project setup — RLS enabled on all tables, no secrets in code, auth middleware in place | Resolved | Baseline security established in commit `e67885f` |
| SAL-002 | 2026-04-13 | Medium | `stopTimerAction`, `updateTimeEntryAction`, `deleteTimeEntryAction` filtered by entry `id` only — RLS would still block cross-user writes, but defense-in-depth missing | Resolved | Added `.eq("user_id", userId)` filter in all three actions (time-entries Phase 1 redesign) |
