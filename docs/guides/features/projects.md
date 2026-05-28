# Projects

Work you track time against. Projects belong to an team and optionally to a customer.

## Project detail page (`/projects/[id]`)

The project detail page is organized as a tabbed surface with a
shared identity header (parent breadcrumb, project name, customer
chip) on top and per-section content below.

| Tab | Route | What's there |
|---|---|---|
| **Overview** | `/projects/[id]` | Budget masthead (period + lifetime + expense totals), sub-projects rollup (when present), recent activity strip (last 5 time entries + last 3 expenses with author chips, each linking out). |
| **Time** | `/projects/[id]/time` | Full time-entry list for the project, time-by-ticket rollup (GitHub / Jira), masthead at the top. |
| **Expenses** | `/projects/[id]/expenses` | Read + add + delete expenses scoped to this project. Edit deep-links to `/business/[id]/expenses?project=<id>` for the full inline editor. |
| **Settings** | `/projects/[id]/settings` | Project details form (name, rate, budget, GitHub, Jira, invoice code, etc.), classification (internal vs client), categories (project-scoped extensions). |
| **History** | `/projects/[id]/history` | Audit trail (owner/admin only). |

The tab strip lives in the layout, so every route shares the same
identity chrome and the tab key cycles through them naturally.

## Creating a project

1. Sidebar → **Projects**
2. Press `N` or click **New project**
3. Pick a customer (or leave blank for an internal project — "Internal R&D", admin time, etc.)
4. Name the project.
5. Set:
   - **Hourly rate** — overrides the customer's default rate if set
   - **Budget hours** — optional; surfaces a warning when you approach it
   - **Status** — `active` / `paused` / `completed` / `archived`
   - **GitHub repo** — `org/repo` format; enables issue autocomplete on time entries
   - **Category set** — optional; attaches a set of categories so entries on this project can be tagged
   - **Require timestamps** — on by default. Turn off for duration-only projects (see below).

## Timestamp vs duration-only projects

- **Timestamps on** (default): time entries have real start and end times. Best for synchronous work.
- **Timestamps off**: entries have a duration only. Best for retrospective logging where wall-clock time doesn't matter.

Switch per project; you can mix in one org.

## Status lifecycle

- `active` — shows in project pickers, dashboard, reports
- `paused` — hidden from pickers; existing entries still visible
- `completed` — hidden from pickers; reportable
- `archived` — hidden from pickers and default reports

Status is advisory; time entries already tied to the project stay intact.

## Sub-projects (phases under an engagement)

A project can be a **sub-project** of another — useful for engagements
that run in phases ("Engagement → Phase 1 / Phase 2 / Phase 3"), or
retainers that need separate budgets per workstream.

To create one, fill in the **New project** form and pick a value for
**Parent project (optional)**. The picker shows up only when:

- you've selected a customer (sub-projects must share their parent's
  customer), and
- there's at least one top-level project under that customer.

### Inheritance — auto-fill from the parent

When you pick a parent, these fields pre-fill from the parent so a
new phase doesn't make you re-type every detail:

- Hourly rate
- Default billable
- GitHub repo
- Invoice code
- Category set
- Require timestamps

You'll see a **"Filled from parent"** hint after picking the parent.
Each field stays editable — type into one to override before saving.
Once you've edited a field, picking a different parent will NOT
clobber your typed value.

The Jira project key inherits silently in the background even though
the field isn't on the form, since sub-projects of an engagement
almost always live under the same Jira project.

Some fields don't inherit on purpose:

- **Name / description** — phase-specific by definition.
- **Budget hours** — copying the parent's budget across every phase
  would be misleading; budgets are per-phase.
- **Customer / internal flag** — already constraint-enforced to
  match the parent.

### Rollup behavior

The parent project's detail page shows a rolled-up totals card (own
work + all children) plus per-child rows with budget burn. Filtering
`/time-entries` or `/reports` by the parent project rolls up to
parent + every child too — see
[sub-project rollup filter](sub-project-rollup-filter.md).

Sub-projects nest one level deep — phase-of-phase isn't allowed.

## Categories

Attach a category set to the project to tag every entry with a category. See [categories](categories.md).

