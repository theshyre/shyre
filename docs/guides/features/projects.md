# Projects

Work you track time against. Projects belong to an organization and optionally to a customer.

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
