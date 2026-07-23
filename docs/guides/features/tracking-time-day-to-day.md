# Day-to-day: what to tell Claude

Once a repo is mapped ([Quick guide](integrations-quickstart.md)), tracking your
time is mostly **automatic**. This is the daily loop — and the exact things to
say to Claude when you want to steer it.

## The loop

With your repo in `~/.claude/shyre-projects.json`, you don't have to do anything:
as Claude finishes a chunk of work it logs a categorized, one-line entry to the
mapped project, and the [hooks kit](claude-code-hooks-kit.md) backstops your
active session time. It lands in **Time** with
[agent attribution](agent-attribution.md), ready for
[review at invoice time](agent-time-review.md).

You only need a prompt when you want to **steer** it — log now, target a
different project, or check and fix what landed.

## What to say to Claude

**Confirm the pipe is live** — do this once, right after setup:

> Call `GET /api/v1/me` and tell me my team and token expiry, then list my projects.

If that returns your team and a future expiry, the whole chain works. (A `401`
means the token isn't in Claude's environment — the #1 setup slip.)

**Log the current session now:**

> Log my time for this session to Shyre.

**Put the time on a specific project** — when the repo maps to several (see
below):

> Log the last 90 minutes to the "Modernize the platform" project.

**Re-point the repo** — you've moved on to a different deliverable:

> From now on, track this repo against "Basic dependency upgrades."

**Check where you stand:**

> How much have I tracked to AVDR this week, by project?

**Fix a mis-filed entry:**

> That last entry should be on "Replace Gen 1 → 2," not Modernize — move it.

Claude drives all of these through the [REST API](integrations-api.md); none of
it needs the UI.

## One repo, several deliverables

A single repo often maps to more than one Shyre project — e.g. an app that was
converted from a proposal into **Basic / Modernize / Replace** deliverables. The
repo→project map holds **one** default, so:

- **Just tell Claude the deliverable** at the top of a session ("this session is
  Modernize") and it logs there. Ask it to **re-point the repo** at that
  deliverable too, so the automatic backstop stays in sync and nothing
  double-counts.
- Or, if the deliverables split cleanly — by folder, or by the *kind* of work —
  drop a repo-local `AGENTS.md` that names each project **by id** and says which
  work belongs to which. Claude then attributes each unit automatically. Full
  pattern in
  [Let Claude log its own time → One repo, several Shyre projects](claude-self-logging.md#one-repo-several-shyre-projects).

> **Fixed-bid tip.** Point the map at the **deliverable** you're working, not the
> hourly account umbrella above it — that's what feeds each fixed-bid project's
> "did we hit the number?" view. Time on a fixed-bid project is tracked, never
> hourly-billed.

## Onboard a new repo

Two lines of setup, once per repo:

1. Add it to `~/.claude/shyre-projects.json`: `"owner/repo": "project-id"`. The
   `owner/repo` is your `git remote get-url origin` with the host and `.git`
   stripped (GitHub **and** Bitbucket both work — `git@bitbucket.org:acme/app.git`
   → `acme/app`). Get the project id from `GET /api/v1/projects`, or just ask
   Claude to list them.
2. Make sure `SHYRE_API_KEY` is exported in your shell — it's the same token for
   every repo ([Quick guide](integrations-quickstart.md)).

That's the on-switch: an [unmapped repo logs nothing, silently](claude-self-logging.md).

## See also

- [Quick guide](integrations-quickstart.md) — first-time setup.
- [Let Claude log its own time](claude-self-logging.md) — the convention + gotchas.
- [Reviewing agent time on invoices](agent-time-review.md) — the human gate before billing.
