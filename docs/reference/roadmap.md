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

## Other deferred work

Smaller items surfaced by persona reviews but not yet promoted to their
own design doc are tracked in
[`business-section-deferred.md`](./business-section-deferred.md) (the
2026-04-28 `/business/**` review punch list).
