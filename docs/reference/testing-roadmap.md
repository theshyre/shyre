# Testing roadmap

## Current state (as of 2026-05-11)

```
Tests:     2126 passing · 1 skipped (was 2068 last commit, 1810 pre-2026-05-05 audit)
Coverage:  Statements 39.84% · Branches 33.19% · Functions 36.68% · Lines 39.88%
Target:    90% across the board (CLAUDE.md mandate)
Gate:      CI runs `npm run test:coverage` with a ratcheted floor
           (see vitest.config.ts thresholds). PRs that drop below
           the floor fail CI. Every PR that raises coverage must
           also raise the floor — this is how we get from 39% to 90%
           without a week-long push.
Build:     `npm run ci:local` now also runs `next build` to catch
           Next.js-only checks (`"use server"` async-export, server-
           closure-passed-across-boundary in build trace) that
           lint/typecheck/vitest miss.
```

**2026-05-11 push (priority items 6–9 from this doc).** 58 new tests
across four untested server-action files. Coverage gain ~1 pp; the
load-bearing security-relevant surfaces (security-groups + sample-
data + system-errors + teams) are now defended. Floor ratcheted to
39 / 33 / 36 / 39.

- ✅ Item 6 — `security-groups/actions.ts`: 22 cases covering all four
  actions (createGroup / deleteGroup / addGroupMember / removeGroupMember).
  Role gates, cross-team scoping, group-not-found rejection on add/remove,
  description-null normalization, DB-error propagation.
- ✅ Item 7 — `system/sample-data/actions.ts`: 14 cases (focused on
  the action-boundary contract — sysadmin gate, team owner|admin
  gate, typed-confirm name match on `clearAllTeamDataAction`, missing-
  team_id rejection, /team-not-found rejection, revalidatePath fan-out
  for `cleanupOrphanTeamsAction`). The internal seed/wipe helpers
  (loadSample, deleteSampleRowsInOrg, createSampleUsers) tunnel into
  the admin client + auth admin API; those need their own fixture
  suite — out of scope here, noted as a follow-up below.
- ✅ Item 8 — `system/errors/actions.ts`: 5 cases (resolveErrorAction —
  happy path stamps resolved_at + resolved_by with the right actor and
  a current timestamp; sysadmin-gate rejection; DB error propagation;
  revalidatePath only on success).
- ✅ Item 9 — `teams/actions.ts`: 17 cases covering createTeam /
  leaveTeam / deleteTeam. Critical invariants: sole-owner-cannot-leave,
  delete-refuses-last-team, typed-confirm-must-match-name, orphan-
  business-cleanup-only-when-truly-orphaned. The `create_team` RPC
  routing (SECURITY DEFINER for atomic create-team-and-membership) is
  asserted as the only insert path.

**2026-05-04 → 2026-05-05 audit campaign (16 batches).** ~280 new
tests across the priority surfaces:

- ✅ Item 1 — `invoices/actions.ts`: extended with `deleteInvoiceAction`
  (9 cases) + discount-path wiring (7 cases) on top of the existing
  create / status-update coverage.
- ✅ Items 2/3/4 (customers + sharing + permissions) — the 2026-05-04
  push, plus role-gate refusal cases added in batch 2.
- ✅ Item 5 — `teams/[id]/team-actions.ts`: 13 cases covering
  inviteMember + removeMember + revokeInvite + transferOwnership +
  updateMemberRole (the new role-transition RPCs added in batch 3).
- ✅ Item 14 — `business/[id]/expenses/actions.ts`: 35 cases
  covering create / update / delete / restore + splitExpense
  (12 cases for split alone — happy path, role gate, validation
  propagation, JSON parse, 2dp rounding).
- ✅ Item 15 — `time-entries/actions.ts`: 16 cases covering trash
  invariants (delete / restore / permanently-delete with
  user_id-defense filters) + createTimeEntryAction (8 cases on the
  internal-billable enforcement, project lookup, duration/timestamp
  modes, tz_offset clamping). Heavyweight paths (`startTimerAction`,
  `duplicateTimeEntryAction`) deliberately left for a later push —
  they need project + ticket fixtures.
- ✅ `auth/accept-invite/route.ts`: 10 cases (audit H6) for the
  three independent gates + email-case-insensitivity + memberError
  logging context.
- ✅ `lib/messaging/send-invoice` orchestrator + `send-invoice-action`:
  14 cases for the To/Cc dedup + sent_at stability across resends +
  void rejection + role gate + failure-leaves-status-unchanged path.
- ✅ MFA URI rewrite extracted + 8 unit tests for the security-
  relevant logic (preserved crypto params, URL-encoding, plus-
  addressing, missing-param defaults).
- ✅ Modal wrapper with focus trap / return-focus / accessible name
  — 9 component tests.
- ✅ `summarizePayments` (currency-aware payment aggregation):
  7 cases.
- ✅ `reports-period` (date-range resolver): 11 cases.
- ✅ Playwright route-smoke spec (`e2e/route-smoke.spec.ts`) covers
  18 static dashboard routes — defense against the runtime crash
  class (server-closure-across-client-boundary) that bit `/projects`
  in batch 7.
