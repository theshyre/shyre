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

`~/.claude/settings.json` (or project `.claude/settings.json`):

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

`~/.claude/hooks/shyre-session.sh`:

```bash
#!/usr/bin/env bash
# Shyre deterministic session logger.
# Requires: SHYRE_API_KEY (a shyre_pat_… token) and SHYRE_PROJECT_ID in the
# environment (set SHYRE_PROJECT_ID per-repo via direnv/.envrc so each
# checkout maps to its Shyre project).
set -euo pipefail
INPUT=$(cat)                                  # hook payload on stdin
SESSION_ID=$(printf '%s' "$INPUT" | jq -r .session_id)
STATE_DIR="${TMPDIR:-/tmp}/shyre-sessions"
STATE="$STATE_DIR/$SESSION_ID"
mkdir -p "$STATE_DIR"

case "${1:-}" in
  start)
    date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE"    # first-activity stamp
    ;;
  beat)
    # Every completed turn refreshes the last-activity stamp. The entry
    # covers first→last activity, so waiting-on-you gaps at the tail
    # never inflate the entry.
    [ -f "$STATE" ] || date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE"
    date -u +%Y-%m-%dT%H:%M:%SZ >> "$STATE"
    ;;
  end)
    [ -f "$STATE" ] || exit 0
    START=$(head -1 "$STATE"); END=$(tail -1 "$STATE"); rm -f "$STATE"
    [ "$START" = "$END" ] && exit 0           # zero-length session: skip
    curl -sf -X POST "https://shyre.malcom.io/api/v1/entries" \
      -H "Authorization: Bearer $SHYRE_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg p "$SHYRE_PROJECT_ID" --arg s "$START" --arg e "$END" --arg r "$SESSION_ID" \
        '{project_id:$p, start_time:$s, end_time:$e,
          description:"Claude Code session (see transcript for detail)",
          agent_label:"Claude Code", session_ref:$r, idempotency_key:$r}')" \
      > /dev/null || true                     # never block session teardown
    ;;
esac
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
