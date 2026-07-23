# Integrations API (REST + MCP)

External applications — first among them Claude Code — can read project context, start/stop timers, and log completed time entries against your Shyre account. Two transports share one implementation:

- **REST** — `https://shyre.malcom.io/api/v1/…`
- **MCP** — `https://shyre.malcom.io/api/mcp` (Streamable HTTP)

Both authenticate with a **personal access token** (PAT, `shyre_pat_…`) sent as a bearer token in the `Authorization` header — the only place a token is ever accepted (never a query parameter, cookie, or body field). Security design and threat model: `docs/security/SECURITY_AUDIT_LOG.md` SAL-051.

## Prerequisites

1. **Team kill switch** — integrations are default-OFF per team. A team owner/admin must enable `integrations_enabled` in team settings before any token works. Flipping it off later dead-ends every existing token instantly.
2. **A personal access token** — bound to one (user, team) at creation, shown exactly once, 90-day default expiry (1-year max), revocable but never deletable (audit forensics). Mint your own at **Settings → Integrations** (`/settings/integrations`) — see [Integration tokens](integration-tokens.md).

Token properties that shape API behavior:

- **Scopes** — `context:read`, `timer:read`, `timer:write`, `entries:write` (all four by default). A call outside the token's scopes returns `403 { "error": "forbidden" }`.
- **Default billable** — chosen at token creation; applies to every entry the token creates unless `billable` is passed explicitly on `/api/v1/entries`.
- **Rate limit** — 120 requests per token per fixed 60-second window → `429 { "error": "rate_limited" }`. (Fixed window, not rolling — bursts can straddle a window boundary.)

Every call — success or failure — is appended to the team-visible `integration_events` audit log, and every entry created through the API carries immutable attribution (`started_by_kind: "agent"`, the agent label, the session ref, the creating token).

## REST endpoint reference

All endpoints require `Authorization: Bearer shyre_pat_…`. Responses are JSON. Failures use a stable envelope `{ "error": "<code>" }` — all authentication failures (missing header, malformed, unknown, revoked, expired, kill switch off, membership removed) return the identical `401 { "error": "unauthorized" }` body, deliberately indistinguishable. Conflicts add a human-readable `message` so the caller knows why the write was refused.

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/me` | `context:read` | Token introspection: user, team, scopes, expiry |
| GET | `/api/v1/projects` | `context:read` | Active + paused projects (id, name, status, customer, categories + default) — no rates, structurally |
| GET | `/api/v1/timer` | `timer:read` | Currently running entry, or `null` |
| POST | `/api/v1/timer/start` | `timer:write` | Start a timer; `409` if ANY timer is already running |
| POST | `/api/v1/timer/stop` | `timer:write` | Stop the running timer (agent-started only, unless `force`) |
| POST | `/api/v1/entries` | `entries:write` | **Preferred**: log a completed block of work |

Request bodies are strict: unknown keys are rejected with `400`.

### GET /api/v1/me

```bash
curl -H "Authorization: Bearer $SHYRE_API_KEY" https://shyre.malcom.io/api/v1/me
```

```json
{
  "user_id": "…", "display_name": "Marcus",
  "team_id": "…", "team_name": "Malcom LLC",
  "token_name": "claude-code-laptop",
  "scopes": ["context:read", "timer:read", "timer:write", "entries:write"],
  "default_billable": true,
  "expires_at": "2026-10-16T00:00:00+00:00"
}
```

### GET /api/v1/projects

```bash
curl -H "Authorization: Bearer $SHYRE_API_KEY" https://shyre.malcom.io/api/v1/projects
```

Returns an array of projects, each `{ id, name, status, is_internal, customer_id, customer_name, github_repo, default_category_id, categories }`. `github_repo` (e.g. `owner/repo`) lets an agent match projects to the repo it's working in — filter the list to `github_repo == your git remote origin` to find this repo's project(s), which is how a monorepo mapped to several projects narrows the candidate set. `categories` is the project's **effective** set (its base category set plus any project-scoped extensions) as `{ id, name, color, is_default }` — pass one of those ids as `category_id` on `POST /api/v1/entries`, or omit it to inherit the project's `default_category_id`. Rates are structurally unreachable on this surface.

### GET /api/v1/timer

```bash
curl -H "Authorization: Bearer $SHYRE_API_KEY" https://shyre.malcom.io/api/v1/timer
```

Returns the running entry (`{ id, project_id, project_name, description, start_time, started_by_kind, agent_label, started_by_ref }`) or `null`.

### POST /api/v1/timer/start

```bash
curl -X POST https://shyre.malcom.io/api/v1/timer/start \
  -H "Authorization: Bearer $SHYRE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "description": "Pairing on the release",
    "session_ref": "claude-session-abc123",
    "idempotency_key": "start-abc123-1"
  }'
