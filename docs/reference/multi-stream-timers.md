# Multi-stream timers — design exploration

**Status:** Exploration. Nothing here is approved or scheduled. This doc captures the design space, the constraints, and the recommended path so the team can decide once.

**Owner:** marcus@malcom.io.
**Last updated:** 2026-05-11.
**Module:** `stint`.

---

## TL;DR

The literal request — *let one user run multiple concurrent active timers* — is the most expensive and most legally fraught of the available options. Three other framings solve the underlying pain ("track work that happens on multiple projects in parallel, especially AI-agent-driven work") without that risk.

| Option | What it is | Schema delta | Billing risk | Recommendation |
|---|---|---|---|---|
| **A. Pause stack** | One active timer; others paused with elapsed preserved; one-click resume | Trivial (one column or none) | None | **Ship near-term.** Solves the human context-switch pain. |
| **B. Agent-attributed entries** | Mark each entry with what (or who) drove it; agents are authors, not parallel timers for the same human | Small additive (Phase 1: two text columns) → larger if `agents` becomes a first-class entity (Phase 2) | None at Phase 1; manageable at Phase 2 | **Ship Phase 1 next.** Defer Phase 2 until a real customer asks. |
| **C. True concurrent timers per user** | Multiple wall-clock timers running simultaneously for one human | Permissive (no constraint to drop) but high downstream impact | High — directly invites ABA-93-379-style double-billing | **Don't ship.** Revisit only with a customer + signed engagement that requires it. |
| **D. Activity-event timeline on a single parent timer** | One active timer; agents emit events that attach to it; timer closes with a richer history | Sibling `time_entry_events` table, additive | None | **Optional supplement to A.** Decide once the agent-attribution data shape is settled. |

**Recommended sequencing:** Option A → Option B Phase 1 → re-evaluate. Option C is rejected unless externally driven.

A 2026-05-08 prior-art survey found that **no vendor has shipped a direct solution to this problem** — the intersection of parallel AI agents and billable time tracking is white space. That reinforces the conservative recommendation: ship the smallest defensible thing, watch what shakes out, expand only on real customer pressure. See the Prior art section below.

---

## Motivation

Direct quote from the user that prompted this doc:

> "What if I am using an AI agent to work on multiple projects at a given time? How would we track this? Certainly I could just manually do that but I can see a future where this becomes more of a need."

Two distinct pains hide inside that sentence:

1. **Context-switch tax.** When the human starts a new timer, the prior timer's elapsed time and any unsaved description are at risk. This is true today, with or without AI involvement, and is felt every workday.
2. **AI-agent-driven parallel work.** A long-running agent finishes a PR on Project A while the human is doing live work on Project B. The human supervises, but is not the only contributor. Today there is no surface for "the agent did this work; here is the time it took."

Conflating the two leads to the wrong answer. Pain #1 is a UX problem; pain #2 is a data-model problem. They have different solutions.

---

## Non-goals

- **Not solving** "how do we run AI agents inside Shyre." Agent orchestration lives outside Shyre; Shyre records the resulting work.
- **Not solving** the legal/contract question of *whether* AI-supervised hours are billable on hourly contracts. Shyre's job is to give the user the data and disclosure controls to make that decision per engagement.
- **Not designing** the agent-orchestration UI itself (project-level "agents at work" dashboards, etc.). That's a downstream feature once the data shape lands.
- **Not changing** invoicing semantics in this doc. Any per-entry `billing_basis` work is called out as a separate, sequenced piece.

---

## Constraints

### Legal / billing

- **ABA Formal Opinion 512** (July 29, 2024) is the canonical post-AI ethics opinion and the most directly applicable authority. Hourly billing means billing actual time spent, including time spent with generative AI. Lawyers cannot bill for "hours saved" by AI. General overhead and tool-learning are not billable; per-use third-party GAI charges may be billed as disbursements; learning time may be billed only when the client requested a specific tool. Op. 512 does not explicitly contemplate one-human-supervising-N-agents, but its underlying inheritance from Op. 93-379's no-double-billing rule transposes directly.
- **ABA Formal Opinion 93-379** (1993) is the deeper precedent: cannot bill two clients for the same wall-clock hour under hourly billing. Travel-time double-billing is the canonical violation. Survives intact under Op. 512.
- **NC State Bar 2022 Formal Ethics Opinion 4** is the closest existing formal authority on the parallel-streams problem itself. Pre-AI, but on point: a lawyer doing simultaneous work for multiple clients may not bill each for the same time. Most state bars have analogous guidance.
- **FAR 31.201-4** (federal procurement) and most MSA "actual time worked" clauses require disclosure when reported time is not 1:1 wall clock.
- **Practical:** any UI total or export total that exceeds 24 hours per day per user destroys trust in the data instantly. Accountants and tax preparers will flag it on sight.

### Shyre conventions (`CLAUDE.md`)

- **Time-entry authorship is mandatory** on every surface that displays a `time_entries` row. An author is currently a `user_profiles` row (avatar + display name). Any agent-attribution model must extend, not bypass, this rule.
- **Redundant visual encoding** — a "running" indicator can never rely on color alone.
- **No native date inputs**, no inline class soup, all colors via tokens — i.e., any new widget plays inside the existing design system.
- **Migrations**: additive changes ship with code in one PR; destructive changes go in two PRs. Allow-lists in `allow-lists.ts` must mirror DB CHECK constraints (parity test enforces).
- **Hours must reconcile bit-for-bit** between dashboard, reports, and CSV export. If they don't, that's a P0.

### Schema reality (today)

`time_entries` is the only relevant table. There is **no `timers` table, no `is_running` column, no UNIQUE constraint** enforcing single-track. "Active timer" is an emergent state: a row with `end_time IS NULL AND deleted_at IS NULL`.

Single-track behavior is enforced **by app convention only** — every start path issues a pre-emptive

```sql
UPDATE time_entries SET end_time = now()
 WHERE user_id = $1 AND end_time IS NULL
```

before inserting the new row. The three start sites are:

- `src/app/(dashboard)/time-entries/actions.ts` → `startTimerAction`
- `src/app/(dashboard)/time-entries/actions.ts` → `duplicateTimeEntryAction`
- `src/app/(dashboard)/time-entries/actions.ts` → resume / week-row Play handlers

If any new code path bypasses these, multi-active rows can already exist today as a bug.