### Switching the category set

A project's category set isn't permanent — you can change it from the
project edit form when the engagement shape changes (e.g. moving from
"Software development" classification to "Consulting Phase 2"). The
switch is non-destructive:

- **Historical entries keep their original category.** The entry row
  still references the original `categories.id`, and the CSV export
  carries both the **Category** and **Category Set** columns so a
  reviewer reading old entries sees the full taxonomy chain even
  after a switch.
- **Editing a historical entry still lets you re-classify it.** The
  picker on the entry-edit form lists the old categories with a
  `(retired)` suffix alongside the new active set, so you can keep
  the original classification or pick a replacement deliberately.
- **New entries can only use the currently-linked set.** If the
  project moved on, new entries should reflect the new shape.

If you need to log a new entry under the OLD set, switch the project
back temporarily — it's one dropdown change, the inverse of the
original switch.

### Project audit trail

Every project edit (rate change, set switch, archive, etc.) writes
an append-only row to `projects_history` with the pre-change state.
Owner/admin can query it via the **View edit history** link in the
project header — the timeline shows each change as a strikethrough
old → new diff, with timestamp + actor. Useful for "who set this
project to non-billable on March 12?" questions without relying on
the single `updated_at` timestamp. Members don't see the link;
the underlying `projects_history` table has owner/admin-only RLS.

## Bulk switching the category set

On `/projects`, multi-select rows and use **Switch category set** in
the bulk strip to apply a new category set to every selected project
in one action. Useful when an engagement evolves and you want to
re-classify a fleet of projects (8 phases of a long retainer, for
instance) without editing each one.

The picker lists every category set the team has access to (system
sets and team-shared sets). Selecting **(no set — clear category)**
unsets the category set on each selected project — entries on those
projects keep their historical categories per the
"Switching the category set" rules above.

The bulk switch fires the `projects_history` audit trigger once per
project, so the change is reconstructable per-project from the audit
trail.

## Recurring budget caps

Beyond the lifetime `budget_hours` ceiling, a project can carry a
**recurring per-period cap** — useful for retainer engagements where
the contract guarantees a fixed amount of work each month / week /
quarter, independent of the lifetime total.

### Configuring

On the project edit form, expand the **Recurring budget cap**
disclosure to set:

- **Period** — `weekly`, `monthly`, or `quarterly`. Calendar-based,
  in your timezone (April 1 → April 30 for monthly; Mon → Sun for
  weekly; Q1 = Jan-Mar etc. for quarterly).
- **Hours per period** — soft cap on hours.
- **Dollars per period** — soft cap on revenue (hours × rate). One
  cap, both caps, or neither — your call.
- **Carryover** — only **Use it or lose it** is enforced today.
  The other modes (within-quarter, lifetime pool) are placeholders
  for future contract types.
- **Alert at (%)** — show a warning banner on the project page
  when the period burn meets this threshold. Leave blank for no
  banner. The bar's color (green / yellow / red) is anchored at
  fixed 80% / 100% breakpoints regardless of your alert threshold,
  so a yellow bar always means the same thing across projects;
  the threshold renders as a small tick mark on the bar.

Editing budget fields requires the same permission as editing the
project's hourly rate — they reveal the same shape of commercial
information (retainer size, dollar caps).

### Reading the masthead

When a recurring cap is set, the project detail page shows a
stacked **Budget masthead** at the top:

- **This [week / month / quarter]** — current-period burn, with
  optional dollar caption and a "Last period: 28h" sub-line for
  context after a fresh rollover.
- **Lifetime** — overall hours-vs-budget ceiling.
- **Expenses footer** — when the project has any expenses logged
  against it, a small per-currency caption (`$X in expenses`) sits
  at the bottom of the masthead card. Per the money-UI rule no
  cross-currency sums, so multi-currency projects stack one line
  per currency. The footer is hidden when there are no expenses;
  the masthead itself only renders when there's a budget signal to
  show, so a budget-less project surfaces its expenses purely
  through the Expenses section below.

Each bar is icon + text + numeric + colored fill (three channels).
A tick mark on the bar indicates the alert threshold when set.

### When the period rolls over

