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
entry via `POST /api/v1/entries` for the session's **active** time — the sum
of the gaps between heartbeats, dropping any gap longer than the idle cap
(`SHYRE_IDLE_CAP_SECONDS`, default 15 min). So a session left open over lunch
(or overnight) bills only the minutes actually worked, not the wall-clock
span. No orphaned timers; a dead session simply never logs.

> **Platform note.** The logger below is a **POSIX shell script** (bash) — it runs on macOS, Linux, WSL, and Git Bash. On **native Windows**, use the PowerShell port in [Windows (native PowerShell)](#windows-native-powershell) instead (same behavior, same map). The env-var and paths in this section assume a POSIX shell.

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

> **What isn't built yet — one project per repo.** The map is a single `project_id` per `owner/repo`, and the hook logs the whole session to it; there is no sub-path or per-directory routing. If one repo (e.g. a monorepo) spans several Shyre projects, the hook can't split a session across them — use [Let Claude log its own time](claude-self-logging.md) with a repo-local `AGENTS.md` to route each unit of work to the right project.

`~/.claude/hooks/shyre-session.sh`:

```bash
#!/usr/bin/env bash
# Shyre deterministic session logger (global install). Set SHYRE_API_KEY
# once in your shell; the project is resolved per-repo from
# ~/.claude/shyre-projects.json. Unmapped repos are skipped. Never blocks
# or fails a session — any missing dep/credential/mapping is a clean no-op.
SHYRE_API_URL="${SHYRE_API_URL:-https://shyre.malcom.io}"
MAP="$HOME/.claude/shyre-projects.json"
# Gaps between activity beats longer than this count as idle and are NOT billed.
IDLE_CAP_SECONDS="${SHYRE_IDLE_CAP_SECONDS:-900}"
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
    PROJECT="$(head -1 "$STATE")"
    # ACTIVE time, not wall-clock: sum the gaps between activity beats, dropping
    # any longer than IDLE_CAP_SECONDS (session left idle). start = session
    # start, end = start + active — a session left open for hours bills only the
    # time actually worked.
    SPAN="$(sed -n '2,$p' "$STATE" | jq -Rrn --argjson cap "$IDLE_CAP_SECONDS" '
      [inputs | fromdateiso8601] as $t | ($t | length) as $n
      | if $n < 2 then empty
        else ([range(1; $n) | ($t[.] - $t[.-1]) | select(. <= $cap)] | add // 0) as $active
          | if $active < 60 then empty
            else "\($t[0]|todateiso8601) \($t[0] + $active|todateiso8601)" end
        end' 2>/dev/null)"
    rm -f "$STATE"
    [ -n "$PROJECT" ] || exit 0                                 # repo not mapped: skip
    [ -n "$SPAN" ] || exit 0                                    # <60s active: skip
    START="${SPAN%% *}"; END="${SPAN##* }"
    [ -n "${SHYRE_API_KEY:-}" ] || exit 0                       # no token: no-op
    curl -sf -m 10 -X POST "$SHYRE_API_URL/api/v1/entries" \
      -H "Authorization: Bearer $SHYRE_API_KEY" -H "Content-Type: application/json" \
      -d "$(jq -n --arg p "$PROJECT" --arg s "$START" --arg e "$END" --arg r "$SESSION_ID" \
        '{project_id:$p, start_time:$s, end_time:$e,
          description:"Claude Code session — active time (idle gaps excluded); see transcript",
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

## Windows (native PowerShell)

On native Windows (no WSL / Git Bash) the bash logger can't run — use this PowerShell port instead. Same behavior, and it reads the **same** `~/.claude/shyre-projects.json` map (`$HOME` resolves to your user profile on Windows, so the same `owner/repo → project id` entries apply).

Set the token once with `setx` — it persists as a user environment variable; **open a new terminal afterward** so it's loaded:

```powershell
setx SHYRE_API_KEY "shyre_pat_…"
```

Hooks in `%USERPROFILE%\.claude\settings.json`, invoking the script with `pwsh`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "pwsh -NoProfile -File \"%USERPROFILE%\\.claude\\hooks\\shyre-session.ps1\" start" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "pwsh -NoProfile -File \"%USERPROFILE%\\.claude\\hooks\\shyre-session.ps1\" beat" }] }],
    "SessionEnd":   [{ "hooks": [{ "type": "command", "command": "pwsh -NoProfile -File \"%USERPROFILE%\\.claude\\hooks\\shyre-session.ps1\" end" }] }]
  }
}
```

PowerShell 7 is `pwsh`; for Windows PowerShell 5.1 use `powershell.exe`. If `%USERPROFILE%` isn't expanded in your setup, use the absolute path to the script.

`%USERPROFILE%\.claude\hooks\shyre-session.ps1`:

```powershell
# Shyre deterministic session logger — Windows PowerShell port.
# Mirrors ~/.claude/hooks/shyre-session.sh. Set SHYRE_API_KEY once (setx);
# the project is resolved per-repo from ~/.claude/shyre-projects.json by the
# repo's git remote. Unmapped repos are skipped. Never breaks a session:
# any missing dependency / credential / mapping is a clean no-op.
param([string]$Action)
$ErrorActionPreference = 'SilentlyContinue'

try {
  $apiUrl = if ($env:SHYRE_API_URL) { $env:SHYRE_API_URL } else { 'https://shyre.malcom.io' }
  $map = Join-Path $HOME '.claude/shyre-projects.json'

  $raw = [Console]::In.ReadToEnd()
  if (-not $raw) { exit 0 }
  $payload = $raw | ConvertFrom-Json
  $sessionId = $payload.session_id
  if (-not $sessionId) { exit 0 }
  $cwd = if ($payload.cwd) { $payload.cwd } else { (Get-Location).Path }

  $stateDir = Join-Path ([System.IO.Path]::GetTempPath()) 'shyre-sessions'
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $state = Join-Path $stateDir $sessionId
  $now = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss') + 'Z'

  function Resolve-Project {
    try {
      if (-not (Test-Path $map)) { return '' }
      $remote = & git -C $cwd remote get-url origin 2>$null
      if (-not $remote) { return '' }
      $key = ([string]$remote).Trim() -replace '^git@[^:]+:', '' -replace '^https?://[^/]+/', '' -replace '\.git$', ''
      $m = Get-Content -Raw $map | ConvertFrom-Json
      $val = $m.$key
      if (-not $val) { $val = $m.'_default' }
      if ($val) { return [string]$val } else { return '' }
    } catch { return '' }
  }

  switch ($Action) {
    'start' { Set-Content -Path $state -Value @((Resolve-Project), $now) }   # line 1 = project id (or blank)
    'beat'  {
      if (Test-Path $state) { Add-Content -Path $state -Value $now }
      else { Set-Content -Path $state -Value @((Resolve-Project), $now) }
    }
    'end' {
      if (-not (Test-Path $state)) { exit 0 }
      $lines = @(Get-Content $state)
      Remove-Item -Force $state
      $project = $lines[0]
      if (-not $project) { exit 0 }                          # repo not mapped: skip
      if ($lines.Count -lt 2) { exit 0 }
      # ACTIVE time, not wall-clock: sum gaps between beats, drop any > idle cap.
      $cap = if ($env:SHYRE_IDLE_CAP_SECONDS) { [int]$env:SHYRE_IDLE_CAP_SECONDS } else { 900 }
      $ts = @($lines[1..($lines.Count - 1)] | Where-Object { $_ } | ForEach-Object { [datetimeoffset]::Parse($_) })
      if ($ts.Count -lt 2) { exit 0 }                        # zero-length: skip
      $active = 0.0
      for ($i = 1; $i -lt $ts.Count; $i++) {
        $g = ($ts[$i] - $ts[$i - 1]).TotalSeconds
        if ($g -le $cap) { $active += $g }
      }
      if ($active -lt 60) { exit 0 }                         # <60s active: skip
      $startTs = $ts[0].UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss') + 'Z'
      $endTs   = $ts[0].UtcDateTime.AddSeconds($active).ToString('yyyy-MM-ddTHH:mm:ss') + 'Z'
      if (-not $env:SHYRE_API_KEY) { exit 0 }                # no token: no-op
      $body = @{
        project_id = $project; start_time = $startTs; end_time = $endTs
        description = 'Claude Code session — active time (idle gaps excluded); see transcript'
        agent_label = 'Claude Code'; session_ref = $sessionId; idempotency_key = $sessionId
      } | ConvertTo-Json -Compress
      Invoke-RestMethod -Method Post -Uri "$apiUrl/api/v1/entries" -TimeoutSec 10 `
        -Headers @{ Authorization = "Bearer $($env:SHYRE_API_KEY)" } `
        -ContentType 'application/json' -Body $body | Out-Null   # 409 overlap / errors swallowed
    }
  }
} catch { }
exit 0
```

## Alternative: live timer via start/stop

If you want the running timer visible in Shyre's sidebar while Claude
works, swap `start`/`end` to call `POST /api/v1/timer/start` and
`/api/v1/timer/stop`. Two caveats: `start` returns 409 whenever any timer
is running (agents never displace your timer — decide in the hook whether
to skip or log-on-completion instead), and a hard-killed session leaves
the timer running until you stop it (the entry stays visible in the
sidebar with a Bot badge, so it won't hide for a weekend). The
log-on-completion pattern above avoids both.
