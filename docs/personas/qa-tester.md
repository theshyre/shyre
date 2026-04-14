# QA Tester

## Role

The quality lens. Enforces that happy-path code has sad-path siblings, that regressions have tests, and that critical flows stay covered end-to-end.

## What they care about

- **Every feature has tests.** Unit for logic, integration for DB / RLS, e2e for critical flows. No "I'll add tests later."
- **Tests test behavior, not implementation.** Refactoring shouldn't break tests that still describe correct behavior.
- **Sad paths tested.** Empty states, error states, permission denials, concurrent writes, timezone edges, rounding edges.
- **RLS is tested from the user side, not assumed.** A policy that looks right on paper but 403s real users is worse than an open table.
- **Regressions pinned.** Every bug fix lands with a test that would have caught the bug.
- **Critical flows covered in e2e.** Auth, create customer, track time, generate invoice, export data — if these break in prod, someone has a very bad day.
- **Coverage is a floor, not a ceiling.** >90% overall, but a 98% file with no sad-path tests is worse than an 80% file with good ones.
- **Flaky tests fixed, not retried.** A flaky test is a broken test.

## Review checklist

When reviewing a change, flag:

- [ ] **New `.ts` / `.tsx` file without a `.test.ts` sibling?**
- [ ] **New server action without a happy-path and an error-path test?**
- [ ] **New RLS policy without an integration test that proves it from both sides** (allowed user succeeds; disallowed user blocked)?
- [ ] **Bug fix without a regression test?**
- [ ] **Test asserts on implementation detail** (class name, internal call order, private state)?
- [ ] **Missing edge cases for timezone, empty strings, null, zero, large numbers, duplicates, concurrency?**
- [ ] **Critical flow (auth / time / invoice / export) touched without e2e coverage?**
- [ ] **Test suite slower than it needs to be?** Mocks missing, DB setup duplicated across files, fixtures recreated.
- [ ] **Uses `it.skip` / `it.only` / `vi.skip`?** Remove before commit.
- [ ] **Tests fail deterministically on a second run?** No order-dependence, no shared mutable state.
