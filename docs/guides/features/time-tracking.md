# Time tracking

Time is the core daily surface. All of it lives at `/time-entries` (the old `/timer` route redirects here).

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
| `W` | Focus the week date picker |
| `←` / `→` | Previous / next week |
| `T` | Jump to this week |
| `Esc` | Collapse an inline edit, close a kebab menu |
| `Cmd+Enter` | Submit an open inline form |

## Limits and known work

- No offline mode yet — if you're on a spotty network, the timer keeps ticking locally but saves won't land until you're back.
- No bulk edit across multiple entries yet.