- ✅ Two new RLS integration suites (batch 16): `invoices-rls`
  (10 cases) covers `invoices` + `invoice_line_items` + `invoice_
  payments`; `message-outbox-rls` (11 cases) covers the tighter
  owner/admin-only model + the no-INSERT-policy rule for
  `message_outbox` + `message_outbox_events`. Both auto-pick up
  in CI when staging Supabase secrets are configured.

**Pre-audit progress (2026-05-04):** items 2, 3, 4 of the priority
list landed — `customers/actions.ts`, `customers/[id]/sharing-actions.ts`,
and `customers/[id]/permissions-actions.ts`. 55 new tests across the
three files. The customers surface — shared resource, cross-team
grants, principal permission grants — is now defended against
mutation regressions.

## Why this exists

Shyre was built quickly and tests were not written alongside most of the code. The first audit of this repo found **77% of source files had no co-located test**. The CLAUDE.md mandate (>90% coverage, test per file) is aspirational until a catch-up pass fills the gap.

The CI coverage gate (added 2026-04-16) is the guardrail: no new untested code merges without also dropping coverage. The ratchet rule converts each incremental test into a permanent floor raise.

## Untested server actions — priority order

Server actions are the highest-risk untested surface because they write to the DB, pass through the auth boundary, and have no type-level contract with RLS. Order is **risk-descending**: work top-down.

| # | File | ~Lines | Risk | Why |
|---|---|---|---|---|
| 1 | ~~`invoices/actions.ts`~~ | 173 | ✅ **DONE** (`f42d2cf` + audit batch 4 / 8) | Money-touching |
| 2 | ~~`customers/actions.ts`~~ | 143 | ✅ **DONE** (2026-05-04) | Shared resource, team-scoped CRUD, archive |
| 3 | ~~`customers/[id]/sharing-actions.ts`~~ | 73 | ✅ **DONE** (2026-05-04) + audit batch 2 role-gate cases | Cross-team grants — any bug here is a data leak |
| 4 | ~~`customers/[id]/permissions-actions.ts`~~ | 75 | ✅ **DONE** (2026-05-04) + audit batch 2 role-gate cases | Role + permission mutation |
| 5 | ~~`teams/[id]/team-actions.ts`~~ | ~160 | ✅ **DONE** (audit batch 4) | Team destructive ops + transfer ownership + role change |
| 6 | ~~`security-groups/actions.ts`~~ | 107 | ✅ **DONE** (2026-05-11) | ACL group membership — all four actions covered |
| 7 | ~~`system/sample-data/actions.ts`~~ | 1011 | ✅ **PARTIAL** (2026-05-11 — action-boundary contracts: sysadmin gate, team owner|admin gate, typed-confirm, /team-not-found). Deep helpers (`loadSample` / `deleteSampleRowsInOrg` / `createSampleUsers`) tunnel into admin client + auth admin API; their own fixture suite is the next push. | Bulk system mutation (seed/wipe) |
| 8 | ~~`system/errors/actions.ts`~~ | 23 | ✅ **DONE** (2026-05-11) | Error-resolution admin |
| 9 | ~~`teams/actions.ts`~~ | 136 | ✅ **DONE** (2026-05-11) | Team create / join — all three actions covered |
| 10 | `teams/[id]/relationships-actions.ts` | ? | MED | Inter-team relationships |
| 11 | `teams/[id]/team-settings-actions.ts` | ? | MED | Per-team config |
| 12 | `customers/[id]/change-primary-actions.ts` | ? | MED | Primary-team transfer |
| 13 | `business/actions.ts` | ? | MED | Business profile CRUD |
| 14 | ~~`business/[id]/expenses/actions.ts`~~ | 850 | ✅ **DONE** (audit batches 5 + 8 — create / update / delete / restore + splitExpense) | Financial records |
| 15 | ~~`time-entries/actions.ts`~~ | 850 | ✅ **PARTIAL** (audit batches 5 + 8 — trash invariants + createTimeEntryAction). startTimerAction / duplicateTimeEntryAction still need fixtures. | Core domain |
| 16 | `projects/actions.ts` | ? | MED | Project CRUD |
| 17 | `categories/actions.ts` | 50 | LOW | Categories |
| 18 | `templates/actions.ts` | 50 | LOW | Templates |
| 19 | `profile/actions.ts` | 30 | LOW | User preferences |
| 20 | ~~`auth/accept-invite/route.ts`~~ | 90 | ✅ **DONE** (audit batch 4) | Three independent invite gates |
| 21 | ~~`messaging/send-invoice` + `send-invoice-action`~~ | 470 | ✅ **DONE** (audit batch 8) | sent_at stability across resends; To/Cc dedup; status flip semantics |
| 22 | RLS suites — `invoices` + `message_outbox` | — | ✅ **DONE** (audit batch 16) | Auto-skip in CI until staging secrets configured |
| 23 | `lib/credentials/scan.ts` | 178 | LOW (after has_*_token columns) | Generated boolean columns mean tests don't need plaintext fixtures |

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