```

Optional: `description`, `agent_label` (defaults to `Claude Code`), `session_ref`, `idempotency_key`. Returns the created entry. **`409 { "error": "conflict", "message": "timer already running" }` whenever any timer is running — an agent never displaces the human's timer.** `404` if the project isn't in the token's team.

### POST /api/v1/timer/stop

```bash
curl -X POST https://shyre.malcom.io/api/v1/timer/stop \
  -H "Authorization: Bearer $SHYRE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "description": "Shipped the integrations docs page" }'
```

All fields optional: `description` (upgrades the entry with the outcome — use it), `force` (also stop a *human*-started timer; only when the user explicitly asked). Without `force`, a human-started timer returns `409`; no running timer returns `404`.

### POST /api/v1/entries — the preferred path

```bash
curl -X POST https://shyre.malcom.io/api/v1/entries \
  -H "Authorization: Bearer $SHYRE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "start_time": "2026-07-18T14:00:00Z",
    "end_time": "2026-07-18T15:30:00Z",
    "description": "Implemented the /api/v1 surface: wrapper, six routes, parity test",
    "session_ref": "claude-session-abc123",
    "idempotency_key": "log-abc123-1"
  }'
```

Required: `project_id`, `start_time`/`end_time` (ISO 8601 **with timezone**), `description` (≥ 8 meaningful characters). Optional: `agent_label`, `session_ref`, `idempotency_key`, `billable` (overrides the token default), `category_id` (a category from the project's `categories` in `list_projects`; when omitted the project's default category is applied, so agent-logged time still lands categorized).

Refusals — every non-auth refusal carries a `message` naming the rule it hit:

- `400` when the range is inverted, longer than 24h, ends more than 5 minutes in the future (small clock skew is tolerated), starts more than a year in the past (a wrong-year sanity bound, not a policy window), or when `category_id` doesn't belong to the project;
- `403` when the entry is dated in a **locked accounting period** — closed books refuse backdated writes;
- `409` when it overlaps one of the user's existing entries **on the same project** (cross-project parallel work is allowed).

**There is no fixed backdating window.** Backfills of any age are accepted up to the one-year sanity bound. The controls against history tampering are period locks (lock a period after closing its books and the API refuses writes into it), the immutable agent attribution on every entry, and the agent-time review surface — not an age cap. Note that period locks are opt-in: on a team that never locks periods, backdated agent writes are constrained only by attribution and review — lock closed months to make refusal automatic.

### Idempotency

`idempotency_key` (≤ 128 chars) dedupes retries on the two creating endpoints — `timer/start` and `entries`: replaying the same key on the same token returns the originally created entry instead of double-logging. `timer/stop` takes no idempotency key (stopping an already-stopped timer is a plain `404 not_found`).

## MCP server (Claude Code and friends)

The MCP endpoint exposes five tools backed by the exact same service layer as REST: `get_current_timer`, `list_projects`, `start_timer`, `stop_timer`, `log_time_entry`.

One-liner setup:

```bash
claude mcp add shyre --transport http https://shyre.malcom.io/api/mcp \
  --header "Authorization: Bearer ${SHYRE_API_KEY}"
