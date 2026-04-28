# Business section — deferred work

Items surfaced by the 2026-04-28 8-agent review of `/business/**` that didn't ship in the immediate sweep. Tracked here so the next person opening the surface knows what's intentionally pending vs. what's a regression.

## Tier 5 — features

### Receipt upload on expenses
**Source:** agency-owner #6.
A real consulting business expects to attach the receipt PDF/JPG to each expense. Today the expense form has vendor + amount + description but no file slot. Implementation: Supabase Storage bucket scoped per team, `expenses.receipt_storage_path` column, signed-URL fetch via a server action so the file inherits the row's RLS. Estimate: 1 day.

### TIN / SSN / W-9 fields on `business_people`
**Source:** bookkeeper #7.
Year-end 1099-NEC requires the contractor's TIN. We have address + employment_type but not TIN, W-9-on-file flag, exempt-payee code, 1099 box. Same shape as `business_identity_private` — split sensitive payroll fields off `business_people` into `business_people_private` with role-gated RLS so EIN access can be logged separately. SAL-008 explicitly deferred this. Estimate: 1.5 days including encryption-at-rest decision and audit trail.

### Period-close handoff report
**Source:** bookkeeper #8.
Closing March means: invoices issued in March + expenses incurred + time logged, broken down by team / customer / category. Right now this is three pages × no shared filter × no single export. Build `/business/[id]/close/[period]` rendering a PDF + CSV with three sections that reconcile to each other. Estimate: 2 days.

### Multi-team period-locks matrix view
**Source:** agency-owner #9.
List view doesn't scale to "is March locked across all 3 teams?". Replace with a small matrix (rows=months × cols=teams × cells=locked/open + locked-by). Estimate: half day.

### Expense filters / search / pagination / bulk operations / CSV export
**Source:** agency-owner #6.
Today /business/[id]/expenses paints every row in one DOM table with no filters / search / pagination. Adopt the same multi-select-table pattern as `/time-entries` plus filter chips (date, category, billable, project, currency, submitter). CSV export already exists for invoices and identity-history; replicate. Estimate: 1 day.

### Expense entry from sidebar (1-click new)
**Source:** solo-consultant #2.
Logging a $50 lunch shouldn't be 3 clicks deep. Add a sidebar entry under Track for "New expense" or surface a global Cmd-N flow. Estimate: half day.

### Identity smart defaults (legal_name from team name, fiscal_year_start = 01-01, entity_type = llc)
**Source:** solo-consultant #1.
Currently the form opens with all six fields blank. Estimate: half day. Skipped from this sweep because solo-vs-agency defaults need a quick read-through with the user.

### State-registration smart defaults
**Source:** solo-consultant #4.
Per-state lookup table (DE annual franchise tax due 6/1, $300; CA $800 minimum; etc.) so the user confirms rather than researches. Estimate: 1 day plus the lookup data (which is the bulk of the work).

### "n=1 business" UX (skip listing, rename "Back to all businesses")
**Source:** solo-consultant #5.
For solos with one shell business the listing screen is one card and "Back to all businesses" is misleading. Either redirect when summaries.length === 1 or rename the breadcrumb to "Business overview." Estimate: 30 min, but design call needed.