The reader contract is `useRunningEntry()` returning `RunningEntrySummary | null` (`src/hooks/use-running-entry.ts`). The sole UI surface is the sidebar `<Timer>` widget (`src/components/Timer.tsx`).

---

## Current state — what's there now

- **Sidebar widget** (`src/components/Timer.tsx`) shows one active timer: live `HH:MM:SS`, project, customer, description, started-at, author chip, full-width Stop. Roughly 140px tall when populated.
- **Keyboard**: `Space` toggles start/stop the active timer when no input is focused.
- **Timer events** are broadcast across tabs via `src/lib/timer-events.ts` (signal-only; no data payload). This generalizes unchanged.
- **Hot-path partial index** `idx_time_entries_running` on `(user_id) WHERE end_time IS NULL AND deleted_at IS NULL` (`supabase/migrations/20260504180000_hot_path_indexes.sql`) — a read optimization, not a uniqueness guard.
- **No test asserts "exactly one active timer per user."** That invariant is undocumented and untested. Any change here should add the assertion in whichever direction the policy lands.

---

## Prior art

A landscape survey conducted 2026-05-08 found that **nobody has shipped a direct solution to this problem**. The intersection of "AI parallel agents" and "billable time tracking" is white space. The two communities producing relevant writing — billing reformers and parallel-agent practitioners — are not in conversation.

This is a load-bearing finding: it shifts the design posture from "pick the best of several known-good approaches" to "navigate uncharted territory conservatively, watch what shakes out." It strengthens the case for shipping the smallest defensible thing (Option A + Option B Phase 1) and waiting for external pressure before investing in the larger options.

### Time-tracking vendors — empty category

No traditional time-tracking vendor has shipped agent-as-actor attribution or multi-concurrent timers as a first-class concept. What's been shipped is the inverse: AI categorizing one human's foreground activity into projects.

| Vendor | What they ship | Engages this problem? |
|---|---|---|
| Timely | "Memory Tracker" — AI drafts entries from app/calendar/document activity, human approves | No — single-human observer |
| TimeCamp | Autonomous "AI Time Tracking Agent" observes patterns, categorizes, flags anomalies | No — same observer pattern |
| Memtime, Rize, EARLY, Flowace | Background trackers, post-hoc categorization | No |
| Clockk | "Designed for multi-taskers" — auto-tracks across simultaneous projects without start/stop | Closest in spirit, but the streams are the human's context-switching, not autonomous agents |
| Harvest, Toggl, Clockify | No AI-agent features in 2024-2026 release notes | No |
| Hubstaff, RescueTime, Replicon, TrackingTime | "AI suggests entries from your activity" bucket | No |

Verdict: empty category for "agent as tracked actor" or "multi-concurrent timer for parallel work." This is the gap the design doc addresses.

### Agent platforms — compute telemetry, not billable time

Agent platforms expose compute/cost metrics, not billable-time abstractions, and none integrate with consulting time-tracking tools.

- **Devin (Cognition)** — bills in **ACUs** (Agent Compute Units), 1 ACU ≈ 15 minutes of Devin "actively working." This is the closest mainstream product to "agent hours" as a billing unit, but it's an internal pricing unit not exposed to downstream client-billing systems. Useful conceptual precedent for Option B Phase 3 (per-entry `billing_kind`).
- **Retool Agents** — explicitly priced "by the hour" framed as a contract-worker analogy (June 2025). Does not engage concurrency despite that being central to Retool's deployment pattern.
- **Claude Code (Anthropic)** — `/usage` command and an Analytics API expose sessions, lines of code, commits, PRs, tool usage, tokens, cost — by user and model. Engineering-productivity-ROI orientation; no time-as-duration field for client billing.
- **Cursor, Windsurf** — moved to compute-based / quota billing in 2025-2026. No time-tracking integrations.
- **GitHub Copilot cloud agent** — usage-metrics API tracks PR-lifecycle for Copilot-authored PRs (created, merged, cycle time). Productivity instrumentation, not billable time.
- **Cosine** — argues for per-task flat-fee pricing; deliberately rejects time as the unit (July 2025).
- **Indie tools AgentBudget, AgentCost** — real-time dollar/token budgets per agent session. Closest indie-hacker analog to "stopwatch per agent" — but they track *spend*, not *billable time*.

Verdict: only Devin's ACU and Retool's hourly framing are thinking in time-shaped units, and neither addresses concurrency. The parallelism question is not yet on agent-platform roadmaps.

### Practitioner / opinion writing — billing reformers

The "how should we price AI work?" conversation is mature, focused on moving away from hourly billing toward AFAs, value-based, and outcome-based pricing.

- **WSJ** — "Say Goodbye to the Billable Hour, Thanks to AI" (late 2025). Hourly model collapses when AI delivers 40-hour work in 4. HN discussion (item 46150232) counters that consulting has always re-bundled rates.
- **Jonathan Stark** — "Hourly Billing Is Nuts" / Ditching Hourly. Long-running anti-hourly thesis predates AI; multiple 2025 podcast appearances tie his argument to AI efficiency. Canonical citation for "value-based pricing for knowledge work."
- **ABA Law Practice Magazine** — "Evolution of Alternative Fee Arrangements Through Process Improvement Methodologies and AI Technology" (Mar/Apr 2025), "Value Billing in an Age of Artificial Intelligence" (Sep/Oct 2025).
- **Above the Law** — "Time's Up: Will Law Firms Say Goodbye To Billable Hour In The (Gen)AI Era?" (Feb 2025).
- **Bloomberg Law** — "AI Boosts Legal Productivity Without Toppling Billable Hours" + "AI Does Little to Reduce Law Firm Billable Hours, Survey Shows" (2025). Counter-narrative: hourly is sticky. BigHand 2025 survey: 100% of firms say AI is reshaping pricing, ~33% have actually adopted new models.
- **HN** — "Why outcome-billing makes sense for AI Agents" (item 46303090, Jan 2026). Comments hammer Goodhart's-Law gaming and audit problems.

None of these engage the operational question of how to track time when one human supervises N parallel agents.

### Practitioner / opinion writing — parallel-agent practitioners

The "how do you actually run N agents at once?" conversation is also mature, focused on workflow patterns. It does not engage billing.

