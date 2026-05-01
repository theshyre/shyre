# Roadmap — planned features

> Living index of features that have been scoped, named by stakeholders, or
> deferred from a current sprint but should not get lost. Not promises, not
> dates — just "we know we want this and here's what we know about it."
>
> This file is an **index**. Each entry is a one-paragraph description plus
> a link to the detailed design doc (or the deferred-work bucket). Move
> entries OUT when shipped (link to the feature guide instead) or when
> explicitly dropped (note why).

## Expenses — receipt + email ingestion

Forward a receipt email, drop a receipt PDF/image, or snap a phone photo
of a paper receipt — and have Shyre auto-create a draft expense for the
user to review and confirm. Solves the "expense happened but isn't in
the books yet" gap that tax-time bookkeeping otherwise has to reconstruct
from a Gmail search and a wallet pile. Five-persona review completed
2026-04-29; full design including data model, security model, phasing,
and out-of-scope decisions lives in
[`expense-receipt-ingestion.md`](./expense-receipt-ingestion.md).

## Time — Unified Time view (running log)

Replace the current `Day | Week` toggle on `/time-entries` with a
date-banded vertical scrolling log: today at the top, prior days
flowing downward, jump-to-date control, sticky filter bar, swim-lane
mode when more than one author is visible. Log replaces Day; Week stays
as the invoicing-prep grid. Eight-persona review completed 2026-04-30;
full design including query strategy, RLS deep-scroll integration test
plan, period-lock interaction, accessibility model, phasing, and
out-of-scope decisions lives in [`unified-time.md`](./unified-time.md).

## Work Orchestration — request → plan → AI → review → deploy

A new `orchestrate` module that manages a change end-to-end across
external systems (GitHub, Linear/Jira, Vercel/Amplify, Claude Code) and
threads time + cost + invoice line items through every transition. Owns
the state machine and audit trail; never replaces the issue tracker,
the IDE, or the deploy system. The killer artifact: one row showing
`AVDR-1247 · 2.5h logged · $375 billable · PR #482 merged · deployed
14:22` — only Shyre knows the time + billing. Eight-persona review
completed 2026-04-30. Threat model is a precondition; full design
including data model, secret-vault model, prompt-injection containment,
adapter pattern, runner choice, accessibility, phasing, and out-of-scope
decisions lives in [`work-orchestration.md`](./work-orchestration.md).

## Paste-shape normalization sweep

Apply the GitHub-repo paste normalizer pattern (commit `fe56355`) to
every other URL-shaped input where users paste from the address bar.
Known candidates: `user_settings.jira_base_url` (currently rejects
non-`https://` but stores trailing slashes / query strings / paths
verbatim), business website, customer website, avatar URLs, and any
GitHub username field that's not the canonical repo. Same silent-
breakage class — the value gets stored verbatim, then a downstream
URL builder concatenates and produces a malformed link. Pattern:
trim, strip protocol/host where canonical, drop trailing fragments,
validate against a tight regex, throw inline on garbage. Mirror
`src/lib/projects/normalize.ts` for each field; co-locate tests.

## Invoice flow follow-ups (from 2026-05-01 four-persona review)

Smaller items pulled out of the new-invoice review (UX, A11y,
Bookkeeper, Solo) that aren't blocking but are worth tracking:

- **Override `period_start` / `period_end`** independent of included
  entry dates. Today the period is inferred from min/max which
  doesn't always match the contractual billing period (e.g. "April
  2026" vs "Apr 2 – Apr 28"). Bookkeeper-blocking at audit time.
  Add a collapsed "Override billing period" disclosure.
- **DRY the rate cascade.** The same project → customer → member →
  team-default cascade lives in `new/page.tsx` and `actions.ts`. If
  they ever drift, preview total ≠ posted total. Extract to one
  shared resolver imported by both.
- **Fiscal-period span warning.** When "All uninvoiced" or a custom
  range crosses a quarter or tax-year boundary, surface a soft
  warning so a Q1-close sweep doesn't accidentally pull in Q2 work.
- **Discount GL category.** `discount_reason` is free text; add a
  `discount_category` enum (promotional / early-pay / write-off /
  goodwill) so QuickBooks/Xero exports map cleanly.
- **Tax pre/post-discount toggle.** Currently hardcoded to tax-after-
  discount. ~30% of US states tax pre-discount; add a per-team
  setting.
- **Open-draft hint.** When "Since last invoice" anchor would skip
  work because of a long-lived draft, surface a "There's an open
  draft for {customer}" hint.
- **A11y: arrow-key nav on radiogroups.** Both the range presets and
  the grouping cards are `role="radiogroup"` but lack arrow-key
  navigation between siblings. WAI-ARIA radiogroup requires a single
  tab stop with arrows. Same fix on `<PaymentTermsField>`.
- **A11y + i18n: `<DateField>` follow-ups.** Calendar dialog needs
  a focus trap (`role="dialog"` implies one); aria-modal missing;
  click-outside doesn't return focus to the trigger. Hard-coded
  English strings ("Open calendar", weekday/month names, cell
  aria-labels) violate the project's i18n rule. These touch
  `@theshyre/ui` and should land via the cross-repo promotion PR
  (see `docs/reference/promotion-candidates.md`).

## Other deferred work

Smaller items surfaced by persona reviews but not yet promoted to their
own design doc are tracked in
[`business-section-deferred.md`](./business-section-deferred.md) (the
2026-04-28 `/business/**` review punch list).
