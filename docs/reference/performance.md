# Performance

Where Shyre is on TTFB today, what we already shipped, and the ordered pathway of optimizations remaining. Numbers are real captures from Marcus's Safari Network tab on 2026-05-04, not theoretical.

## Where we are

After the 2026-05-04 prelude-parallelization pass:

| Page | TTFB | Total |
|---|---|---|
| `/dashboard` | 1.58s | 1.69s |
| `/time-entries?view=log` | 1.56s | 1.69s |
| `/time-entries?view=day` | 1.61s | 1.73s |
| `/time-entries?view=week` | 1.36s | 1.65s |

All four cluster within ~250ms — a strong signal that the remaining bottleneck is **shared infrastructure**, not page-specific work.

## The thinking model

Every dashboard page pays a fixed prelude tax (auth, identity, settings, RLS context) before any view-specific query fires. On free-tier Supabase:

```
Floor = connection setup + JWT verify + 4-5 RLS-scoped fetches + React init
      ≈ 600-1000 ms on shared compute
```

Page-specific data fetching adds *on top* of the floor. The first round of optimization (parallelization) collapsed the data fetches into a single Promise.all bracket. The next round of optimization is reducing the floor itself — and most of that lives at the infrastructure tier, not in code.

## What we shipped

### Round 1: Page-level parallelization (2026-05-04, commit `74c23de`)

`/time-entries/page.tsx` had ~14 serial round-trips before any data rendered. Restructured into 3 phases via `Promise.all`. Result: anecdotal "3× faster"; `Week` view dropped from ~5s total to 1.65s.

### Round 2: Prelude parallelization (this commit, 2026-05-04)

Two reinforcing changes across all dashboard routes:

1. **React `cache()` on every read-only request-scoped helper** — `createClient`, `getUserContext`, `getUserTeams`, `isSystemAdmin`, `getUserSettings`. Layout and page can both call them without paying duplicate `auth.getUser` round-trips. First call hits the server; same-request repeats are free.

2. **Layout `Promise.all` over the 4 cached helpers** — was 7 serial awaits + 2 redundant `team_members` queries + a separate `user_profiles` avatar fetch + a separate `user_settings` theme fetch. Now: one `Promise.all` over the cached helpers, with a conditional `error_logs` count tail for admins only. Wall-clock collapses from ~7 round-trips serial to 1 round-trip parallel.

3. **Time-entries Phase-0 collapse** — was 3 separate `selfScopedFloor` calls (each fetching the same `team_members.joined_at`) plus a separate `user_settings.timezone` query. Now: one `Promise.all` of `getUserSettings()` (cached, shared with layout) + a single `joined_at` lookup. The 3 floors derive as pure max-math from one `joined_at`.

Predicted impact: ~400ms off TTFB on every dashboard page. Effective from the user's next page load.

### Round 3: Hot-path indexes (this commit, 2026-05-04)

Three additive partial indexes added in `20260504180000_hot_path_indexes.sql`:

- `idx_time_entries_running` — running-timer probe (`end_time IS NULL AND deleted_at IS NULL`).
- `idx_time_entries_unbilled` — dashboard unbilled-hours card (selective predicate; matters at >5k rows).
- `idx_projects_team_active_name` — project picker + dashboard cards (covers filter + ORDER BY together).

All other prelude tables (`user_profiles`, `team_members`, `system_admins`, `user_settings`, `team_period_locks`, `error_logs`) already had appropriate indexes — verified during the audit.

## What's left — ordered pathway

### Tier 1 — Code wins (low cost, real but bounded)

**Diminishing returns from here.** The big code optimizations are done. Remaining:

| Lever | Estimated TTFB win | Effort | Risk |
|---|---|---|---|
| **`Suspense` + streaming for slow widgets** — wrap the activity-log section / dashboard stat cards in a `<Suspense>` boundary so the shell streams while the data resolves. User sees the layout almost instantly; data fills in. | Doesn't reduce TTFB; reduces *perceived* load. Significant UX win. | Half a day. | Low — Next.js native pattern. |
| **Edge runtime for prelude routes** — move auth + identity to the Vercel edge. Skips the cold-start of the Node serverless function. | 50-150ms on cold requests. | Half a day. Some Supabase clients aren't edge-compatible. | Medium — easy to break Supabase server client. |
| **Memoize `auth.getUser` itself across the request** — currently each cached helper internally calls `auth.getUser`. Adding a tiny shared `getCurrentUser = cache(...)` layer would collapse those into one call even when not all helpers happen to be Promise.all'd together. | 50-100ms when helpers are called sequentially. | 20 minutes. | Low. |
| **Reduce Sidebar payload** — the layout serializes a large `Sidebar` props object on every page. Profile this; if it's hot, split into `<Sidebar>` (server, static-ish) + `<UserChip>` (client, interactive). | 10-30ms TTFB; some hydration win. | A day. | Low. |

**Floor we can plausibly hit on free tier with all of the above:** ~600-800ms TTFB on warm requests. Still painful, but everything below that is paid for at the infrastructure tier.

### Tier 2 — Resource upgrades (the actual lever)

This is where the biggest remaining wins live.

#### 2a. Supabase Pro — $25/month per project

What you get:
- **Dedicated CPU** (vs shared compute on free). Removes the noisy-neighbor variance — every query gets its own ms budget instead of sharing one.
- **No 7-day project pause.** First-request-after-idle drops from 3-5s cold-start to a normal warm response.
- **Daily automated backups + 7-day retention** (the backup story from `docs/guides/admin/backups.md` becomes secondary).
- **Higher connection pool, longer query budget, paid support.**

Predicted TTFB after Pro: **600-900ms** on warm requests, **1-1.5s** on first-after-idle (vs 3-5s today on free).