- **Pragmatic Engineer** — "New trend: programming by kicking off parallel AI agents" (Oct 30, 2025). Best primary source on the workflow itself.
- **Simon Willison** — "Embracing the parallel coding agent lifestyle" (Oct 5, 2025). Same pattern.
- **VS Code Agents App, Claude Code sub-agents, Cursor Background Agents** — all ship parallel-execution UX (multiple agents per developer) but ship no instrumentation that maps streams to clients/projects.

Both authors document the pattern Shyre is trying to track. Neither discusses how the time should be tracked or billed. **The two conversations have not yet met.** That intersection is the white space Shyre is entering.

### Academic / industry research

Sparse. No peer-reviewed paper found that directly addresses time-tracking attribution for human-supervised parallel AI agents.

- **Anthropic** — "Estimating AI productivity gains from Claude conversations" (2025). Median conversation shows ~84% time savings vs. baseline.
- **Communications of the ACM** — "Measuring GitHub Copilot's Impact on Productivity." Cycle-time and PR-volume gains.
- **St. Louis Fed** — "The Impact of Generative AI on Work Productivity" (Feb 2025). Macro framing.
- **Spring 2025 law review** — "Fighting the Hypothetical: Why Law Firms Should Rethink the Billable Hour in the Generative AI Era." Tied to ABA Op. 512.
- **Hubstaff industry report** — "What AI Time Tracking Data Reveals About Productivity in Global Teams (2026)." 85% of professionals use AI but it's only 4% of tracked work time — a notable measurement gap that Shyre could address.

### Implications for this design

- **The conservative path (A + B Phase 1) is reinforced.** No competitor has set a UX or data-model precedent we'd be measured against. We're not behind. We can ship the smallest defensible thing, learn from real usage, and earn the right to expand.
- **Devin's ACU concept is worth borrowing** when Phase 3 (`billing_kind`) eventually ships — it's the only existing precedent for "agent time" as a distinct billing unit and clients of consulting firms may already understand it.
- **The Hubstaff "85% use AI but only 4% of tracked time" gap is the opportunity.** If Shyre captures agent-attributed time correctly, the per-engagement story becomes "here's what AI actually contributed," which is a measurable artifact most consulting firms cannot produce today.
- **Op. 512 is more directly applicable than Op. 93-379 alone.** Any future invoice-disclosure work in Phase 3 should cite Op. 512 specifically, not just the older opinion.
- **The two-conversation problem (billing reformers vs. parallel-agent practitioners) is itself a content opportunity.** A blog post under the Shyre brand bridging the two would have an empty competitive field.

## Design space

### Option A — Pause stack

**Premise:** the user is right that switching contexts is painful, but they don't actually need two timers running. They need one timer with the *prior* timer's state preserved and instantly resumable.

**Mechanism:**
- Starting a new timer pauses the prior timer instead of stopping it. "Paused" = `end_time IS NULL AND paused_at IS NOT NULL`.
- A small "Paused" panel under the active timer lists paused timers with their accumulated time. One-click resume swaps which one is active.
- A paused timer auto-stops after N hours (configurable; default 24h) so abandoned timers don't accumulate forever.
- Wall-clock semantics are preserved: total running time = sum of resumed intervals; never overlapping.

**Schema delta:**
- `time_entries.paused_at TIMESTAMPTZ NULL`
- `time_entries.accumulated_seconds INTEGER NOT NULL DEFAULT 0` (sum of completed run intervals before the current one; the current run interval is computed as `now() - last_resumed_at` when active, `paused_at - last_resumed_at` when paused)
- `time_entries.last_resumed_at TIMESTAMPTZ NULL`
- Optional sibling `time_entry_segments` table if we want a per-resume audit trail. Nice to have, not required.

This is single-PR additive. The partial index needs a `WHERE paused_at IS NULL` clause to remain a "running" index, or we add a second partial index for "paused."

**UX delta:**
- Sidebar widget gains a collapsible "Paused" subsection below the active timer. Each paused row: project, accumulated time, "Resume" button.
- `Space` still toggles the active timer. New shortcut `R` (or `Cmd+R` if collisions) resumes the most-recently-paused.
- No additional surfaces needed. The change is local.

**Billing impact:** none. Wall clock is preserved; sum-of-segments equals wall clock minus paused gaps.

**Pros:**
- Cheapest path. Solves the most-felt pain.
- No new authorship model. No new authentication. No new audit trail.
- Generalizes to the "I forgot to stop my timer overnight" problem (auto-pause on idle becomes a natural extension).

**Cons:**
- Doesn't address agent-driven parallel work at all. If that's the real ask, A is necessary but not sufficient.
- Adds three columns to `time_entries`. Every read site that does duration math needs to switch from `end_time - start_time` to a duration getter — touchable, but real refactor surface.

---

### Option B — Agent-attributed entries

**The core reframe.** Today every time entry has one author: a human, identified by `user_id`. Option B says **time entries can have non-human authors too**. The AI agent that worked for an hour gets *its own* time entry showing "Claude — 1h on Acme API." The human's time entries stay what they always were.

"AI agent working on Project A while I work on Project B" becomes **two authors, two entries** — not one user with two timers. Single-track per *author* is preserved; the apparent concurrency is a property of having multiple authors active at once, not of any single author being in two places.

This reframe was raised by the UX designer review and it dissolves most of the billing problems Option C creates.

#### A concrete worked example

Tuesday afternoon. You are on a Zoom call for Globex from 2–3pm. At the same time, three Claude Code sessions are running:

- Session #1 — writing a migration on Acme API (45 min)
- Session #2 — investigating a bug on Initech's dashboard (1h 12min)
- Session #3 — drafting docs for Pied Piper (20 min)

By 3pm the time entries look like:

| Author | Project | Duration |
|---|---|---|
| You | Globex | 1h 00m |
| Claude (on Acme) | Acme | 0h 45m |
| Claude (on Initech) | Initech | 1h 12m |
| Claude (on Pied Piper) | Pied Piper | 0h 20m |

No row overlaps another row from the same author. The "supervisory" hour is just the Globex hour — which is what it actually was. The agents' work is its own data: separate, attributable, reportable. `SUM(duration) GROUP BY author` is honest in every direction.

That is the whole concept. Everything below is plumbing.

#### Phase 1 — minimal attribution columns

**Schema delta** (single additive PR):