### Fiscal-year-aware "this month" / Q1 boundaries
**Source:** bookkeeper #6.
Every "this month" tile across `/business`, `/business/[id]`, and `/business/[id]/expenses` uses calendar month boundaries and ignores `businesses.fiscal_year_start`. A business with `fiscal_year_start = "07-01"` looking at "Q1" wants Jul–Sep; today they get Jan–Mar. Compounding: `time_entries.start_time` (timestamptz) and `expenses.incurred_on` (date) use different month-boundary semantics on the same card. Build `getCurrentFiscalPeriod(businessId)` and route every stat through it; pick one boundary type (UTC midnight at user's TZ vs naive date) and apply to both columns. Estimate: 1 day. Skipped because it changes 4 separate tile renders and needs a UX decision on whether to show "Aug 2026 (FY26 Q2)" or just "Aug 2026."

## Architectural follow-ups

### `*_history` audit pattern divergence
**Source:** platform-architect #2.
Seven tables now use the `*_history` pattern with three orthogonal divergences (FK column name, denormalized scope column, trigger timing). Either consolidate into a generic `audit_log` table or document the contract explicitly in `docs/reference/database-schema.md` and back-rename one column to align. Important to lock the contract before the 8th audited table lands.

### Cross-module table reads
**Source:** platform-architect #1.
Business module reads `time_entries`, `customers`, `expenses` directly. Either introduce platform views or document explicitly in `docs/reference/modules.md` that read-only cross-module reads of platform-shared tables are sanctioned.

### `getBusinessSummary` extraction
**Source:** platform-architect #9.
List page (`/business`) and detail page (`/business/[id]`) duplicate the same shape of stats query (resolve user's teams in this business → sum customers, billable minutes, monthly expenses). Extract to `src/lib/business/queries.ts` before stat #4 lands and forks the logic a third time.

### `user_business_affiliations` consumer
**Source:** platform-architect #6.
Auto-populated on signup; nothing in `src/` reads or edits it. Either ship the consumer (profile page surfacing primary affiliation, People page's "Link to user" dropdown showing home-business badge, bookkeeper 1099 export distinguishing W-2-of-A vs 1099-of-B) or document as deferred so a future engineer doesn't delete the table.

### Modal focus trap (upstream)
**Source:** accessibility-auditor #1.
`@theshyre/ui` Modal moves focus on open and Escape-dismisses but doesn't trap Tab. Tab leaks to the underlying page. Affects every modal in both apps — fix upstream in `theshyre-core/packages/ui/src/Modal.tsx`. Add `aria-labelledby` while there.

### Form `htmlFor` / id wiring
**Source:** accessibility-auditor #8.
Identity / state-registration / people forms render `<label className={labelClass}>` with no `htmlFor`. Largest-volume a11y violation in the section. Either give every field a unique id and wire `htmlFor`, or wrap input inside the label. Plumbing change but tedious — separate sweep.

### Test coverage for split-table identity write
**Source:** qa-tester #4.
`updateBusinessIdentityAction` now writes to two tables; no test asserts both updates happen, or that a torn write between them doesn't leave half-state. Add a unit test (with mocked supabase) that asserts both `update("businesses")` and `update("business_identity_private")` are called when private fields differ, and only the first when they don't.

### Action-layer tests for lock/unlock typed-confirm
**Source:** qa-tester #5.
Trigger-side enforcement is integration-tested in `period-locks.test.ts`. Action-side guards (typed-confirm match, role rejection, malformed period_end) aren't. Add a unit test file for `period-locks/actions.ts`.

### Action-layer tests for `refreshTicketTitleAction`
**Source:** qa-tester #6.
The author-only contract is the load-bearing security gate; needs a unit test covering non-author rejection, missing-link rejection, and the silent-noop fallback when detection finds nothing.

## Items already shipped in this sweep

- SAL-014 (Jira SSRF + auth-gate)
- Period-locks page filters teams to owner|admin (security defense-in-depth)
- Expense soft-delete + Undo + /trash-ready + locked-through banner + author column + Edit/Trash gating
- Period-lock invoice INSERT relax for drafts
- Period-lock invoice line-items + currency in equality check
- Overview tile rebuild (Identity + Period-locks tiles, Customers stat un-linked, fiscal-year follow-up flagged)
- `assertBusinessAdmin` → `validateBusinessAccess` consolidation
- Identity save guard against no-op private writes
- Period-locks expense test category fix
- SAL-012 RLS integration test for the four narrowed surfaces
- A11y sweep: aria-current on sub-nav tabs, accessible cancel-unlock label, Tooltip+aria-label dedup on people history button, Link2Off i18n + always-visible "Not linked" pill, "Mailing address" i18n, TicketChip Jira variant uses semantic tokens
- `projects.jira_project_key` surfaced in `ProjectEditForm`