At calendar boundaries (midnight in your TZ on the 1st of the
month, etc.), the period bar resets to 0 cleanly. **No carryover**
in v1: any unused hours from the prior period don't roll forward.
The "Last period" sub-line keeps the prior number visible for a
few days after rollover so the change isn't a surprise.

### Period close + reconciliation

Budget burn is computed live from `time_entries` — it reflects
whatever the database currently says about that month. **If you
need April's number to be stable after May 1**, use
[period locks](period-locks.md) on the relevant
team — once April is locked, no one can edit April time entries,
which means the April column can't drift later. Without a period
lock, a soft-delete or edit on an April entry on May 6 will shift
the April masthead retroactively.

The CSV export carries the project's current `Period Budget Type`,
`Period Budget Hours Cap`, and `Period Budget Dollars Cap` columns
on every row, so an exported CSV can be reconciled against the
in-app burn bar months later regardless of changes since.

### `/projects` list

When at least one visible project carries a recurring period, a
**Period burn** column appears on `/projects`. Each row shows the
current-period burn % (color-anchored at the same 80% / 100%
breakpoints as the masthead) so an owner can scan an 8-project
retainer book and spot trouble in one glance.

## "Apply parent's settings" on a sub-project

When editing a sub-project, an **Apply [Parent name]'s settings**
affordance sits below the parent picker. Click it to retroactively
overwrite the inheritable fields (rate, repo, Jira key, invoice
code, default-billable, require-timestamps) with the parent's
*current* values — useful when the parent's settings have evolved
and you want a phase to catch up without re-typing each field.

Two-stage confirm: click → review the warning → **Apply**. Cancel
at any time. The button is hidden until you save the project (so
you don't accidentally apply settings from a parent you've just
selected but not committed to).

## Expenses on a project

Below the budget masthead, the project detail page hosts an
**Expenses** section — read + add + delete in place, with a deep
link out to the main expenses surface for everything else.

- **Add expense** — the same form as
  `/business/[id]/expenses`, but the **Project** picker is hidden
  and the new row is pinned to the current project's id. The team
  is also locked to the project's team (the FK on `expenses.team_id`
  wouldn't accept a cross-team write anyway). All other fields —
  date, amount, category, vendor, description, notes, billable —
  behave exactly as on the main page; see
  [Expenses → Adding an expense](expenses.md#adding-an-expense)
  for the field reference.

- **Display** — date, author (avatar + name, per the
  time-entry-authorship rule), category chip, vendor, amount,
  Billable badge. Sorted newest-first by `incurred_on`. The author
  column is non-conditional — every expense shows who logged it,
  same as time entries.

- **Edit** — each row has an external-link icon that opens
  `/business/[id]/expenses?project=<projectId>` so you land on the
  main expenses surface filtered to this project. Inline editing
  lives on that surface to keep this page focused on adding and
  scanning. Delete is inline on the project page (same confirm +
  Undo-toast flow as the main page).

- **Permissions** — the existing expense RLS still applies:
  - **Owners and admins** see every expense logged against the
    project's team. They can delete any row.
  - **Members** see only the expenses they authored. The section
    shows a small "showing expenses you can see" hint when the
    viewer is a non-admin, so a thinned list doesn't read as
    broken. They can delete only their own rows.

- **Masthead integration** — the lifetime expense total per
  currency is summarized in the budget masthead's footer (see
  [Reading the masthead](#reading-the-masthead)).

The section is **out of scope for invoicing** in this phase — the
`billable` checkbox marks intent, but expenses don't yet land on
invoices automatically. Invoice generation still pulls only time
entries; a follow-up phase will extend `invoice_line_items` and
`createInvoiceAction` to include billable expenses too.

## GitHub integration

Set `github_repo` on the project (format `owner/name`). When logging time, you can pick a GitHub issue from autocomplete — the issue number is saved with the entry for later reporting.

## Archiving

Archive from the project detail page. Non-destructive; data remains for historical reports. Unarchive any time.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `N` | New project |
| `/` | Focus the search field |

## Related

- [Customers](customers.md)
- [Time tracking](time-tracking.md)
- [Categories](categories.md)