- `time_entries.started_by_kind TEXT NOT NULL DEFAULT 'user'` with CHECK constraint matching `ALLOWED_STARTED_BY_KINDS` in `src/lib/allow-lists.ts`. Initial values: `'user' | 'agent' | 'integration' | 'import'`.
- `time_entries.started_by_ref TEXT NULL` — free-form identifier (Claude Code session id, an integration name, an import run id). 256-char cap. Sanitize on render. No control characters.
- BEFORE-UPDATE trigger making both columns immutable post-insert (mirrors the SAL-024 / SAL-025 lock-trigger pattern). Without this, a user can backdate "I was an agent" onto disputed entries.
- DB parity test in `src/__tests__/db-parity.test.ts` verifies the CHECK constraint matches the TS allow-list.

**Critical security guarantee:** Phase 1 columns are display-only metadata. They do not influence rate, billability, or invoice math. The row's `user_id` is still the human — you remain the row's owner, you remain liable for the entry, you remain the one billing for it. Spoofing for repudiation is the only threat, and it's contained to display.

**UX delta:**
- Author chip in time-entry rows can render an agent badge alongside the human's avatar when `started_by_kind = 'agent'` (e.g., a small robot glyph + label).
- Reports gain an optional "by source" filter (user / agent / integration / import).
- No new authentication. Whatever path the human uses today (browser, MCP plugin running as the human) writes the row with the appropriate `started_by_kind`.

**What you get for the work:** the grammar to talk about agent-driven work in your data. What you don't get yet: a separate identity for the agent.

**Migration safety:** additive single PR. Default value backfills cleanly; existing rows become `started_by_kind = 'user'`.

#### Phase 2 — first-class agents