When to do this: the day you have a paying customer. $25/mo is rounding error against any paid SaaS plan; the user-perceived improvement is 2-3× per page.

#### 2b. Supabase Pro + Small compute add-on — $35-60/month total

What you get on top of Pro:
- More vCPU + more RAM. Bigger working set fits in cache; `time_entries` scans on 100k+ rows speed up materially.

When to do this: after the 6-year Harvest backfill (50k-100k `time_entries` rows). Worth profiling first — Pro alone may be enough at that scale.

Predicted TTFB: **400-700ms** warm, **800ms-1.2s** cold.

#### 2c. Vercel Pro — $20/month

What you get:
- Faster cold starts on serverless functions (smaller VM cold-start variance).
- Edge caching plumbing (HTML route caching, ISR with on-demand revalidation, etc.).
- Production-ready bandwidth limits.

When to do this: same trigger as Supabase Pro. The two together are ~$45/month and remove almost all of the free-tier noise.

Predicted TTFB: **300-500ms** on warm + cached, **600-900ms** on cold. This is where Shyre starts to *feel* like a fast SaaS.

### Tier 3 — Architectural wins (only when Tier 2 is in place)

| Lever | Estimated win | When |
|---|---|---|
| **Edge route caching for marketing/login pages** — login, marketing, /docs aren't user-specific. Render to HTML at build/deploy time + serve from Vercel edge cache. | TTFB ≤ 50ms on cached pages. | When public-facing pages exist. Today they're minimal. |
| **Stale-while-revalidate on the dashboard** — render the page from a 30-second-old cache, then revalidate in the background. User sees content instantly, gets fresh data on the next nav. | Perceived TTFB drops to ~50ms on repeat visits. | When real users complain about repeat-visit speed. |
| **Database read replicas (Supabase Read Replicas — $32/mo each)** — route long-running reports / exports to replicas; keep the primary fast for transactional dashboard work. | Eliminates report-traffic blocking dashboard reads. | Once a single tenant has reports running concurrently with daily dashboard use. |
| **In-process caching layer (Redis, Upstash)** — cache the `getUserContext` / `getUserTeams` results for ~30 seconds. Even on Pro, the auth round-trip is the floor; a Redis hit is single-digit ms. | TTFB drops to ~100-200ms warm. | After Pro upgrade, only if measured TTFB is still > 800ms and that matters for the workload. Adds operational complexity. |
| **Server actions instead of full page reloads on common interactions** — e.g. switching the day in `/time-entries` already uses URL nav + SSR; replace with optimistic client-side update + server action. Page never reloads. | Per-interaction latency feels instant. | Already partly there for the timer; expand systematically once on Pro. |

### Tier 4 — When the platform itself is the bottleneck

If, after all of the above, single-page TTFB still has a clear floor that's hurting the business:

- **Move the database off Supabase** to AWS RDS or Neon with a paid tier. Better tail latency on shared infra. Operational complexity goes up materially.
- **Self-host Postgres on a dedicated VM.** Best-case latency wins, worst-case operational disaster. Don't until there's a team to run it.
- **Cache aggressively at the application layer with a CDN-fronted JSON API.** Decouples render from query. Architectural overhaul; only worth it if Shyre becomes a high-traffic SaaS.

These are years away. Listed for completeness.

## Decision frame

A blunt summary of when to invest in each tier:

| Stage | Spend | Expected TTFB | Notes |
|---|---|---|---|
| Solo dev, no users | $0/mo (today) | 1.4-1.7s warm, 3-5s cold | Acceptable. Don't optimize. |
| First paying customer | $45/mo (Supabase Pro + Vercel Pro) | 400-700ms warm, 800ms cold | Required before charging. |
| Multiple customers, ~100k entries | $80-100/mo (Pro + Small compute) | 300-500ms warm | When the page feels slow under real load. |
| Real SaaS (10+ paying tenants) | $200+/mo + ops time | 200-400ms warm | Read replicas, Redis caching, edge runtime. |

## How to measure

Marcus's Safari capture method (re-runnable any time):

1. Open Web Inspector (`Cmd+Opt+I`) → Network tab.
2. Check **Disable Caches** so every load is cold.
3. Reload the page (`Cmd+R`).
4. Click the document request (the very first row, named after the page).
5. Click the **Timing** tab.
6. Record `Waiting (TTFB)` and `Start to Finish`.

Capture before and after every perf change. **Anecdotal "feels faster" is a real signal** — Marcus's "3× faster" was within 10% of the measured improvement — but capture the numbers anyway. They reveal which tier of optimization actually moved the needle.

Long-term: hook Vercel Analytics or a similar real-user monitoring tool. Lab numbers are biased; real-user numbers are what matter once paying users land.

## Anti-goals

- **Don't add Redis / KV before Pro.** A cache that fronts a slow free-tier DB is just a more complex slow free-tier DB.
- **Don't precompute / denormalize aggressively.** Adds invariants to maintain. Fix the planner first.
- **Don't add a service worker / offline mode "for performance."** Wrong tool. Service workers are for offline UX, not server speed.
- **Don't sprinkle `'use cache'` on every page.** Next.js's experimental caching can mask real performance issues. Solve the actual bottleneck (Postgres + auth round-trips) instead of papering over it.

## See also

- `docs/guides/admin/backups.md` — the data-protection side of the same Pro upgrade decision.
- `docs/reference/migrations.md` — adding indexes is a migration; understand the deploy ordering before running one.
- `supabase/migrations/20260504180000_hot_path_indexes.sql` — the hot-path indexes added alongside this doc.
- `src/lib/team-context.ts`, `src/lib/system-admin.ts`, `src/lib/user-settings.ts`, `src/lib/supabase/server.ts` — the cached helpers powering the prelude parallelization.
