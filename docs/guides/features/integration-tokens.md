# Integration tokens

Personal access tokens (PATs) let external tools — coding agents, scripts, MCP clients — read your project context and log time on your behalf through Shyre's API. This guide covers **managing tokens** at **Settings → Integrations** (`/settings/integrations`). The API itself (endpoints, scopes in depth, request/response shapes) is documented in the [Integrations API guide](integrations-api.md).

The page is **scoped to one team at a time** (each token is bound to a single user + team pair). If you belong to multiple teams, team pills at the top switch the view — the kill switch, token list, and activity log all reflect the selected team.

## The team kill switch — off by default

Integrations are **disabled by default** for every team. Until a team **owner or admin** enables them, nothing outside Shyre can read or write the team's data — token creation is blocked, and any previously created token is refused on every API call.

- **Owner / admin**: the Integrations page shows the team's current state (Enabled / Disabled) with an inline toggle.
- **Member**: you'll see the disabled state with a note to ask your team owner or an admin.

Turning the switch **off** again is instant and absolute: every existing token for the team stops working on its next API call. Nothing is deleted — flipping it back on restores un-revoked, un-expired tokens.

## Creating a token

With integrations enabled, use **New token** (keyboard shortcut: `N`):

1. **Name** — required; pick something you'll recognize later ("Claude Code on my laptop").
2. **Expiry** — 30, 90 (default), 180, or 365 days. Every token expires; one year is the hard maximum.
3. **Billable default** — a **one-time choice per token**: time entries logged through this token land as *billable* or *non-billable* so you don't clean them up entry-by-entry. (The API may still override per entry.)
4. **Scopes** — currently every token gets all four scopes (`context:read`, `timer:read`, `timer:write`, `entries:write`). A scope picker may come later.

### The token is shown once

After creation the raw token (`shyre_pat_…`) appears **exactly once** in a copy-to-clipboard box. Shyre stores only a hash — once you dismiss the box, nobody (including Shyre) can show it again. If you lose it, revoke it and create a new one.

Before you dismiss the box:

- **Save it to your password manager** (1Password, Bitwarden, your OS keychain, …). This is your one durable copy — the token is a secret, bound to *you* and this team, and grants whatever scopes you selected. Treat it like a password.
- **Then set it as the `SHYRE_API_KEY` environment variable** for the tool that will use it — never paste the raw token onto a command line or into a file that might be committed. The [Integrations API guide](integrations-api.md#storing-your-key) covers exactly where to put it (shell profile, a git-ignored `.env`, or `.mcp.json` with a `${SHYRE_API_KEY}` reference) and the trade-offs of each.

## The token list

Each token shows its name, display prefix (`shyre_pat_ab34cd…`), scopes, billable default (the **New entries** column: "Billable" / "Non-billable"), created / expires dates, **last used** ("Never" until its first API call), and a status badge: **Active**, **Expired**, or **Revoked**.

### Who sees what

- Everyone sees and manages **their own** tokens.
- Team **owners and admins** also see **every member's tokens** for the team, grouped under each member's avatar and name, and can revoke any of them.

## Revoking a token

**Revoke** asks for a one-click inline confirmation and takes effect immediately — integrations using the token stop working on their next request. Revocation is permanent (tokens are never deleted, so the audit trail stays intact); create a new token to reconnect a tool.

Tokens also die automatically when:

- they **expire**;
- the owner **leaves the team**;
- the team's **kill switch is turned off**.

## Recent API activity

The Integrations page shows the last **20** API calls made with visible tokens — action, outcome (OK / Denied / Error), who, and when. Members see their own activity; owners and admins see the whole team's. Every API call is recorded, including refusals, so "what did this token do?" is always answerable.

## Connecting a tool

The page includes a copyable `claude mcp add` one-liner for connecting Claude Code. Endpoint details and the full API reference are in the [Integrations API guide](integrations-api.md).