**Premise:** Phase 1's "this entry was driven by some agent" tag is enough for reporting but not for surfacing the agent's identity. Once you actually want "Claude" to appear in the time-entry list with its own avatar — not "you with a robot badge," but Claude itself as a tracked entity — promote agents to a first-class entity. Third-party integrations that want to write entries directly (without going through a human's session) need this too.

**Schema delta:**

- New `agents` table:
  - `id UUID PK`
  - `team_id UUID NOT NULL` (FK)
  - `name TEXT NOT NULL`
  - `avatar_url TEXT NULL`
  - `api_token_hash TEXT NOT NULL` (argon2id; never store the raw token)
  - `api_token_prefix TEXT NOT NULL` (first 8 chars, plaintext, for UI and log-grep)
  - `created_at`, `revoked_at NULL`, `last_used_at NULL`, `expires_at` (default +90 days, configurable)
  - RLS: owner/admin SELECT; member CANNOT see hash; member CAN see name+avatar (so authorship chip works).
- `time_entries.agent_id UUID NULL` (FK to `agents`).
- `time_entries.created_by_user_id UUID NULL` — the human on whose behalf the agent acted. NOT NULL when `agent_id IS NOT NULL`. CHECK enforces. The human is always nameable for liability.
- New `time_entries_provenance` sidecar (don't bloat the hot table): `request_id`, `client_token_prefix`, `source_ip`, `user_agent`, `created_at`. Append-only.
- New `time_entries_history` (mirrors `invoices_history` SAL-011 pattern): JSONB pre-change snapshot, owner/admin SELECT, no client INSERT/UPDATE/DELETE — a SECURITY DEFINER trigger writes. SOC-2-grade reconstruction without bloating the row.

**RLS contract for agent writes:**

```sql
WITH CHECK (
  agent_id IS NULL
  OR EXISTS (
    SELECT 1 FROM agents a
    WHERE a.id = time_entries.agent_id
      AND a.team_id = time_entries.team_id
      AND a.revoked_at IS NULL
  )
)
```

Use a SECURITY DEFINER helper to dodge the SAL-003 recursion family. The agent's `team_id` is fixed at token-creation time; the API route derives `team_id` from the *token*, never the request body. Defense in depth.

**Token lifecycle:**
- Display the secret once at creation. Never display again.
- Rotation = create new + revoke old (no edit). Revoked tokens can never reauthenticate.
- Constant-time compare against the hash on every request.
- All token operations call `logError` on failure paths.
- A weekly "tokens approaching expiry" surface in team settings.

**UX delta:**
- Settings → Team → Agents page. List of agents, per-agent revoke + rotate. Owner/admin only.
- Author chip across the app reads `agent_id || created_by_user_id` and displays the agent's avatar + name (with a small "agent" affordance to disambiguate from human users).
- Time-entry list filter: "By agent."
- Optional invoice template setting: "Show agent attribution on invoice line items" (default off; only meaningful for engagements where the customer wants to see it).

**Migration safety:** additive expand PR. Code reads `agent_id` first, falls back to `started_by_*`. No contract phase needed unless we ever want to drop Phase 1 columns — that's a future two-PR exercise per the migration playbook.

#### Phase 3 — billing semantics (deferred)

Bookkeeper review insists on this if we ever bill differently for agent work. Out of scope for the initial ship; documented here so we don't paint ourselves into a corner.

- `time_entries.billing_kind` (`human_focused | human_supervisory | agent_attended`).
- `time_entries.effective_billable_seconds` distinct from wall-clock duration.
- Invoice template knob for AI-attributed line-item disclosure.
- Reports growing a "focused vs supervisory hours per human" split.

This is a separate design doc when the time comes. Phase 1 + Phase 2 give us the columns we need to add this without re-shaping the row.

#### MCP / Claude Code integration

How Claude Code (or any orchestrator) actually writes entries into Shyre is the connective tissue and is worth thinking about even before Phase 1 ships. Two paths:

1. **Through your existing session.** Your browser/MCP session is already authenticated as you. Your Claude Code emits an HTTP call carrying a header like `X-Shyre-Agent: claude-acme`, and Shyre tags the resulting entry. Easy to build, easy to bypass. **Acceptable as advisory metadata (Phase 1) but not as the only mechanism** for an audit-grade story — anyone with your session token can claim any agent identity. The security review treats this path as strictly worse than per-agent tokens.
2. **Through a per-agent token (Phase 2).** You go to Settings → Agents, create "Acme — Claude," see the token displayed once, paste it into Claude Code's MCP config. The MCP server uses that token. Same pattern as a GitHub PAT or an OAuth app — independently revocable, scope-limited to one agent on one team, audit-distinguishable.

Neither path is "Shyre runs agents." Shyre records what the agents did; the orchestration lives outside (see Non-goals).

#### What Option B does not do

- **It does not solve the human context-switch tax.** If you start a Globex timer and then need to start an Initech one, you still lose Globex's accumulated state. That's Option A — independent of B and stacks on top.
- **It does not decide whether agent hours are billable.** That's a contract-with-customer question, not a data-model question. Phase 1 lets you see them; Phase 3 (deferred) would add the per-entry billing rules. Concretely, you can:
  - bill agent hours at full rate (you authorized the work; you stand behind it),
  - bill at a discounted "agent rate" with disclosure to the client,
  - not bill them and use them as ROI/effort reporting only,
  - or use fixed-fee for the engagement and track agent hours just for your own metrics.

  The data shape lets you do any of these. The data shape doesn't force any of them.
- **It does not require Shyre to run or orchestrate agents.** Shyre is the *record* of what agents did; the orchestration is upstream.

#### Why Option B beats Option C in one paragraph

In C, you would have two human-authored timers running. `SUM(your_duration)` returns 2 hours for 1 wall-clock hour. Invoices double-bill unless you build an entire `billing_basis` machinery to disclose the overlap. Reports become a debate about which total is "real." In B, you have one human-authored timer running — truthfully, since you only have one pair of hands. The other timers exist, but they're agent-authored, and SUM-by-author is internally consistent. The agent hours are a *separate axis*, not a violation of the original. That sidesteps the ABA Op. 512 / Op. 93-379 problem by changing what we mean by "concurrent" rather than building an audit trail to defend the dangerous version.

---

### Option C — True concurrent timers per user

**Premise:** the user means it literally — they want two wall-clock timers running for the same human at the same moment.

**Mechanism:** drop the pre-emptive stop in the three start paths. Add a per-team policy flag (default off). When enabled, members can have N active rows in `time_entries`.

**Schema delta:** *very* small. The DB has no UNIQUE constraint to drop. Adding `teams.allow_concurrent_timers BOOLEAN NOT NULL DEFAULT false` is the entire schema change.

**Required surrounding work — this is where the cost lives:**

- Per-entry `billing_basis` (Bookkeeper's audit trail) becomes mandatory, not optional.
- Overlap-acknowledgment dialog at start time ("This timer overlaps with X. I confirm I am supervising both.") for legal traceability (FAR 31.201-4).
- Admin sign-off gate: overlapping minutes can't hit an invoice without owner/admin approval.
- Invoice-line disclosure when overlapping minutes are billed.
- `concurrent_group_id` linking overlapping entries; `had_concurrent_overlap` denormalized for fast queries.
- All reports grow a "raw wall-clock" vs "sum of effective billable" split. Utilization > 100% becomes a warning state, not an error.
- QA: a regression suite covering overlap math, race conditions across tabs/devices, DST/sleep edges, and import round-trips.

**Billing risk:** this is the design that creates the risk. Even with all the above guardrails, naive use produces invoices that double-bill clients in violation of standard MSAs and (for legal practice) ABA Opinion 93-379. The audit trail mitigates discovery cost; it does not mitigate the underlying ethical problem if a user bills overlapping wall clock.

**When this is the right answer:** an existing customer has a contract that explicitly allows it (e.g., a fixed-fee + supervisory rate hybrid) and asks for it. Don't build it speculatively.

---

### Option D — Activity-event timeline on a single parent timer

**Premise:** sometimes the user doesn't actually want parallel time tracking — they want to *see* what the agent was doing during their work session. The work was serial in human attention; the timeline is rich.

**Mechanism:**
- Single active timer (today's model).
- New sibling table `time_entry_events`: `(time_entry_id FK, occurred_at, kind, payload JSONB)`.
- Tools/agents emit events ("Claude opened PR #42", "build completed") that attach to whichever timer is active when they fire.
- A timer's detail view renders a chronological timeline of events.

**Schema delta:** single additive sibling table. Stable, low blast radius.

**Pros:**
- Cheap. No timer-model change at all.
- Captures agent context without inventing concurrency.
- Useful even outside the agent case (build/deploy events, calendar events, etc.).

**Cons:**
- Doesn't help if the work *truly* was parallel and meant to be billed as such.
- Events are attached to whichever timer is active — so if the user wasn't running a timer when the agent worked, the data is lost (or attaches to the wrong project).

**Verdict:** a good supplement to A or B, not a replacement. Worth doing once the agent-attribution data shape is settled (so events can carry `agent_id` if they came from an agent).

---

### Rejected larger reframes

- **Session-as-first-class object** — promote "work session" to a top-level entity with N participants (humans + agents) producing entries on close. Bigger refactor than the user's pain warrants. Reconsider only if Phase 2 of Option B isn't enough.
- **Project-scoped active timer** — make "currently active" a property of the project, not the user. Breaks the team-rollups model and forces every other surface to relearn what "current work" means. No.

---

## Comparison matrix

| Dimension | A | B Phase 1 | B Phase 2 | C | D |
|---|---|---|---|---|---|
| Schema delta | 3 cols on `time_entries` | 2 cols + CHECK | new `agents` table + sidecars | 1 col on `teams` (+ many surrounding) | 1 sibling table |
| Migration shape | Single PR additive | Single PR additive | Single PR additive | Single PR additive (deceptively) | Single PR additive |
| Billing risk | None | None | None (display) | High | None |
| Audit/legal exposure | None | Low (immutable cols) | Medium (token storage, cross-team) | High (concurrent-billing) | None |
| Auth changes required | None | None | Per-agent tokens, hashing, rotation | None directly | None |
| UI blast radius | Sidebar + reports | Author chip + filter | Settings page + author chip + invoice template | All time/report/invoice surfaces | Timer detail view |
| Reverses cleanly | Yes | Yes | Phase 1 columns become deprecated; expand-contract works | App-only revert; data integrity questions remain | Yes |
| Solves "context-switch tax" | Yes | No | No | Indirectly | No |
| Solves "track agent work" | No | Yes | Yes (with first-class identity) | Yes (but with billing landmines) | Partially |
| Generalizes to imports/integrations | No | Yes (via `started_by_kind`) | Yes (via `agents` rows tagged `kind`) | No | Yes |

---

## Recommendation

**Ship A near-term.** The pause-stack is the cheapest, most-felt win. Solo persona is right that "I lose context on switch" is the daily pain dressed up as a parallelism request. No billing risk, no auth changes, no new authorship model.

**Ship B Phase 1 next.** Two text columns + immutability trigger + allow-list parity test. Lays the groundwork for agent attribution at minimal cost. Display-only, so the security exposure is bounded to spoofing-for-repudiation (same threat surface users already have when editing their own time entries today).

**Hold on B Phase 2** until a real customer or integration partner asks for it. The cost is in token storage shape, RLS policies for cross-team writes, and the UI for managing agents — all real work that's wasted if no one uses it.

**Reject C** unless an external customer brings a contract that requires it. The schema change is small but the surrounding correctness work is large and the legal exposure is permanent.

**Consider D as a supplement** once B Phase 1 is in. The two compose well: events carry `started_by_kind` and `started_by_ref`, agent activity becomes inspectable without changing the timer model.

### What this means in practice

- The user can close this doc with the one-line answer: "We won't ship multiple concurrent timers. We will ship pause-and-resume soon, and we'll add an attribution column so AI-driven entries can be marked as such. We'll revisit a richer agent identity model when there's external pressure to."
- That answer addresses the stated pain without absorbing the billing/legal/audit cost of true concurrency.

---

## Open questions

These need explicit decisions before any code lands. Listed in the order they'd block work.

1. **Does pause-stack auto-stop?** If yes, after how long, and is it per-user-configurable? Default proposed: 24h, settings-configurable. (Option A.)
2. **What's the canonical list of `started_by_kind` values?** Proposed: `user`, `agent`, `integration`, `import`. Does `system` (e.g., DST adjustments, automatic stop) belong in the same list or in a separate column? (Option B Phase 1.)
3. **In Option B, who is the row owner when `started_by_kind = 'agent'`?** Phase 1 keeps `user_id = the human`. Phase 2 introduces `agent_id` + `created_by_user_id`. Confirm this is the desired liability model — the human is always on the hook.
4. **Should the author chip distinguish agents visually?** Proposed: small robot glyph + agent name appended to the human's avatar. Compare to the existing single-author rule.
5. **MCP / Claude Code integration shape.** The security review is unambiguous: header pass-through (`X-Shyre-Agent` on the human's session token) is strictly worse than per-agent tokens. The middle ground — human creates an agent in the UI, gets a token, pastes it into Claude Code's MCP config — is the recommended model for any non-toy use. Confirm before designing the MCP plugin.
6. **Pricing.** If agents become first-class entities, do they count as billable seats in the future per-seat plan? Today there is no per-seat plan, so the question is hypothetical, but the answer affects whether agents are scoped to teams or users.
7. **Does Option D ship at all?** It's optional and additive. Decide once Option B Phase 1 is shipped and we see whether the attribution column alone is enough.

---

## Phased rollout plan

PR-shaped sequencing. Each PR is small enough to ship independently. None blocks the next conceptually, but B Phase 1 should not ship before A unless we also surface the "I lost my timer" pain explicitly first.

### PR 1 — Option A (pause stack)

- Migration: add `paused_at`, `accumulated_seconds`, `last_resumed_at` to `time_entries`. Update `idx_time_entries_running` partial index to exclude paused rows.
- Server actions: new `pauseTimerAction`, `resumeTimerAction`. Modify start paths to pause-instead-of-stop the prior timer.
- Hook: `useRunningEntry()` continues to return the active row. New `usePausedEntries()` returns paused rows.
- Sidebar: `<Timer>` widget gains a collapsible "Paused" subsection.
- Keyboard: `R` resumes the most-recently-paused (only when no input focused, no modal open, no Cmd/Ctrl modifier).
- Tests: every action path; auto-stop after 24h; segment math; race between pause + edit.
- Docs: update `docs/guides/features/timer.md` (or wherever timer behavior is currently documented; create if absent).

### PR 2 — Option B Phase 1 (attribution columns)

- Migration: add `started_by_kind` (CHECK matched to `ALLOWED_STARTED_BY_KINDS`), `started_by_ref` (256-char text, sanitized), immutability trigger.
- Allow-list: add `ALLOWED_STARTED_BY_KINDS` to `src/lib/allow-lists.ts`. The DB-parity test in `src/__tests__/db-parity.test.ts` will fail until both sides match.
- Server actions: accept optional `startedByKind` / `startedByRef` on `startTimerAction` (and the duplicate / resume paths). Default `'user'` / `null`.
- UI: author chip extension for agent badges. Time-entry list filter "by source."
- Tests: CHECK constraint, immutability trigger, allow-list parity, sanitization of `started_by_ref`.
- Docs: update `docs/reference/database-schema.md` and `docs/reference/modules.md` (Stint).

### PR 3 (deferred) — Option B Phase 2 (first-class agents)

Don't queue this until a customer asks. When triggered:

- Migration: `agents` table, `time_entries.agent_id`, `time_entries.created_by_user_id`, sidecar `time_entries_provenance`, history table + SECURITY DEFINER trigger, RLS policies, allow-list parity.
- Token issuance / rotation flow in Settings → Team → Agents.
- API authentication path (separate from session auth). Constant-time compare. `logError` on every failure.
- Author chip + filter + optional invoice template knob.
- Tests: cross-team write rejection (the highest-risk surface), token revocation, history reconstruction, SAL-003-style RLS recursion sanity.
- New SAL entries: SAL-NEW-A (Phase 1, on ship), SAL-NEW-B (token storage), SAL-NEW-C (cross-team write policy).

### PR 4 (optional) — Option D (event timeline)

- Migration: `time_entry_events` sibling table.
- Tooling: a small write API for emitters (an MCP plugin, a CI hook, etc.).
- UI: timer-detail timeline.

---

## Failure modes (QA-derived)

These apply primarily to Option C, but selected items apply to A and B as called out.

| Failure mode | Affects | Mitigation |
|---|---|---|
| Two browser tabs both call `startTimerAction` simultaneously | All options | Idempotency key on the start action; constraint check in the same transaction |
| Mobile + desktop diverge on which timer is "active" | All options | `BroadcastChannel` already exists for cross-tab sync (`src/lib/timer-events.ts`); add Supabase realtime subscription for cross-device |
| Laptop sleep accrues phantom hours | A (paused timers exempt), C | Auto-stop / auto-pause threshold. Default 8h in A's auto-pause; surface a "this timer ran for >8h, was that intentional?" warning |
| DST fall-back yields zero or negative durations | All options | Store and compute in UTC; tested in `time-entries.test.ts` once that suite exists |
| Forgotten timer accrues for weeks | A (mitigated by auto-stop), B (mitigated by agent token expiry), C (worse — N forgotten timers) | Auto-stop default; weekly digest of long-running timers |
| `SUM(duration)` over overlapping rows inflates utilization | C | Reports compute "raw wall clock" vs "effective billable" separately; >100% utilization is a warning state |
| CSV export with overlap rows confuses QuickBooks / accountants | C | Disclose `concurrent_group_id` and `effective_billable_seconds` columns; document the export shape |
| The "exactly one active timer per user" invariant is silently deleted | All options changing it | Add the regression test in the same PR. Without it, a future regression to single-track behavior won't be caught. |

**The single test that forces a policy decision before schema ships** (per the QA review, applicable to C):

> Start timer A; start timer B without stopping A; advance clock 1h; stop both. Assert two rows exist AND `SUM(billable_hours)` on the resulting invoice equals the policy-defined value (2h if parallel allowed, 1h with disclosed overlap, error if not).

If the policy isn't decided, that test can't be written. If the test isn't written, the policy isn't real.

---

## Security threat model summary

Distilled from the security-reviewer pass.

### Option B Phase 1 threats

| Threat | Severity | Control |
|---|---|---|
| User backdates "I was an agent" onto disputed entries | Low | Immutable trigger on `started_by_kind` and `started_by_ref` |
| `started_by_ref` carries injected control characters / oversize payload | Low | 256-char cap, control-char rejection, sanitize on render |
| `started_by_kind` drifts from TS allow-list | Low | DB parity test |
| Display-only metadata is later wired to billing math without re-review | Medium (process) | Doc explicitly forbids; Phase 3 design covers the safe shape |

### Option B Phase 2 threats

| Threat | Severity | Control |
|---|---|---|
| Agent token theft → write access to a team's time entries | Medium | Hash storage (argon2id), prefix-only display, rotation flow, expiry, `revoked_at`, constant-time compare |
| Cross-team write (agent in Team A writes to Team B) | High | `team_id` derived from token, never request body; RLS WITH CHECK joining `agents`; `agent.team_id = time_entries.team_id` |
| Audit reconstruction fails in fee dispute | Medium | `time_entries_history` JSONB-snapshot trigger from Phase 2 day 1 |
| Repudiation: "the agent did it, not me" | Medium | `created_by_user_id NOT NULL` when `agent_id IS NOT NULL`; the human is always nameable |
| Token list endpoint leaks the full token | High (if mis-shipped) | Hash storage means the full token literally cannot be returned; UI shows prefix only |
| MCP header pass-through (anti-pattern) | Medium-High | Documented as not acceptable as the only mechanism; if shipped, scope-down to `createTimeEntryAction` only and treat as `started_by_ref` (Phase 1 semantics) |

### Anti-patterns to actively avoid

- **Reusing `user_settings.github_token`'s storage shape.** That column is plaintext-RLS-only despite docs once claiming "encrypted" (SAL-015). New tokens use hashes.
- **Reading agent context from a request header on a session-authenticated request** without any binding to an actual agent identity. That's Model 1 with worse audit. If we ship that path, it's explicitly informational and never authoritative.
- **Adding the history-table trigger after Phase 2 ships.** Pre-existing rows have no provenance and can't be retro-reconstructed. The trigger exists from day one or the table doesn't exist.

---

## Accessibility requirements summary

Distilled from the accessibility-auditor pass. Applies to any UI showing N timers (Option C primarily; partially Option A's paused-list).

- **Live regions:** elapsed-digit nodes are `aria-live="off"`. One off-screen `aria-live="polite"` summary region announces lifecycle events only (start, stop, focus-change, expand). Per-second announcements are forbidden.
- **`role="timer"`** on each row's elapsed; `<time>` element with `aria-label` formatted as natural language ("1 hour 42 minutes elapsed on Acme API"), not raw `01:42:11`.
- **Focus management:**
  - Distinguish *DOM keyboard focus*, *focused timer (Space target)*, and *visual emphasis* in the spec. Conflating them fails SC 2.4.3 / 2.4.7.
  - Starting a new timer must not steal focus.
  - Stopping one moves focus to the next sibling row.
  - Roving `tabindex`: focused row `tabindex=0`, others `-1`.
  - Persisted "focused timer" in localStorage is scoped per-user (`userId` in the key), reset on auth change.
- **Keyboard map:**
  - `Space` → stop focused (when focus is on a timer-list row OR when chrome holds focus and no input/modal is active). Document the precedence.
  - `Shift+Space` is a poor choice — collides with browser scroll, swallowed by some ATs. **Prefer `Shift+S` or a chord like `g s`** for stop-all. Stop-all is destructive; gate behind inline `[Confirm][Cancel]`.
  - Number-key shortcuts (1–9) collide with NVDA/JAWS quick-nav. **Prefer `Alt+1..9`** or only-fire-when-timer-chrome-holds-focus per SC 2.1.4.
  - Visible `<kbd>` chips per row; `?` overlay listing the full map (SC 3.3.5).
- **Color independence:**
  - "Focused" cannot be encoded by `border-l-2 ring` alone — `box-shadow` is stripped in Windows High Contrast mode. Pair with a leading glyph + textual `aria-current="true"` + a forced-colors-aware `outline`.
  - Running pulse: paired with a "Running" text token; honor `prefers-reduced-motion` (static dot replacement).
- **Screen-reader naming:** row name is one sentence — "Acme, API project, 1 hour 42 minutes 11 seconds, focused." Pulse and chevron are `aria-hidden="true"` because their meaning is duplicated in the text. The chevron-as-button gets its own `aria-label` and `aria-expanded`.
- **"+N more"** is a real `<button>` with `aria-expanded` and `aria-controls`, not a text node. Plural via i18n. When expanded, focus moves into the revealed rows.
- **High contrast** (`forced-colors: active`):
  - Row outline uses `Highlight`/`HighlightText`.
  - Focus uses `outline`, not Tailwind's `ring-*`.
  - `<kbd>` chips need a forced-colors fallback or they vanish.
- **Stop-button label** interpolates the focused timer's name ("Stop Acme API") and updates on focus change (SC 2.5.3 Label in Name).

WCAG criteria invoked: 1.3.1, 1.4.1, 1.4.11, 1.4.13, 2.1.1, 2.1.4, 2.2.2, 2.3.3, 2.4.3, 2.4.7, 2.5.3, 3.2.5, 3.3.5, 4.1.2, 4.1.3.

---

## Persona reviews — summary

Eight personas reviewed this design space. Their full takes are preserved separately; the synthesis is below.

- **Solo consultant** — "Pause stack, not concurrency. Wall-clock double-billing ends consulting relationships. The real complaint is losing accrued time on switch, dressed up as a parallelism request."
- **Agency owner** — "Per-team policy gate, default off. Concurrency must be a first-class data property — `had_concurrent_overlap`, overlap audit, admin sign-off before invoicing. Otherwise utilization metrics silently inflate."
- **Bookkeeper** — "ABA Opinion 93-379, FAR 31.201-4, MSA 'actual time worked' clauses all forbid wall-clock double-billing. If we allow concurrency, every overlapping segment carries a `billing_basis`; invoice line items disclose. Banning it loses the AI use case; allowing silently is an audit landmine."
- **UX designer** — "Reframe: agents as authors, not parallel timers per user. The single-track UI already handles 'N authors, one entry each' cleanly. Sidebar widget needs collapsed-stack with `+N more`. Resist building a timer dashboard."
- **Platform architect** — "No UNIQUE constraint to drop; single-track is app convention. Single additive PR for the schema. Don't introduce a separate `active_timers` table — splits source of truth. The sidebar's direct read of `time_entries` should be promoted to a platform reader (`@/lib/stint/running-entries.ts`) regardless of which option ships."
- **QA tester** — "Race conditions across tabs/devices, DST, sleep accrual, the 3-week-forgotten-fleet, undefined overlap behavior, no test asserts the single-track invariant. The one test that would force the team to write the policy down: start A → start B → stop both → assert invoice math equals the policy value."
- **Security reviewer** — "Phase 1 columns are display-only. Phase 2 needs hash-storage tokens, team-from-token RLS, history table from day one. MCP header pass-through is strictly worse than per-agent tokens. SAL entries: SAL-NEW-A (display metadata, Low), SAL-NEW-B (token storage, Medium), SAL-NEW-C (cross-team write policy, High)."
- **Accessibility auditor** — "Per-second `aria-live` announcements are a violation. Distinguish DOM focus / focused timer / visual emphasis. Number-key shortcuts collide with NVDA/JAWS quick-nav. `border-l-2 ring` alone fails Windows High Contrast. `+N more` must be a real button with `aria-expanded`."

---

## References

### Files / code surfaces

- `src/components/Timer.tsx` — sidebar widget; only UI surface for active timer today
- `src/hooks/use-running-entry.ts` — the `Timer | null` reader contract
- `src/app/(dashboard)/time-entries/actions.ts` — three start paths with pre-emptive stop (lines ~505, ~617, ~796)
- `src/app/(dashboard)/time-entries/running-timer-card.tsx` — running-card component
- `src/lib/timer-events.ts` — cross-tab signal layer (generalizes unchanged)
- `src/lib/modules/registry.ts` — `stint` module manifest
- `src/lib/allow-lists.ts` — must add `ALLOWED_STARTED_BY_KINDS` for Phase 1
- `src/__tests__/db-parity.test.ts` — enforces TS allow-list ↔ DB CHECK parity
- `supabase/migrations/001_initial_schema.sql` — `time_entries` definition (lines 70–82)
- `supabase/migrations/20260504180000_hot_path_indexes.sql` — `idx_time_entries_running` partial index

### Related Shyre docs

- `docs/reference/migrations.md` — additive vs destructive migration rules
- `docs/reference/database-schema.md` — schema changes need an entry here
- `docs/reference/modules.md` — `stint` module documentation
- `docs/reference/forms-and-buttons.md` — destructive flow tiering (applies to "Stop all")
- `docs/reference/roles-and-permissions.md` — admin-gate enforcement layers (applies to Phase 2 agent management)
- `docs/security/SECURITY_AUDIT_LOG.md` — SAL-002, SAL-003, SAL-006, SAL-011, SAL-013, SAL-014, SAL-015, SAL-018, SAL-024, SAL-025, SAL-028 are all relevant precedents

### External — legal / ethics

- **ABA Formal Opinion 512** (July 29, 2024) — generative AI in legal practice; the canonical post-93-379 update. PDF on americanbar.org.
- **ABA Formal Opinion 93-379** (1993) — concurrent billing prohibition; survives intact under Op. 512.
- **NC State Bar 2022 Formal Ethics Opinion 4** — closest existing authority on the parallel-streams problem itself.
- **FAR 31.201-4** — federal procurement, allowability of cost.

### External — vendor / product references

- **Devin (Cognition)** — ACU billing model. `docs.devin.ai/admin/billing`, `devin.ai/pricing`. Closest precedent for "agent time" as a billing unit.
- **Claude Code Analytics API** — `code.claude.com/docs/en/analytics`, `docs.anthropic.com/en/api/claude-code-analytics-api`.
- **Retool Agents** — "AI Agents: An Hourly Pricing Model" (June 24, 2025) at `retool.com/blog/cost-of-ai-agents-hourly-pricing-model`.
- **Cosine** — "AI Coding Agent Pricing: Task vs Token" (July 11, 2025) at `cosine.sh/blog/ai-coding-agent-pricing-task-vs-token`. Argues against time as the unit.
- **Pragmatic Engineer** — "New trend: programming by kicking off parallel AI agents" (Oct 30, 2025). Best primary source on the parallel-agent workflow.
- **Simon Willison** — "Embracing the parallel coding agent lifestyle" (Oct 5, 2025) at `simonwillison.net/2025/Oct/5/parallel-coding-agents/`.
- **HN discussions** — `news.ycombinator.com/item?id=46150232` (WSJ "Say Goodbye to the Billable Hour"), `news.ycombinator.com/item?id=46303090` ("Why outcome-billing makes sense for AI Agents"), `news.ycombinator.com/item?id=47778922` ("Are the costs of AI agents also rising exponentially?").
- **Indie tools** — AgentBudget, AgentCost. Real-time dollar/token budgets per agent session; track spend, not time.

### External — accessibility

- **WCAG 2.1 AA** — full criteria list in the accessibility section above.

---

## Decision required

For the user to close this exploration, decide:

1. **Ship A?** (Yes/No, when)
2. **Ship B Phase 1?** (Yes/No, when, after A or alongside)
3. **Defer B Phase 2?** (Yes; or No because [external pressure])
4. **Reject C?** (Yes; or No because [contract/customer])
5. **Consider D as a follow-up?** (Yes; or Not now)
