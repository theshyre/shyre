# Integrations quick guide

Let Claude Code track time on your behalf in under five minutes. For the
full picture see [Setup: tokens & the team switch](integration-tokens.md)
and the rest of the Integrations topic.

## 1. Open Settings → Integrations

`/settings/integrations`. If you belong to more than one team, pick the
team you want this token to act on with the team pills at the top.

## 2. Create a token — and save it

**New token** → name it something you'll recognize later ("Claude Code —
laptop") → copy it immediately. It's shown **once**. Save it to your
**password manager**, then export it **once, globally** as `SHYRE_API_KEY`
from your shell's startup file — `~/.bashrc` (bash), `~/.zshrc` (zsh), or
`setx` on Windows PowerShell. The token is your identity, the same for every
project, so set it once and every `claude` session can use it. (Claude Code
does **not** read `.env.local`; the
[Storing your key](integrations-api.md#storing-your-key) table lists the
exact file per shell/OS, plus the per-repo and own-app cases.)

## 3. Wire it into Claude Code

Point your MCP client at the endpoint with the `SHYRE_API_KEY` reference —
`claude mcp add …` or a project `.mcp.json`, both shown in the
[API reference](integrations-api.md#mcp-server-claude-code-and-friends). Or
install the [Claude Code hooks kit](claude-code-hooks-kit.md) for
deterministic tracking that doesn't depend on the model remembering.

## 4. Track something

Ask Claude to start a timer, or let a hook fire on session start. The entry
shows up in Time like any other — with [agent attribution](agent-attribution.md)
so you always know it was the agent, not you, that logged it.

## 5. Review before you invoice

Agent-tracked time flows straight into the invoice builder — see
[Reviewing agent time on invoices](agent-time-review.md) for what that
looks like at billing time.

## Go deeper

- [Setup: tokens & the team switch](integration-tokens.md)
- [API reference (REST + MCP)](integrations-api.md)
- [Claude Code hooks kit](claude-code-hooks-kit.md)
- [Agent attribution](agent-attribution.md)
- [Reviewing agent time on invoices](agent-time-review.md)
