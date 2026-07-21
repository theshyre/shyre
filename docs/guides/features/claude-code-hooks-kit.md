# Claude Code hooks kit — deterministic time tracking

The MCP tools (see the integrations API guide) let Claude *decide* to track
time. Hooks make tracking **deterministic**: they fire on session lifecycle
events whether or not the model remembers, following the pattern WakaTime
ships for Claude Code. Use both — hooks guarantee the baseline (something
is always tracked), the MCP tools carry intent ("bill this to the Meridian
project with a real description").

## Recommended setup: log-on-completion via the Stop hook

The most robust pattern does NOT run a live timer at all. Each turn's
`Stop` hook appends a heartbeat locally; `SessionEnd` logs one completed
entry via `POST /api/v1/entries` with the session's actual active window.
No orphaned timers, no idle inflation — a dead session simply never logs
(and the next one does).

> **Platform note.** The logger below is a **POSIX shell script** (bash) — it runs on macOS, Linux, WSL, and Git Bash. On native Windows, run Claude Code under **WSL** or **Git Bash** so the hook can execute (a PowerShell port is a follow-up). The env-var and paths below assume the same POSIX shell.

Set this up **once, globally** — not per repo. Three pieces:

**1. The token, once, in your shell.** Export `SHYRE_API_KEY=shyre_pat_…` from your shell's startup file — `~/.bashrc` for bash, `~/.zshrc` for zsh (`~/.bash_profile` for bash *login* shells on macOS), or `setx` on Windows PowerShell. It's your identity, the same for every project, and Claude Code reads it from the environment it's launched with. The [Storing your key](integrations-api.md#storing-your-key) table lists the exact file per shell/OS; a per-repo `.env.local` won't reach Claude Code.

**2. The hooks, once, in `~/.claude/settings.json`.** Installed here (not a project `.claude/settings.json`) they fire for every session in every repo:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/shyre-session.sh start" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/shyre-session.sh beat" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/shyre-session.sh end" }] }
    ]
  }
}
```

**3. A central repo → project map**, so you never set a project id per repo. The logger resolves the target project from the current repo's git remote. `~/.claude/shyre-projects.json`:

```json
{
  "_note": "Map <owner/repo> (the git remote) to a Shyre project id.",
  "_default": null,
  "your-org/your-repo": "PROJECT_ID_FROM_THE_PROJECT_URL"
}
```

Add a line when you want a repo tracked. **Unmapped repos are skipped** — so personal or throwaway repos never log unless you opt them in. Set `_default` to a project id if you'd rather send unmapped repos to a catch-all instead.

`~/.claude/hooks/shyre-session.sh`:

```bash
#!/usr/bin/env bash
# Shyre deterministic session logger (global install). Set SHYRE_API_KEY
# once in your shell; the project is resolved per-repo from
# ~/.claude/shyre-projects.json. Unmapped repos are skipped. Never blocks
# or fails a session — any missing dep/credential/mapping is a clean no-op.
SHYRE_API_URL="${SHYRE_API_URL:-https://shyre.malcom.io}"
MAP="$HOME/.claude/shyre-projects.json"
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null || true)"
SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -n "$SESSION_ID" ] || exit 0
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"; [ -n "$CWD" ] || CWD="$PWD"
STATE_DIR="${TMPDIR:-/tmp}/shyre-sessions"; STATE="$STATE_DIR/$SESSION_ID"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

resolve_project() {  # repo git remote -> project id from the map (blank if unmapped)
  [ -f "$MAP" ] || return 0
  local remote key
  remote="$(git -C "$CWD" remote get-url origin 2>/dev/null || true)"
  [ -n "$remote" ] || return 0
  key="$(printf '%s' "$remote" | sed -E 's#^git@[^:]+:##; s#^https?://[^/]+/##; s#\.git$##')"
  jq -r --arg k "$key" '.[$k] // ._default // empty' "$MAP" 2>/dev/null
}

case "${1:-}" in
  start) printf '%s\n' "$(resolve_project)" > "$STATE"; printf '%s\n' "$NOW" >> "$STATE" ;;  # line 1 = project id
  beat)  [ -f "$STATE" ] || { printf '%s\n' "$(resolve_project)" > "$STATE"; printf '%s\n' "$NOW" >> "$STATE"; }
         printf '%s\n' "$NOW" >> "$STATE" ;;                    # refresh last-activity
  end)
    [ -f "$STATE" ] || exit 0
    PROJECT="$(head -1 "$STATE")"; START="$(sed -n '2p' "$STATE")"; END="$(tail -1 "$STATE")"; rm -f "$STATE"
    [ -n "$PROJECT" ] || exit 0                                 # repo not mapped: skip
    [ -n "$START" ] && [ "$START" != "$END" ] || exit 0         # zero-length: skip
    [ -n "${SHYRE_API_KEY:-}" ] || exit 0                       # no token: no-op
    curl -sf -m 10 -X POST "$SHYRE_API_URL/api/v1/entries" \
      -H "Authorization: Bearer $SHYRE_API_KEY" -H "Content-Type: application/json" \
      -d "$(jq -n --arg p "$PROJECT" --arg s "$START" --arg e "$END" --arg r "$SESSION_ID" \
        '{project_id:$p, start_time:$s, end_time:$e,
          description:"Claude Code session (see transcript for detail)",
          agent_label:"Claude Code", session_ref:$r, idempotency_key:$r}')" \
      > /dev/null 2>&1 || true                                  # never block teardown
    ;;
esac
exit 0
```

Notes:

- **Idempotency**: `session_ref` doubles as the idempotency key, so a
  retried or double-fired hook can't double-log.
- **Overlap refusal is expected behavior**: if you were driving Claude
  interactively *with your own timer running on the same window*, the API
  returns `409 { "error": "conflict" }` (audit reason `overlaps_existing`
  in the events log) and the session is simply not logged —
  your human entry already covers the time. That's the double-billing
  guard working, not a bug.
- **Better descriptions**: the static description above is the floor. For
  invoice-ready text, ask Claude to log via the MCP `log_time_entry` tool
  at the end of a work block instead — it writes what it actually
  accomplished. When both run, the hook's entry loses the overlap race by
  design (the MCP entry logs first, the hook 409s).
- `SessionEnd` does not fire on hard kills (SIGKILL, power loss). With
  log-on-completion that costs you one session's entry, nothing else — no
  zombie timer to clean up.

## Alternative: live timer via start/stop

If you want the running timer visible in Shyre's sidebar while Claude
works, swap `start`/`end` to call `POST /api/v1/timer/start` and
`/api/v1/timer/stop`. Two caveats: `start` returns 409 whenever any timer
is running (agents never displace your timer — decide in the hook whether
to skip or log-on-completion instead), and a hard-killed session leaves
the timer running until you stop it (the entry stays visible in the
sidebar with a Bot badge, so it won't hide for a weekend). The
log-on-completion pattern above avoids both.