```

(The same command, pre-filled with your instance's origin, is copyable from **Settings → Integrations**.) The endpoint speaks Streamable HTTP: `GET`/`POST` for the protocol plus `DELETE` for session teardown.

Or the equivalent project-scoped `.mcp.json`:

```json
{
  "mcpServers": {
    "shyre": {
      "type": "http",
      "url": "https://shyre.malcom.io/api/mcp",
      "headers": {
        "Authorization": "Bearer ${SHYRE_API_KEY}"
      }
    }
  }
}
```

### Storing your key

Both snippets above reference `${SHYRE_API_KEY}` rather than the raw token on purpose — the secret should live in an environment variable, never inline. The recommended setup:

1. **Durable copy → password manager.** The token is shown [exactly once](integration-tokens.md#the-token-is-shown-once). Save it to 1Password / Bitwarden / your keychain so you can retrieve it later without revoking and reissuing.
2. **Runtime copy → the `SHYRE_API_KEY` env var.** `${SHYRE_API_KEY}` resolves from the **environment of the process that reads it**, so the key has to actually be in that process's environment. How you put it there depends on the tool — and for the main case, Claude Code, `.env.local` is *not* it.

   **Claude Code (the primary case).** Both the session hooks and the MCP server read `${SHYRE_API_KEY}` from the environment Claude Code was **launched with**. Claude Code does **not** read a `.env.local` file — so the key must be exported into your shell *before* you start `claude`:

   - **Shell profile (recommended — set it once).** Export `SHYRE_API_KEY` from the startup file of whatever shell launches `claude`, so every session inherits it. The token is *your identity* — the same for every project — so it belongs in your global environment, not a file in each repo. Add it to the file your interactive shell actually reads:

     | Shell / OS | Where | Line |
     | --- | --- | --- |
     | **zsh** (macOS default) | `~/.zshrc` | `export SHYRE_API_KEY="shyre_pat_…"` |
     | **bash** | `~/.bashrc` | `export SHYRE_API_KEY="shyre_pat_…"` |
     | **bash on macOS** | login shells read `~/.bash_profile`, not `~/.bashrc` — put it there (or `source ~/.bashrc` from it) | `export SHYRE_API_KEY="shyre_pat_…"` |
     | **Windows — PowerShell** | `setx` (persists as a user env var; reopen the terminal) | `setx SHYRE_API_KEY "shyre_pat_…"` |
     | **Windows — Git Bash / WSL** | follow the **bash** row | `export SHYRE_API_KEY="shyre_pat_…"` |

     Open a new terminal after editing so the value is loaded, then launch `claude` from it. (Which Shyre *project* a session logs to is a separate, per-repo concern the [hooks kit](claude-code-hooks-kit.md) resolves from a central map — you don't set that per repo either.)

   - **`direnv` + a git-ignored `.envrc` (only if you need per-repo isolation).** If a particular repo must use a *different* token (a separate account or team), put `export SHYRE_API_KEY=…` in a `.envrc` there and `direnv allow`; it overrides the global one whenever you're in that repo. Commit a `.envrc.example` with a placeholder so teammates know what to set. For a single account, you don't need this.

   A bare `.env.local` won't work for Claude Code either way — nothing loads it into Claude Code's environment, so `${SHYRE_API_KEY}` stays unresolved and every call 401s.

   **Your own app or scripts.** If instead you're calling the REST API from a framework that loads `.env.local` into its own process (Next.js, etc.), *then* the `.env` convention fits: commit a **`.env.example`** with `SHYRE_API_KEY=` (placeholder — documents the requirement, holds no secret), keep the real value in a git-ignored **`.env.local`**. For a bare `curl`, `source .env.local` first.

   > `SHYRE_API_KEY` lives in **your consuming project's** environment, never Shyre's. Shyre issues and validates these tokens and never reads a `SHYRE_API_KEY` env var, so it does not belong in Shyre's own `.env.example`.

Two forms, one nuance worth knowing:

- **`claude mcp add …` (CLI):** your *shell* expands `${SHYRE_API_KEY}` before Claude Code stores the server, so the **resolved token is written into your local `~/.claude.json`**. That file is private to you and never committed, so it's fine — but the literal token does sit at rest there.
- **`.mcp.json`:** Claude Code expands `${SHYRE_API_KEY}` at *load time*, so the file only ever holds the reference. The token never lands in a config file (or your shell history). Prefer this if you want the secret to stay only in your env var / password manager.

### Why a project-scoped `.mcp.json` is safe for a personal token

`.mcp.json` is **project scope** — it's typically committed and shared with everyone who has the repo. A Shyre token, though, is bound to *one user and team* and is secret, so it might seem wrong to put it in a shared file. The `${SHYRE_API_KEY}` reference is what makes it correct: the committed file describes only the **connection shape** (URL, transport, header format), while each teammate supplies their **own** `SHYRE_API_KEY` in their own environment and so authenticates as themselves. Nothing personal is shared.

- Committing `.mcp.json` with the **literal** token would leak your personal, team-scoped credential to everyone with repo access — don't. Keep it a `${…}` reference.
- If you're the only one on the repo, you don't need `.mcp.json` at all — the `claude mcp add` **local scope** (private to you) is simpler. Reach for the committed project scope only when you want teammates to get the Shyre connection automatically on clone.

### Recommended pattern: log on completion

Prefer **`log_time_entry` after the work is done** over `start_timer`/`stop_timer`:

- No orphaned timers when a session dies mid-task.
- No idle inflation while an agent waits on builds or reviews.
- The description is written *after* the outcome is known, so entries read like changelog lines, not intentions.
- `start_timer` will refuse (`409`) whenever a timer is already running — by design it can never displace the human's timer.

The tool descriptions steer agents the same way, so a well-behaved agent picks this up without prompting.

## Error envelope

| HTTP | Body | Meaning |
| --- | --- | --- |
| 400 | `{ "error": "invalid_request", "issues": […] }` | Body failed validation (Zod) or the RPC refused the input (`issues` only on Zod failures) |
| 401 | `{ "error": "unauthorized" }` | One uniform body for every auth failure — no oracle |
| 403 | `{ "error": "forbidden" }` | Token lacks the required scope |
| 404 | `{ "error": "not_found" }` | Unknown project (or no running timer on stop) |
| 409 | `{ "error": "conflict", "message": "…" }` | Timer already running / human-started timer / overlapping entries |
| 429 | `{ "error": "rate_limited" }` | Over 120 requests/minute on this token |
| 500 | `{ "error": "internal" }` | Unexpected failure — logged for admin triage |

MCP tools return the same information as tool results (`isError: true` with `{ error, message }` JSON) instead of HTTP statuses.

## Operational notes

- Middleware exempts `/api/v1` and `/api/mcp` from session auth (exact-segment matching — `/api/v10` still redirects); bearer verification inside the shared route wrapper is the only gate, enforced by a source-parity test.
- Team owners/admins can see and revoke every token writing into their team; removing a member from the team dead-ends their tokens on the next call.
- All API failures land in the admin error log (`/admin/errors`) with the token's display prefix only — raw tokens never appear in logs or responses.
