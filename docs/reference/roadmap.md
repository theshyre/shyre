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

## Recurring invoices

Solo-persona top quality-of-life ask after the 2026-05-04 audit:
"on a monthly retainer this is repeated copy-paste pain every
month." Today the schema has no `recurrence_rule` or parent-template
column and the new-invoice form has no "repeat monthly" affordance.
Design needs to decide: is recurrence a per-customer setting, a
per-project setting, or a per-invoice template? Affects which entity
owns the cadence + skip-this-month + amount-override semantics. Tax
implications: stored amounts vs computed-from-time-entries — the
latter still needs a running-period anchor. Expected scope:

- New `invoice_recurrence_rules` table with `customer_id` /
  `project_id` / `cadence` (`monthly|quarterly|annual`) /
  `next_run_on` / `template_invoice_id` / `paused_at`.
- pg_cron daily sweep generates draft invoices on the run date,
  pulling unbilled entries from the period or copying static
  amounts from the template.
- UI: "Make recurring" toggle on the invoice composer; recurrence
  hub at `/invoices/recurring`; per-customer indicator on the
  customer page.
- Pairs naturally with Messaging Phase 2 (auto-reminders) because
  both want a pg_cron job and both touch the same drafts.

Defers because Phase 1 of recurring is a multi-week design + data
model + UX surface, and the manual "duplicate last month's
invoice" flow gets the user 80% of the way without the cron tax.

## Multi-jurisdiction tax + per-line tax

