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

## Invoice PDF / web detail follow-ups (from 2026-05-02 three-persona review)

Pulled out of the post-payment-terms PDF rewrite (UX, Bookkeeper,
Solo). All non-blocking but worth tracking:

- **Currency locale.** `Intl.NumberFormat` is hard-coded to `en-US`
  in `InvoicePDF.tsx`. A EUR or GBP invoice renders `€1,234.56` in
  US style instead of locale-correct `1.234,56 €`. Pull locale from
  team_settings; fall back to `en-US` for USD. Bookkeeper-flagged.
- **Locale-aware date format.** `formatPdfDate` is hard-coded to
  `MM/DD/YYYY`. UK / EU clients receive `04/05/2026` and read it
  as 4 May. Same locale source as the currency fix. Solo-flagged.
- **Remit-to / payment instructions.** First-time clients receive
  Shyre's PDF and have to email back asking "where do I send the
  check / wire?" Add a structured "Payment" block (ACH / check
  mailing / online pay link) to team_settings; render above or
  beside Notes. Solo-flagged as the biggest credibility miss vs
  Harvest's Stripe pay-link.
- **PO number field.** Mid-market AP teams reject invoices without
  a PO reference. Add `invoices.client_po_number` (per-invoice) +
  optional `customers.default_po_number`. Solo-flagged.
- **Tax ID / EIN / VAT line on the From block.** Required for
  1099 / W-9 reconciliation in January; without it expect a
  follow-up email every year-end. Add `team_settings.tax_id` (free
  text). Solo-flagged.
- **`Item Type` column on CSV / QuickBooks export.** Don't render
  on the PDF, but the export must carry the type so QB / Xero map
  lines to GL accounts (Service vs Product vs Expense). Default
  `Service` for time-entry-derived; `Expense` once reimbursable
  expenses ship. Bookkeeper-flagged.
- **Discount GL category enum** — separate from this round's
  parentheses fix. Free-text `discount_reason` won't map to GL
  accounts; add `discount_category` enum (promotional / early-pay
  / write-off / goodwill).
- **Tax pre/post-discount toggle.** Hardcoded to tax-after-discount
  is wrong for ~30% of US states. Per-team setting.
- **Mid-market polish:** `formatRateForLabel` hardcodes `$`,
  breaks for non-USD invoices; `discountRate` may render as
  `10.00%` — trim trailing zeros.
- **`void status` code smell** in `InvoicePDF.tsx`. Either render a
  DRAFT / VOID footer now or drop the prop. Platform-architect.

## Messaging — Phase 2 / 3

Email-invoice Phase 1 (manual Send Invoice with audit trail + PDF +
Resend BYO key + verified domain + signature + daily cap + webhook
status updates) shipped 2026-05-03. Follow-up phases:

- **Resend automation.** Today the user signs up at resend.com,
  creates an API key, sets up the webhook in Resend's dashboard,
  and pastes the signing secret into Shyre. Shyre then writes the
  secret to Vercel via the deploy-automation page. A future
  iteration would have Shyre call Resend's API to provision the
  webhook + verify the domain on the user's behalf — they'd just
  paste a Resend API key once.
- **Encrypt instance_deploy_config.api_token.** Today RLS-only.
  Phase 2 wraps under the master key (same pattern as the
  team-scoped secrets after SAL-018). Defers because the bootstrap
  UX flips the chicken-and-egg in awkward ways.
- **Phase 1.5 — magic link to hosted invoice page.** Bookkeeper
  flagged that some AP systems strip attachments. The send body
  already includes `%invoice_url%`; the hosted page (`/i/<token>`
  or similar) doesn't exist yet. Render-only view, no auth, signed
  short-lived token.
- **Phase 2 — auto-reminders.** pg_cron-driven, per-team
  `auto_reminders_enabled` flag, per-invoice opt-out, T-5 pre-due
  reminder, "3 days late + every 7 days after" default, cap-3
  reminders, auto-pause when invoice marks paid / void / partial.
  Webhook-driven status (`bounced_at`) suppresses sends.
- **Phase 3 — thank-you-on-payment.** Bookkeeper wants to skip
  (AP teams auto-archive); revisit after Phase 2 data shows whether
  the manual-send rate matters.
- **Retroactive github_token plaintext drop.** Phase 1 added the
  encrypted column alongside; Phase 2 migrates the read path then
  drops the plaintext column in a separate PR per CLAUDE.md's
  two-PR rule.
- **Per-customer signature override.** Solo: "I want a different
  sign-off for Pierce vs Acme." Defer until two-customer pain
  appears.
- **Provider abstraction realized.** Postmark / SES / SendGrid each
  drop into `src/lib/messaging/providers/`. Today only Resend.

## Credential expiration — Phase 2 (proactive reminders)

Phase 1 (in-app surfaces) shipped 2026-05-01: every credential
Shyre stores (Vercel API token, Resend API key, GitHub PAT, Jira
API token) carries a rotate-by date, every form autofills today
+ 365 days when a fresh secret is saved without a date, the
dashboard renders an `<ExpiringCredentialsBanner />` at T-30 / T-7
/ T-0 / overdue, and `/system/credentials` lists the full set in
one place. Source of truth for the scan lives in
`src/lib/credentials/scan.ts`.

Phase 2 layers on out-of-app reminders so the user is warned even
when they aren't logged in:

- **pg_cron daily sweep** that calls `scanCredentials()` and
  emits an admin email per item entering the `warning` /
  `critical` / `expired` band. Same Resend send path the invoice
  reminders will use, with deduping so the same credential sends
  at most once per band-transition.
- **Per-credential snooze.** "Got it, remind me in 30 days"
  button that bumps `expires_at` forward without confirming the
  rotation actually happened. Captured separately from
  `last_rotated_at` so the audit log doesn't lie.
- **Calendar feed (`/system/credentials.ics`)** the admin can
  subscribe to from Google Calendar / iCal so the rotate-by date
  shows in their normal weekly planning.
- **Slack / webhook notifier (optional).** Same scan hooked into
  a generic outbound webhook for teams that prefer Slack to
  email; mirrors the existing receipt-ingestion webhook surface.

Defers because Phase 1 already removes the "Marcus has no idea
his Vercel token expires Friday" failure mode, and the cron path
piggybacks cleanly on the Phase 2 invoice-reminder cron once
that lands.

## Other deferred work

Smaller items surfaced by persona reviews but not yet promoted to their
own design doc are tracked in
[`business-section-deferred.md`](./business-section-deferred.md) (the
2026-04-28 `/business/**` review punch list).
