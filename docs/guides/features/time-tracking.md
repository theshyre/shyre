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
