# Time tracking

Time is the core daily surface. All of it lives at `/time-entries` (the old `/timer` route redirects here).

## Authorship

Every time entry in Shyre is owned by the user who logged it, and that ownership is always visible. Wherever a time entry appears — the weekly grid, the day list, running-timer card, reports page, dashboard, customer / project detail pages, invoice line items, and the trash view — the author's avatar and display name are rendered next to the entry. That's true whether you're a solo consultant or on a team of twenty.

This is non-negotiable in the code (see `CLAUDE.md` → "Time-entry authorship — MANDATORY"): a surface that displays time entries without the author is a bug, not a design choice. The primitive is the `<Avatar>` component from `@theshyre/ui`, paired with `user_profiles.display_name`.

## The running-timer card

The top of the Time page is always either a running timer or a start form.

- **Running**: large mono elapsed time, project + description, red **Stop** button. Press `Space` anywhere on the page to stop (when no input is focused).
- **Stopped**: inline start form with project select (autofocused), description, **Start** button. Press `Space` to start. Recent-project chips appear below — click to pre-fill the form.

A compact mirror of this timer also lives in the sidebar — it keeps ticking no matter what page you're on.

## Week grid

Seven columns Monday–Sunday, each showing every entry for that day plus a daily total. An orange "today" strip highlights the current day.

Week navigation:
- `←` / `→` prev / next week
- `T` jump to this week
- `W` focuses the week date picker

Pick billable-only with the filter chip at the top. Choose a category filter if your projects use them.

## Editing an entry

Click a card. It expands in place into an edit form.

- Change project, description, category, billable flag, GitHub issue, start/end times (if the project uses timestamps), or duration (if it's a duration-only project).
- `Cmd+Enter` saves. `Esc` or **Cancel** collapses without saving.
- The kebab menu (⋮) has **Edit**, **Duplicate**, **Delete**.

**Duplicate** is a one-click "start this again". It creates a new entry with the same project/description/billable/github_issue, `start_time = now()`, `end_time = null`. If a timer is already running, it's stopped first.

## Deleting, undoing, and the Trash

### Row delete from the weekly timesheet

Each row in the weekly timesheet has a trash button on the right. What it does depends on whether the row has real data:

- **Blank row you just added** (never typed anything): clicking the trash removes the row immediately — it was never saved.
- **Row with any saved entries**: clicking the trash expands an inline prompt: `Type delete to confirm`. Type `delete` (case-insensitive) and the red **Delete** button unlocks. This matches the "this is destructive" weight of the action even when only one cell has a value — deleting data is deleting data. Press Escape or click ✗ to back out.

Either path is still soft-delete and still produces the Undo toast.

### Undo

When you delete a row, a toast pops up at the bottom of the screen:

> `Entry moved to trash · [Undo]`

Click **Undo** within 10 seconds and every deleted entry in that batch is restored exactly where it was. Press `Esc` to dismiss the toast without undoing.

### The Trash page

If you miss the undo window, the deletion isn't lost — entries are soft-deleted, not hard-deleted. Go to **Trash** (link appears on the Time page when there's anything trashed, count in the badge) or hit `/time-entries/trash` directly.

From there you can:
- **Restore** — puts the entry back and it reappears in the week grid, reports, totals, and unbilled invoice queries.
- **Permanently delete** — inline two-click confirm labelled "forever". This one can't be undone.

Soft-deleted entries are excluded from reports, invoicing, dashboards, exports, and totals until you restore them.

### Per-entry delete (day view / kebab menu)

Deleting a single entry from the kebab menu follows the same rules: soft-delete, Undo toast, recoverable from the Trash page.

### Keyboard nav inside the grid

- **Arrow keys** move focus between cells. Up/Down walks the same day across rows. Left/Right walks the same row across days (only when the cursor is at the start/end of the input so you can still edit text naturally).
- **Enter** commits the current cell and moves focus one row down (Excel-style).
- **N** opens the Add-row picker.

### Autosave indicator

The weekly timesheet autosaves each cell on blur. A "Saving…" / "Saved just now" pill in the top-right of the grid tells you when a save has landed. If a save fails, the pill shows **Save failed** in red — retry by editing the cell again.

## Categories

If the project has a category set attached, you can tag entries. Category is the primary organizing axis for time — more useful than project for "what was I doing last Tuesday?" See [categories](categories.md).

## Templates

Save a combination of project + description + category + billable as a template. Start from a template with one click. See [templates](templates.md).

## Past entries and manual time

Click **Add past entry** or press `N`. Opens an inline form where you set your own start and end (or duration). Handy for entries you forgot, or for entering time from a client meeting while away from the app.

## Duration-only projects

Some projects are configured with `require_timestamps = false`. On those projects:
- The timer still works — you hit start / stop, duration is captured.
- You can also type a raw duration without picking a time. The UI adapts.

This is great for retrospective logging where the exact wall-clock time doesn't matter.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Start or stop the timer (when no input is focused) |
| `N` | Add past entry |
| `W` | Switch to Week view |
| `D` | Switch to Day view |
| `L` | Switch to Log view |
| `T` | Jump to today (Week / Day / Log) |
| `G` | Open the jump-to-date popover |
| `←` / `→` | Previous / next week (in Week view) |
| `Esc` | Collapse an inline edit, close a kebab menu |
| `Cmd+Enter` | Submit an open inline form |

Table view has no single-letter shortcut — click the toggle. `T` is reserved for the higher-frequency "jump to today" action shared by Week / Day / Log.

## Views

Four views live at `/time-entries`, switched via the toggle in the page header or the keyboard shortcuts above:

- **Week** *(default)* — Mon–Sun grid, rows = (project, category, author), cells = day cells. Best surface for authoring time.
- **Day** — single day, vertical list grouped by customer. Best for "what did I do today / yesterday."
- **Log** — chronological scroll across a bounded window (14 days default, 90 max), grouped by day with customer sub-headers. Best for "did I forget anything recently?"
- **Table** — flat list across an arbitrary date range, with description search and invoice-status filter. Designed for admin / bulk operations, not for authoring.

The first three share the time-views parity rule: a UX change to one is evaluated against all three. Table is intentionally exempt — date-range picking and free-text search only make sense on a flat surface.

### Table view (admin / review)

Sidebar → **Time** → toggle to **Table**.

Filters available on this view only:

- **From / To** — pick an explicit date range. Defaults to the last 30 days; capped at 1 year. Use the calendar popovers on each `DateField`.
- **Search descriptions** — case-insensitive substring match on `description`. Debounced 300ms after the last keystroke, or commits immediately on Enter. Escape clears the search.
- **Invoice status** — four chips:
  - **All** — every entry in range
  - **Uninvoiced** — `invoiced = false` (will appear in the Create-invoice preview)
  - **Invoiced** — attached to a Shyre invoice (`invoiced = true` AND `invoice_id` set)
  - **Billed elsewhere** — manually marked as billed in another system (`invoiced = true` AND `invoice_id` is null)

The toolbar filters above the view (Team / Member / Project / Billable) still apply.

A result-count + total-hours strip sits above the table so you know what you're about to bulk-act on. The view caps at 500 rows server-side — if you hit the cap, narrow the date range or add a search term.

Bulk actions on selected rows: **Delete** (typed-`delete` confirm) and **Mark as billed elsewhere** (inline confirm). Both push an Undo toast.

## Limits and known work

- No offline mode yet — if you're on a spotty network, the timer keeps ticking locally but saves won't land until you're back.
- Table view is Phase 1: no sortable columns, no filtered CSV export, no bulk reassign-project yet. See `docs/reference/roadmap.md` for the Phase 2 list.
