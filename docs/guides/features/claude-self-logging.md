# Let Claude log its own time

Shyre's Claude Code time tracking has **two layers**:

1. **The deterministic hook — a backstop.** The [Claude Code hooks kit](claude-code-hooks-kit.md) logs the raw session window on `SessionEnd`. No model judgment, always fires — but it produces one coarse entry per session with a generic description and **no category**.
2. **Claude logging its own time — the intent layer.** A short instruction, set once globally, tells Claude to log a *categorized, concise, invoice-ready* entry when it finishes a unit of work. This is what turns "some hours got tracked" into "the right hours, on the right project, in the right category, with a description you'd put in front of a client."

The two coexist safely: `POST /api/v1/entries` refuses an entry that **overlaps** one you already have (`409`). So if Claude self-logged a session's window, the hook's whole-session post is refused and drops silently — granular self-logged entries win; the coarse backstop only fills in when Claude didn't log.

## The global convention

Put this in your **global** `~/.claude/CLAUDE.md` so every Claude Code session (in any Shyre-mapped repo) follows it:

> **Shyre — log your own dev time (with a category).** When you finish a substantial unit of work (a shipped PR, a completed feature) in a git repo whose `origin` remote is listed in `~/.claude/shyre-projects.json`, log that time to Shyre.
> **Local override:** if the repo's own `CLAUDE.md` / `AGENTS.md` defines its own time-logging convention, that wins.
> 1. `GET /api/v1/projects` (Bearer `$SHYRE_API_KEY`) → match this repo's `origin` remote to the map / to a project's `github_repo`, and read that project's `categories`.
> 2. `POST /api/v1/entries` with `project_id`, ISO-8601 `start_time`/`end_time` **with offset** (the actual work window), a **concise one-line** `description`, the best-fit `category_id` (dev/code → Engineering), and a **per-unit** `idempotency_key` (see the gotcha below).
> 3. Do **not** set `billable` — the server forces internal projects non-billable.
> Skip silently if `$SHYRE_API_KEY` is unset or the repo is unmapped; never let logging block or fail the actual work.

That's the convention Shyre ships with. Tune the wording to taste — the pieces that matter are: a **concise** description, a **category**, a **per-unit** idempotency key, and **not** setting `billable`.

## Verify it's actually working

Every failure in this pipeline is **silent by design** — the hook's `curl -sf … || true` swallows every error, and a missing key or unmapped repo never even makes a request. The fastest way to confirm the chain is live — token reaching Claude's environment, kill switch on, token valid — is to ask Claude:

> "Call `GET /api/v1/me` and tell me the team + token expiry, then `GET /api/v1/projects` and list them."

If `me` returns your team and a future `expires_at`, the whole chain works. A `401` means the token isn't in Claude's environment — the #1 setup slip; check the exact startup file for your shell in [Storing your key](integrations-api.md#storing-your-key). A `404` on a later log means the mapped project is on a different team than the token.

## The idempotency-key gotcha

Idempotency is keyed on `(token, idempotency_key)` — **not** on the project. If you use the bare branch or PR number as the key, two units of work on the same branch collide: the second `POST` returns the *first* entry as a replay and **silently logs nothing for the second**. Always make the key **per unit**, e.g. `<branch>:<short-slug>`.

## One repo, several Shyre projects

The `~/.claude/shyre-projects.json` map is **one project per repo**, and the deterministic hook can only log the whole session to that single project — it has no way to split a session across projects. **That's a limit of the hook, not of the API.**

The self-logging layer has no such limit: `list_projects` returns *all* your team's projects (each with its own `github_repo` + `categories`), and `POST /entries` accepts any of them. So for a monorepo that maps to several projects, add a **repo-local `AGENTS.md`** (which overrides the global convention) that names the projects **by id** and says which paths map to which:

```markdown
## Time logging (overrides ~/.claude/CLAUDE.md)
This repo maps to THREE Shyre projects — log each unit to the one it belongs to.
- Frontend → 1111…  (apps/web/**, packages/ui/**)
- Backend  → 2222…  (services/api/**, packages/db/**)
- Infra    → 3333…  (infra/**, .github/**)
Mixed session → one entry PER project touched, each with its own window.
idempotency_key = "<branch>:<frontend|backend|infra>"   # per-unit, not just the branch
Category: each project's own categories from GET /api/v1/projects (dev → Engineering).
```

Claude then attributes the finished work by the paths it changed and posts one entry per project, each with a non-overlapping window. Pin the project **ids** (stable), not names. Leave the repo mapped to its most-common project in `shyre-projects.json` (or unmapped) — either way the `SessionEnd` backstop is auto-suppressed by the overlap guard the moment Claude self-logs.

## See also

- [Claude Code hooks kit](claude-code-hooks-kit.md) — the deterministic backstop this builds on.
- [API reference (REST + MCP)](integrations-api.md) — the endpoints Claude calls.
- [Reviewing agent time on invoices](agent-time-review.md) — the human gate before these hours reach a client.
