# Agent attribution on time entries

When a time entry is started by an automation — a coding agent such as
Claude Code, or an integration — Shyre records who (or what) initiated it
and surfaces that everywhere the entry appears. The human is always the
entry's author: agents act *on your behalf*, so the entry still belongs to
you, bills at your rate, and shows your avatar and name. Attribution is an
additive annotation, never a replacement.

## What you see

- **Bot badge** — every author chip on an agent- or integration-started
  entry gains a Bot icon plus "via Claude Code" (or the agent's label).
  In dense views the text folds into the chip's tooltip: "Started by
  Claude Code on behalf of {name}". This appears consistently across the
  Week, Day, and Log views, the Table view, dashboard recent activity,
  and merged/aggregated rows. A weekly row or merged line containing
  *any* agent-logged minutes carries the badge, and its tooltip uses the
  softer "Includes time started by Claude Code" so a partly-agent row is
  never overstated as fully agent-logged.
- **Running timer** — if the currently running timer was started by an
  agent, the sidebar timer card shows the badge and label so a runaway
  agent timer is visible at a glance. Stop and the `Space` shortcut work
  exactly as for your own timers.
- **Edit form** — an agent-started entry shows read-only meta:
  "Logged by Claude Code · session abc123". Attribution can't be edited
  by anyone (the database refuses changes), so there is no edit control.

## Where it comes from

Attribution is written once, at creation time, by the integration RPCs
introduced with the integrations foundation (SAL-051):

- `started_by_kind` — `user` (default), `agent`, `integration`, or
  `import`. Imported entries (e.g. Harvest) show no badge — they're
  historical data you already own, not live automation.
- `agent_label` — the human-readable agent name, e.g. "Claude Code".
- `started_by_ref` — an opaque session/run reference for audit trails.

All three are display-only: they never affect rates, billability, or
invoice math, and a database trigger makes them immutable after insert.

## Exports

The time-entries CSV export includes a trailing **Source** column:
`user`, `agent (Claude Code)`, `integration (…)`, or `import` — so
agent-logged hours are separable in any spreadsheet without new tooling.
The column is last so existing positional templates keep working, and
values pass through the standard CSV formula-injection defense.

## Related

- [Time tracking](time-tracking.md)
- Design rationale: `docs/reference/multi-stream-timers.md` (Option B,
  Phase 1 — agents are attributed; humans stay the author).
