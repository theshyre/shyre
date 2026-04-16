# Testing roadmap

## Current state (as of 2026-04-16)

```
Coverage:  29.27% statements · 21.07% branches · 31.01% functions · 29.15% lines
Target:    90% across the board (CLAUDE.md mandate)
Gate:      CI runs `npm run test:coverage` with a ratcheted floor
           (see vitest.config.ts thresholds). PRs that drop below
           the floor fail CI. Every PR that raises coverage must
           also raise the floor — this is how we get from 29% to 90%
           without a week-long push.
```

## Why this exists

Shyre was built quickly and tests were not written alongside most of the code. The first audit of this repo found **77% of source files had no co-located test**. The CLAUDE.md mandate (>90% coverage, test per file) is aspirational until a catch-up pass fills the gap.

The CI coverage gate (added 2026-04-16) is the guardrail: no new untested code merges without also dropping coverage. The ratchet rule converts each incremental test into a permanent floor raise.

## Untested server actions — priority order

Server actions are the highest-risk untested surface because they write to the DB, pass through the auth boundary, and have no type-level contract with RLS. Order is **risk-descending**: work top-down.

| # | File | ~Lines | Risk | Why |
|---|---|---|---|---|
| 1 | ~~`invoices/actions.ts`~~ | 173 | ✅ **DONE** (`f42d2cf`) | Money-touching |
| 2 | `customers/actions.ts` | 150 | HIGH | Shared resource, team-scoped CRUD, archive |
| 3 | `customers/[id]/sharing-actions.ts` | 73 | HIGH | Cross-team grants — any bug here is a data leak |
| 4 | `customers/[id]/permissions-actions.ts` | 75 | HIGH | Role + permission mutation |
| 5 | `teams/[id]/team-actions.ts` | ~100 | HIGH | Team destructive ops + cascades |
| 6 | `security-groups/actions.ts` | ? | HIGH | ACL group membership |
| 7 | `admin/sample-data/actions.ts` | ~200 | HIGH | Bulk system mutation (seed/wipe) |
| 8 | `admin/errors/actions.ts` | ~100 | MED | Error-resolution admin |
| 9 | `teams/actions.ts` | ? | MED | Team create / join |
| 10 | `teams/[id]/relationships-actions.ts` | ? | MED | Inter-team relationships |
| 11 | `teams/[id]/team-settings-actions.ts` | ? | MED | Per-team config |
| 12 | `customers/[id]/change-primary-actions.ts` | ? | MED | Primary-team transfer |
| 13 | `business/actions.ts` | ? | MED | Business profile CRUD |
| 14 | `business/[id]/expenses/actions.ts` | 80 | MED | Financial records |
| 15 | `time-entries/actions.ts` | ? | MED | Core domain — may be covered indirectly by integration tests |
| 16 | `projects/actions.ts` | ? | MED | Project CRUD |
| 17 | `categories/actions.ts` | 50 | LOW | Categories |
| 18 | `templates/actions.ts` | 50 | LOW | Templates |
| 19 | `profile/actions.ts` | 30 | LOW | User preferences |

## Pattern for new action tests

Established in `invoices/actions.test.ts` (`f42d2cf`) and `lib/safe-action.test.ts` (`01156ad`). Reusable shape:

1. **Mock `runSafeAction`** to strip the auth boundary — safe-action's own tests cover the wrap. Inside your action test, call the inner fn directly with a stub `{ supabase, userId }`.
2. **Mock `@/lib/supabase/server`** with a per-table chain that records inserts/updates/deletes as observable state. Vary the state per test.
3. **Mock `next/navigation` `redirect`** to throw a `NEXT_REDIRECT`-shaped error so you can assert on the redirect path.
4. **Mock `next/cache` `revalidatePath`** with a spy.
5. Cover: happy path, auth-fail, validation-fail, not-found, destructive-with-cascade, RLS-deny shape (error code 42501), and the side effects (revalidation + redirect).

## Other untested surfaces (less urgent)

Beyond the 18 action files:
- ~130 components, hooks, and util files without co-located tests — many are trivial (display components) and covered indirectly by existing integration tests.
- `lib/supabase/{client,server,admin,middleware}.ts` — thin wrappers around `createServerClient` / `createBrowserClient`; integration tests exercise them. Unit tests would be low-value.
- Several query files under `lib/<domain>/queries.ts` — worth testing but less critical than the mutation side.

These can be picked up opportunistically as features touch them. The action files are the coordinated push.

## How we reach 90%

**Near term** (next several PRs): knock out items 2–7 above. That covers the highest-risk mutations. Estimated: each file ~150–300 LOC of test code + ~2–3 hours per file with the established pattern. 6 files = ~1 week of focused test-writing.

**Medium term**: items 8–19. Lower risk, smaller files, faster. Another ~1 week.

**Longer term**: the ~130 non-action source files. Drive-by as features land. Ratchet rule ensures we don't regress.

**CI gate status along the way**: the floor rises with each PR that meaningfully raises a dimension. Never lower a floor to make a build pass. If a legitimate reason to drop a floor exists (e.g., deleting a heavily-tested file), document it in the PR.

## Related

- `vitest.config.ts` — thresholds + ratchet-rule comment
- `.github/workflows/ci.yml` — CI coverage gate
- `CLAUDE.md` → "Testing — MANDATORY" — the coverage rule this roadmap serves
- `docs/personas/qa-tester.md` — the review lens that catches missing tests on PR
