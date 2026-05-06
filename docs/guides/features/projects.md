# Projects

Work you track time against. Projects belong to an team and optionally to a customer.

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