Bookkeeper-flagged in the 2026-05-04 audit (#9) and partially
overlapping with the 2026-05-01 invoice review's "Tax pre/post-
discount toggle." Today `invoices.tax_rate NUMERIC(5,2)` is one
number on the invoice header; `invoice_line_items` has no tax
columns. That works for a single-state SaaS consultant with one
rate; it breaks for:

- Multi-jurisdiction US sales tax where different lines (product
  vs service) carry different rates.
- Tax-exempt customers (no per-customer flag today).
- Reverse-charge VAT for cross-border EU contracting.
- EU VAT MOSS where the rate depends on customer country.
- Mixed-rate states where a single invoice straddles two rates.

Schema additions needed: `invoices.tax_jurisdiction` (enum or
text), `invoice_line_items.tax_rate` + `tax_amount` (per-line
override), `customers.tax_exempt` (boolean) + `customers.tax_id`
(VAT/EIN), `team_settings.tax_collected_report` aggregator.
Reports: tax-collected-by-jurisdiction surface for sales-tax
filing; today there's no report at all.

Pairs with the year-end 1099 + W-9 capture work that the persona
review keeps surfacing.

## FX rate capture for multi-currency invoices

Bookkeeper finding #10. The `expenses` and `invoices` schemas
already carry `currency`, and the page/CSV layers are
currency-aware after batch 3 (SAL-payment-currency-safety). What's
missing: when a Canadian customer pays a USD invoice in CAD, or a
USD-based business pays a EUR vendor, **the books need the FX rate
that was effective at the transaction date** so historical reports
stay correct. Today the foreign amount can be stored but its
USD-equivalent at posting time is not.

Schema: `invoice_payments.fx_to_invoice_rate` + `fx_captured_at`,
`expenses.fx_to_team_currency_rate` + `fx_captured_at`. Source:
fxratesapi.com / openexchangerates.org daily snapshot stored in a
new `fx_rates` table; lookup at write time. Reports: `/reports`
revenue / expense aggregations need to translate per-row to the
team's reporting currency.

Defers because USD-only solo consultants don't feel the pain and
the architecture decision (which FX provider, who pays for the
data, how to backfill historical rows) is non-trivial.

## Schedule C category alignment

Bookkeeper finding #8. Current expense categories
(`software | hardware | subscriptions | travel | meals | office |
professional_services | fees | other`) read like a SaaS-consultant
mental model, not a Schedule C / IRS one. Bookkeeper hits "other"
for ~30% of every monthly expense set, then hand-recategorizes
during reconciliation. Missing buckets: advertising, contract
labor, insurance (not health), legal/professional services
(distinct from generic professional_services), rent, repairs,
supplies, taxes/licenses, utilities, depreciation, vehicle.

Trade-off: rebuilding the taxonomy mid-year breaks every saved
filter / pivot in QuickBooks. Approach: add the missing
categories alongside (don't rename existing ones), default new
expenses to a Schedule-C-aligned set, leave a one-time bulk
recategorize tool for the bookkeeper to migrate. Pairs with the
"Item Type column on CSV / QuickBooks export" follow-up so the
QB import recognizes the GL bucket per row.

Defers because solo users with their own CPA workflow don't feel
the pain and the migration design is bookkeeper-led.

## Mobile timer + on-the-go time entry

Solo-persona finding from the 2026-05-04 audit. The mobile sidebar
ships (batch 2 — slide-in drawer below `md`), but the timer + new-
entry surfaces aren't optimized for thumb input. Specifically:

- The week-grid timesheet doesn't have a usable mobile mode — it
  collapses to a long horizontal scroll instead of a stacked
  per-day card view.
- The running-timer pill is tiny on a small screen; tapping the
  Stop affordance is fiddly.
- The new-entry form's project / category / duration row uses a
  12-column grid that wraps awkwardly under 360px.
- No service worker / IndexedDB queue for offline timer state. A
  user starting a timer on a plane sees a server error mid-session.

Each is incremental. The biggest single win is a per-day stacked
mobile view of `/time-entries` with one big "running now" CTA at
the top. Service worker / offline queue is a bigger bet.

Defers because the desktop daily-loop user (the primary persona)
doesn't feel the pain.

## Audit follow-ups (from the 2026-05-04 multi-persona audit)

Smaller items pulled out of the audit campaign that closed on
2026-05-05 across 16 commits. All non-blocking but worth tracking:

- **`[id]` route smoke-test seeds.** The Playwright route-smoke
  spec (`e2e/route-smoke.spec.ts`) covers 18 static dashboard
  routes. The dynamic `[id]` routes (`/customers/[id]`,
  `/projects/[id]`, `/invoices/[id]`, `/invoices/[id]/send`,
  `/teams/[id]`, `/business/[businessId]/**`) need fixture data
  the global-setup doesn't seed today. Add a `seed-fixture-data`
  helper that creates one each of customer / project / invoice /
  business under the e2e fixture user, then extend the smoke
  spec to cover those routes too.

- **Form-label `htmlFor` sweep — long tail.** Batches 9 / 12 / 14
  wired ~80 forms / ~400 fields. ~22 residual occurrences across
  13 files use non-conforming patterns the perl pass couldn't
  match: conditional row-zero labels in multi-row tables (split-
  expense-modal, line-item composers), labels using a different
  i18n shape (`tf(...)` in running-timer-card), labels with
  `<Icon />` children. Each needs hand-handling — either an
  htmlFor that points to one of N inputs (wrong) or a switch to
  `<fieldset>/<legend>`. Pick a per-case fix when touching the
  surrounding code.

- **Promote status-text tokens to `@theshyre/design-tokens`.**
  Batch 15 added `--success-text` / `--warning-text` /
  `--error-text` / `--info-text` locally in `globals.css` to
  unblock WCAG AA contrast. Promote them upstream so Liv +
  future consumers inherit the same fix without copying CSS.
  See `docs/reference/promotion-candidates.md`.

- **Configure CI staging Supabase secrets.** The `integration`
  and `e2e` jobs in `.github/workflows/ci.yml` auto-skip when
  `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY` /
  `STAGING_SUPABASE_SERVICE_ROLE_KEY` /
  `STAGING_EMAIL_KEY_ENCRYPTION_KEY` aren't set. Once
  configured in GitHub repo settings, the existing 13-file RLS
  suite + 8-file Playwright suite + the new invoices / outbox
  RLS specs (batch 16) all run on every PR. No code change
  needed; just provision.

- **Drop residual unwired-label files.** See "Form-label sweep —
  long tail" above; once those land, add the matching ESLint
  rule that flags `<label className={labelClass}>` without
  `htmlFor` so future regressions catch at lint time.

## Persistent timesheet rows — Phase 2 follow-ups

Phase 1 landed 2026-05-13 (`dc7db2d`): `time_pinned_rows` + `time_team_default_rows`
schema, `stint_active_rows` RPC, Week-view Pin button, Day-view "From
this week" ghost section, team-default admin button, first-render-of-
new-week banner. Open items:

- **Configurable active-row window per user.** Hardcoded to 14 days
  in `src/lib/time/active-rows.ts` (`DEFAULT_ACTIVE_WINDOW_DAYS`).
  Add `user_settings.timesheet_active_window_days` (int, default 14,
  range 7–60) + a Settings → Time tracking control. Plumb through
  `getActiveRows()` and page.tsx's call site. Solo's persona review
  asked for "current OR previous calendar month" as a third option —
  worth exploring once the simpler N-day version is in use.
- **Month-boundary window option.** Variant of the above where the
  window is "this calendar month + previous calendar month." Maps
  to solo billing cadence better than fixed N. Probably belongs as
  a `mode: 'sliding' | 'month'` enum on the user setting rather
  than a second knob.
- **Onboarding affordance for new team members.** Agency-owner
  flagged that a new hire on Tuesday lands on an empty Week view if
  the team has no defaults set. Either: (a) a "Use team defaults"
  step in the invite-accept flow, or (b) a "Copy from [member]"
  one-shot import.
- **Pin × Delete two-step interaction.** Per UX persona review:
  deleting a pinned row should not unpin it — the pin is the
  "I want this slot" signal independent of the entries. Add a
  secondary "Unpin and delete entries" action inside the existing
  `InlineDeleteRowConfirm` for pinned rows.
- **Bulk pin/unpin from Pattern-A overlay strip.** Pinning multiple
  rows at once when the user has just landed on a fresh week.
- **Audit logging.** Team-default pin/unpin should write to the
  team audit log so an owner can see "Alice set Acme Redesign as
  team default on May 3" weeks later. Personal pins are
  per-user-private and don't need audit.
- **Sub-project pin inheritance.** Today pinning a parent project
  doesn't auto-pin its sub-projects. Decide whether the
  `include_descendants` semantics are worth adding (additive
  column on `time_pinned_rows`).

## WIP report (work-in-progress, blocked on rate-at-entry snapshots)

**What it answers:** "How much logged-but-unbilled labor do I have on the
books right now?" Per-project (or per-customer / per-member) rollup of
`SUM(duration_hours × rate)` across every billable time entry where
`invoice_id IS NULL AND deleted_at IS NULL`.

Surfaces in `/reports` as the Friday-before-invoicing view bookkeeper
+ agency-owner both ranked #1 (see persona reviews 2026-05-12, project
budget visualization). Solo's same-day kill-feature is a row-level
"Generate invoice" affordance on overrun rows (see Phase 1 — budget
overruns table — for the immediate version).

**Why deferred:** Shyre stores ONE current `hourly_rate` per project.
A mid-engagement rate bump retroactively multiplies historical entries
at the new rate, overstating WIP. The bookkeeper persona flagged this
as the same class of bug as the budget-$-drift problem — anywhere we
display "$X spent" derived from `current_rate × historical_hours`, the
number moves under the user's feet on a rate edit, with no audit trail.

**Prerequisite:** snapshot `rate_at_entry` (and currency) onto every
`time_entries` row at insert/update time. Migration adds two columns,
the create / start-timer / duplicate / update actions stamp from the
project's effective rate at the moment, and every burn / WIP query
shifts from `entries.duration × project.hourly_rate` to
`entries.duration × entries.rate_at_entry`. Once that lands the WIP
report (and the dollar-burn numbers throughout the masthead + the
projects list) become honest.

Same prereq unlocks: an accurate "$ spent of $ budget" caption in the
masthead/list, a true rate-realization report, and CSV exports that
won't disagree across re-runs after a rate edit.

## Sub-projects — Phase C and beyond

Phases A and B (parent_project_id schema + rollup card + leaf-only
picker + invoice filter) shipped late April / early May. Phase C
(rollup filters on `/time-entries` and `/reports`) and Phase D
(field inheritance on sub-project creation — rate, repo, invoice
code, Jira key, category set, default-billable, require-timestamps
pre-filled from the parent) shipped 2026-05-05. Bulk reparenting,
invoice rendering of hierarchy, deeper-than-1-level nesting, and
rate cascade are explicitly deferred. Full breakdown:
[`sub-projects-roadmap.md`](./sub-projects-roadmap.md).

## Table view — Phase 2 follow-ups

Phase 1 landed 2026-05-14: 4th view on `/time-entries`, flat list
sorted `start_time` DESC, date-range + description search +
tri-state invoiced filter, server cap at 500 rows, reuses the
existing multi-select strip (delete + mark-billed-elsewhere).

Open items from the persona reviews (bookkeeper / agency-owner /
solo-consultant on 2026-05-14):

- **Sortable columns.** Today rows are server-ordered DESC by
  `start_time`. Add client-side toggleable sort on duration, billable,
  invoice number, customer. UX persona's recommendation: only enable
  sort in flat mode; once a group-by-day toggle exists (see below),
  sort gets scoped to the active grouping.
- **Customer as a first-class column.** Currently rendered inside
  the project cell via CustomerChip. Promote to its own sortable /
  filterable column. Needed for "all entries on Acme regardless of
  sub-project" review.
- **Filtered CSV export.** Existing global Export button is "dump
  everything in your scope." Add an "Export filtered" button on the
  Table view that respects the active filters, with row count + total
  hours + total $ printed on the button itself. Bookkeeper's gate
  for trust ("if the screen says 47 entries / 38.5h, the export
  produces the same.").
- **Tri-state invoiced filter disambiguation.** Today's chips work
  but `Invoiced` vs `Billed elsewhere` share an icon; bookkeeper
  asked for visually distinct row-level affordances too (an icon
  next to invoice number when present; a different chip for
  manually-marked).
- **Bulk reassign project.** Highest agency-owner ask. Destructive
  semantics (rewrites which customer / project the entry rolls
  into); needs typed-name confirm + Undo toast that restores the
  original project_id. Server action must enforce same-team between
  source and dest.
- **Bulk set billable.** Lower-risk version of the above — flips
  the billable flag on selected rows. Same Undo pattern.
- **Period-lock interaction.** When a selection includes rows
  inside a locked period, bulk actions must skip them and report
  the skip count in the result toast. Server enforces; UI surfaces.
- **Rate snapshot column.** Blocked on the `rate_at_entry`
  migration noted under "WIP / rate-realization." Once rates are
  snapshotted on entries, expose as a column + sort + filter
  ("entries logged at rates > $X"). Until then, deriving from
  `project.hourly_rate × duration` is dishonest and we don't
  render it.
- **Edited-after-invoiced badge.** Surface a chip on rows whose
  `updated_at > invoiced_at`. Audit-trail signal for the
  bookkeeper. Requires `invoiced_at` column (today only `invoice_id`
  is stored).
- **Member role gating.** Today the view is visible to every team
  member. Agency-owner persona argued for `isTeamAdmin` gating so
  members can't see all-team entries via this surface. Reasonable
  but not urgent in the solo / small-agency reality; revisit when
  multi-member teams become common.
- **Group-by toggle.** UX persona's pivot — would let the same
  view serve both "flat sortable" and "grouped by day / customer /
  member" mental models without forking into a separate route.

## Other deferred work

Smaller items surfaced by persona reviews but not yet promoted to their
own design doc are tracked in
[`business-section-deferred.md`](./business-section-deferred.md) (the
2026-04-28 `/business/**` review punch list).
