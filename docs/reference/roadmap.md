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

## Other deferred work

Smaller items surfaced by persona reviews but not yet promoted to their
own design doc are tracked in
[`business-section-deferred.md`](./business-section-deferred.md) (the
2026-04-28 `/business/**` review punch list).
