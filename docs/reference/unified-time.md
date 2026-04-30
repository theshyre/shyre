# Unified Time view — design doc

> **Status:** planned, not yet started. Captures the converged design +
> open decisions from the 2026-04-29 eight-persona review (solo-consultant,
> agency-owner, bookkeeper, ux-designer, accessibility-auditor, qa-tester,
> security-reviewer, platform-architect). When implementation starts, this
> doc is the source of truth — it is the briefing for whoever picks the
> work up, not a sketch.
>
> Linked from [`docs/reference/roadmap.md`](./roadmap.md).

## Goal

Today `/time-entries` exposes two views via a `Day | Week` segmented
control. The Week grid is what people use for end-of-week timesheet
reconciliation; the Day view is functionally a deeper read of one date.
Both require the user to *target* a date before they can see anything,
and both lose the rhythm a time-keeping log naturally has — "what did I
do this week, last week, the week before."

A **Unified Time view** ("Log") presents time entries as a continuous,
date-banded vertical scroll: today at the top, older days flowing
downward. Each band carries the day's total, billable split, and lock
state. The masthead anchors **this-ISO-week** totals so the canonical
"hours this week" number doesn't move as the user scrolls. The view
adds: a date-jump control, sticky day-band headers, swim-lanes when
viewing more than one author, and a hard server-side row cap for
deep-range fetches.

The Log is **the right default for daily logging and "did I forget
yesterday?" recovery**. The Week grid stays as the **default for
invoicing-prep / Friday timesheet review** — grid-by-author-by-project
is what that job wants. Day view becomes redundant the moment Log
ships and is retired in the same release.

## Where Log wins (and where it doesn't)

Wins:

- **The "I forgot Tuesday" problem.** Yesterday and the day before are
  on the page; drop an entry into the band, done.
- **Cross-week recall.** "When did I last touch the AVDR auth refactor?"
  becomes a scroll + scan + Cmd-F instead of week-toggling.
- **Mobile.** Vertical bands beat a 7-column grid on a phone.
- **Audit lookups.** "Show me everything Alice did in March 2025" is a
  scoped scroll with a stable URL.

Loses (Week stays the right tool):

- **Pre-invoice review.** "Did I bill 40h to Liv this week, broken out
  by category, totals on the bottom row" is a grid problem. Scrolling
  a log to add up Liv hours is worse than what we have.
- **5+-author chronology.** A flat by-minute interleave reads like a
  surveillance feed. Log requires swim-lane mode (per-author column
  inside each band) when more than one author is visible.

## Information architecture

### Routes + URL params

`/time-entries` keeps a single route. The view is a URL param:

```
/time-entries?view=log&anchor=YYYY-MM-DD&zoom=day|week|month
              &org=<team_id>&members=me|all|<csv>&billable=1
              &from=YYYY-MM-DD&to=YYYY-MM-DD
```

Parameter rules (consistent with the existing page):

- `view` — `day` and `week` continue to exist during transition; `log`
  is the new default after the rollout flag flips. After Day retires,
  the values are `log | week`.
- `anchor` — the visible window starts at `anchor` and walks backward.
  Default = today (in user's TZ). Validated as `YYYY-MM-DD`; bad
  values fall back to today.
- `from` / `to` — explicit bounded range (used by the bookkeeper
  audit case, by export, and by deep-link permalinks). When set,
  `anchor` is ignored. Range must be ≤ a server-side cap (default
  370 days; configurable).
- `zoom` — controls band granularity (day / week / month rollups).
  Default `day` for the Log; `month` is a v2 affordance.
- `members` — already implemented; carries through.
- `billable` / `org` — already implemented; carry through.

URL is the source of truth. Refresh restores the view. Permalinks
pasted into a Slack thread land on the same scroll position.

### Default landing position

**Today, with last-viewed range remembered as a soft preference.**
The bookkeeper case ("January–April reconciliation always wants to be
in Q4") is real — so the page also persists a per-user
`last_log_anchor` in `user_settings` that the user can opt into
("Resume where I left off"). Default off; opt-in once. Don't auto-jump
without user consent; muscle memory beats cleverness.

### Band layout

Each day is a `<section aria-labelledby="day-YYYY-MM-DD">` with an
`<h2>` heading and an inner table or list of entries. Heading content
(localized; one accessible name per band):

```
Wed Apr 29  ·  Today  ·  6h 15m  ·  4h 30m billable
                     ↑                    ↑
                     redundant            font-mono tabular-nums
                     icon + word + accent
```

- **Today** marker uses three channels (icon + word + accent) per the
  redundant-encoding rule.
- **Weekend** bands carry the day name ("Saturday") plus a muted
  background token (`bg-surface-inset`) — never color-only.
- **Empty days** render as a band with a thin "Add entry" inline CTA.
  Collapsing zero-days breaks the calendar rhythm and hides
  data-integrity signal.
- **Locked days** show a lock icon + "Locked through 2026-03-31 by
  marcus" text in the header; inline-edit affordances are absent
  (not "click and get a toast"), kebab menu omits Edit, `aria-disabled`
  is set on the row.
- **Year and quarter boundaries** render a heavier rule with the
  year/quarter label sticky to the top of the scroll container as the
  user crosses them. Tax-year (Dec 31 → Jan 1) and fiscal-quarter
  boundaries are signal, not noise.

### Sticky headers + scroll discipline

- The current band's `<h2>` sticks to the top of the scroll container
  as the user scrolls. Older bands release.
- The masthead (page title + this-ISO-week totals + view toggle +
  trash link) does **not** scroll away — sticky to the page.
- A **second sticky layer below the masthead** carries: the active
  filters (member, billable, team), the date-jump control, the lock
  banner if any visible day is locked. This prevents "scroll back to
  March, want to filter to Jordan, scroll all the way back up" friction.
- Sticky headers must apply `scroll-margin-top` equal to their height
  on every focusable row, so anchor links and `Element.scrollIntoView()`
  land cleanly without occluding the focus ring.
- `prefers-reduced-motion: reduce` disables smooth-scroll; date-jump
  is instant.

### Show-more-detail per day

Inline expansion (per `forms-and-buttons.md` tier 1), never a modal:

- Default band: rows visible, compact.
- Click band header (or `Enter` on focus, or `Shift+E`): inline
  expansion shows per-project subtotals, per-member subtotals,
  billable %, lock status, links to invoices the day's entries
  contributed to (chip per invoice with number + send date).
- A standalone "Open day page" link routes to `/time-entries/day/YYYY-MM-DD`
  only for the print/share case. Don't surface that for casual detail.

### Multi-author behavior

- `members=me` (default) → single chronological column inside each band.
- `members=all` or list → **swim-lane mode**: each band groups entries
  by author. Author column on the left, avatars + display name (per
  the time-entry-authorship rule).
- **Cross-team scroll** (multi-team owner viewing "all teams") is
  blocked: the Log requires a single team selection. Selecting "All
  teams" surfaces an empty-state nudge ("Pick a team to see the log,
  or use the Week view across teams"). Rationale: interleaving Team A
  Monday with Team B Monday is unreadable, and the alternative
  (per-team grouping inside each day band) makes deep scrolls
  exponentially denser. Ship the constraint; reconsider in v2 if real
  users complain.

### Multi-day / cross-midnight entries

- Entry with `start_time` and `end_time` straddling midnight renders
  in **both** bands, with arrow icon + caption: "↑ continues from
  Tuesday" / "↓ continues into Wednesday". Two channels.
- Running timer that has been on for >24h shows in today's band with
  a danger pill ("Running for 2d 4h"); the user is offered a one-click
  "Stop and split" affordance to break it at midnight, mirroring the
  existing duration-input ergonomics.

### Running timer + masthead totals

- **Running timer card sticks at the top of the viewport** in the
  toolbar / second sticky bar — *not* inside today's band. It is
  global state ("am I tracking right now?"), not log content.
  Burying it in a scroll position destroys "stop the clock" reachability.
- **Masthead total stays this-ISO-week** regardless of scroll. Never
  switch the masthead number to "visible-range total" — that number
  is wrong on Mondays and inconsistent on edits. If a "visible range"
  total is desired, render it as a separate, labeled sub-line in the
  sticky filter bar ("Range: Mar 14 – Apr 29 · 134h 20m · 112h
  billable"). Two labeled numbers, not one ambiguous one.

### Jump-to-date

Single dropdown panel control in the masthead (per `forms-and-buttons.md`
tier 2 — too much for inline, overkill for modal):

- Native `<input type="date">` + free-text `YYYY-MM-DD` field for
  precise jumps.
- Quick chips: Today · Yesterday · This week · Last week · Last month
  · This quarter · Last quarter · YTD.
- Iso-quarter (`2025-Q4`) and month (`2025-12`) accepted in the
  free-text field.
- Closes on Escape; focus returns to trigger; non-modal so the user
  can re-open without re-tabbing.

URL update: `?anchor=YYYY-MM-DD` for a starting-point jump, or
`?from=…&to=…` for a bounded range. Bounded range is what the
bookkeeper audit case and the export button consume.

### Filters in a long scroll

- Toolbar (Team / Member / Billable + Jump-to-date) is **sticky**
  below the masthead. Active-filter chips are visible at all times;
  the user always sees what's narrowing the log.
- Active-filter chips render as removable pills (X to clear). One-click
  filter change re-anchors the scroll to today (or to the most recent
  band that still has matching entries) — never strands the user
  scrolled-into-emptiness.

## Loading + perf strategy

### Bounded ranges, not infinite scroll

- **Default fetch window**: today + 13 prior days (14 days, two weeks).
  Subsequent loads append a week at a time.
- **Server-side hard cap**: 500 rows per fetch, regardless of date
  range. The client requests the next *page of days*, not a
  reach-into-history.
- **Cursor pagination on `(start_time DESC, id DESC)`**, no `OFFSET`.
  Same shape as `/expenses` after the cross-page bulk-select work.
- **Anchor / range validation**: `?anchor=2010-01-01` clamps to the
  user's earliest team-membership date; `?to` > today rejects;
  `from > to` rejects. Out-of-range responses return an empty state,
  not a 60-second query.
- **Date-band virtualization** (one DOM node per visible band, not
  per row). Test asserts: rendering N=2000 entries mounts < K DOM nodes.
- **Auto-load on scroll** is deliberately **off** for now. A "Load
  earlier (Mar 1 – Mar 7)" button at the bottom of the rendered range
  is an explicit user action, announces a polite live-region message
  on completion, and protects audit-screenshot stability. Auto-load
  graduates to a setting once we measure user behavior.

### Counts + visible-range totals

- **Filter chip counts** ("312 entries match") come from a server-side
  aggregate query keyed on the filter set + range, not from rendered
  DOM rows. Counts must round-trip identically to the export.
- **In-view counter** ("Showing 41 of 312") satisfies the persona
  rule on counts.
- **Daily / weekly band totals** come from a per-day aggregate, not
  `rows.reduce(...)`. A partially-loaded day must not lie about its
  total.

### Indexes

Verify before shipping: `time_entries (team_id, start_time DESC)` and
`time_entries (team_id, user_id, start_time DESC)` are present. The
existing day/week views already exercise the first index; the second
is needed for swim-lane queries (`members=all` filtered to a date
range). Add in the same migration if missing.

### Caching

No Next.js Data Cache here. Time entries are write-heavy for the user
viewing them (their own timer is running). Stale-while-revalidate
would create "I just stopped my timer, why don't I see it?" bugs.

### Anchor-jump rate limit

A user scripting `?anchor=<random-date>` once per second is a DoS on
Postgres. Sliding-window cap of 30 anchor jumps / minute / user;
beyond that, 429 + `logError({ action: 'unified-time-anchor-jump',
userId, teamId })`. Anchor jumps inside the loaded window don't
trigger a refetch and don't count.

## Authorization & cross-team safety

This view widens access patterns, not policy. RLS on `time_entries`
already enforces (see SAL-006):

> `user_id = auth.uid()` OR
> `user_team_role(team_id) IN ('owner','admin')` OR
> `<inlined cross-team branches>`

The Log adds **two new test surfaces** to
`src/__integration__/rls/time-entries-rls.test.ts`:

1. `describe("Unified Time view: deep-scroll respects SAL-006")` —
   three personas (member-self, member-other, owner), 5-year window.
   Both directions of the SAL-003 template:
   *allowed-user-succeeds* (owner sees everyone's entries) AND
   *blocked-user-sees-zero* (member sees only own + permitted).
2. `describe("Unified Time view: pre-membership data visibility")` —
   member who joined 2025-06-01 scrolls to 2024 sees no entries in
   their own log. **Decision required up front** (not deferred
   in code):
   - **Status quo**: pre-membership entries are visible to owner/admin
     per existing semantics. Document explicitly. No new gate.
   - **Defense in depth**: action layer adds a `membership_started_at`
     filter so a member viewing their own log never sees pre-join
     entries. Documented as a soft policy, enforced in queries, tested.
   Pick one; don't leave ambiguous.

### Export must respect the visible scope

`/api/time-entries/export/route.ts` is the only export path. The Log's
"Export" affordance must call the existing route with the **exact
same `URLSearchParams`** the page renders from — no extra fields
permitted. This is the SAL-009 shape: a sibling surface to a
role-gated path silently relaxing its gating because the new code
didn't reuse the old guard.

Test: an integration test asserts the Log's export request body is a
strict subset of the page URL params. CI regression-prevention.

## Period-lock interaction

The lock banner (currently above the table) becomes a **per-band
sticky strip**: on any band whose date is within a locked period, the
strip reads "Locked through 2026-03-31 by marcus" with a lock icon
(redundant encoding). The masthead banner is retained as a coarse
"some visible days are locked" signal but is no longer the only cue.

- Inline-edit affordances are absent on locked-day rows
  (`aria-disabled`, no kebab Edit). A user attempting to drag-drop or
  type into a locked band gets an inline "period closed" tooltip
  explaining who closed it and when, before they invest the keystrokes.
- An entry that was edited *after* its day was closed shows an
  "edited 2026-04-03 by marcus, was 2.0h, now 2.25h" caption
  in-band. Audit defense; never silent.

## Authorship rendering

Time-entry authorship is mandatory across the app. The dense Log row
must keep this invariant — not a regression to "avatar-only on hover."
Render via `<Avatar>` from `@theshyre/ui` paired with
`user_profiles.display_name`. Profile fetch tolerates the null path
(archived members) — initial + "Unknown user" tooltip, no throw.

## Keyboard model

Keys (all gated by "no input focused"; documented via visible `<kbd>`
chips on hover-reveal in a `?` help dialog and inline on relevant
controls):

- `L` / `D` / `W` — switch view (until Day retires; afterward `L`/`W`).
- `T` — jump to Today.
- `G` then date — open jump-to-date popover.
- `J` / `K` — next / previous entry.
- `Shift+J` / `Shift+K` — next / previous day band.
- `Shift+E` — expand / collapse focused day band.
- `Cmd+Enter` — submit any inline-edit form.
- `Escape` — close any popover or expansion.
- `Space` — start / stop timer (existing).

A negative test asserts `L` does not navigate when an editable element
or `contenteditable` has focus. Same gate logic as the existing
`view-toggle.tsx` D/W shortcuts.

## A11y requirements

- One `<section aria-labelledby="day-YYYY-MM-DD">` per band, `<h2>`
  per band heading, `aria-current="date"` on today's band heading.
  Heading-jump (rotor / `H` key) gives screen-reader users the
  natural analogue of "scroll to a day."
- Lazy-loaded older days announce via a polite live region:
  "Loaded April 14 through April 20." Never silent prepend.
- Running timer's per-second duration display is `aria-hidden`.
  Status-change announcements (start, stop, milestones) go through a
  separate debounced `role="status"` region.
- Date-jump uses a non-modal popover. Escape closes; focus returns to
  trigger. Arrow keys move days; PageUp/PageDown move months.
- Print stylesheet drops sticky headers, expands all collapsed days,
  removes the load-earlier sentinel. Defined at build time, not
  retrofitted.
- Three-theme contrast: weekend tint, today highlight, and
  band-header background pass WCAG AA in light, dark, and
  high-contrast. High-contrast tends to flatten weekend distinction
  unless we add a border or icon — required, not optional.

## Test plan

### Pre-implementation prerequisites

- **Time-edges fixtures module** (`src/__tests__/fixtures/time-edges.ts`)
  exists before any Log code lands. Today every `*-view.test.tsx`
  rolls its own DST/midnight fixtures; the Log will run that code on
  every render. Shared fixtures: spring-forward 02:30 entry,
  fall-back 01:30 entry, NYE 23:45–00:30 entry, leap-day 02-29 entry,
  far-future timer (clock skew client). Reuse across day/week/log
  views. Failure to prevent: fall-back hour rendered twice; NYE entry
  orphaned in neither year-band.
- **Virtualization contract test**: rendering N = 2000 entries mounts
  < K DOM nodes (K to be set after first benchmark). Without this,
  perf regressions have nowhere to land.

### Coverage

- **Date-jump input**: `2026-13-40`, `1900-01-01`, `2999-12-31`,
  `2024-02-29`, blank, whitespace, `4/29/2026` (locale). Each must
  have a deterministic outcome stated in the test name.
- **Period-lock × scroll**: scroll into locked week; assert edit
  affordances disabled, kebab omits Edit, `aria-disabled` set,
  attempt-to-edit surfaces tooltip not error toast.
- **Filter matrix**: member × billable × team × view-mode is 4 axes;
  one fixture-driven loop test asserting `expectedRowIds`.
- **Authorship null path**: `display_name: null`, `avatar_url: null`,
  join row entirely missing — no throw.
- **Keyboard collisions**: `L` does not navigate when input or
  `contenteditable` is focused. Negative test mandatory.
- **Daily / weekly / range totals round-trip identically to CSV
  export** for the same date span. Bookkeeper-grade parity test.
- **RLS deep-scroll**: SAL-006 personas, 5-year window (described
  above).
- **Print stylesheet**: Playwright run with `emulateMedia({ media:
  "print" })` asserts bands not sticky, no load-earlier sentinel.
- **A11y**: axe-core inside component tests; Playwright keyboard
  navigation between bands using Tab + Shift+J + PageDown.

### Sticky-header behavior

Visual-regression snapshot in Playwright (jsdom is unreliable for
sticky positioning).

## Phasing

**Phase 1 — schema-and-query-shape parity, no new view yet.** Lock
in the foundation that doesn't get re-litigated:

1. `time-edges.ts` shared fixtures.
2. Index audit + add `time_entries (team_id, user_id, start_time DESC)`
   if missing.
3. RLS deep-scroll integration tests against the existing day/week
   views (regression baseline).
4. Pre-membership-visibility decision documented + tested.
5. Aggregate-query helpers (per-day total, per-day billable split,
   per-range total) used by both day/week views and the upcoming Log.

**Phase 2 — Log view behind a flag.** `view=log` works; defaults
remain `view=week`. Daily band rendering, sticky headers, swim-lane
mode for `members != me`, locked-day visuals, jump-to-date popover,
keyboard model, a11y semantics. Day view stays in place.

**Phase 3 — promote Log to default; retire Day view.** Default
becomes `view=log` for new users; existing users keep last-selected.
Day view code removed, route param `view=day` redirects to `view=log`
with a flash explaining the change. Keyboard `D` shortcut remapped to
"jump to focused day's full detail page" (the print/share surface),
or removed entirely.

**Phase 4 — rollups + ranges.** `zoom=week|month` rollup bands,
`from`/`to` bounded-range URLs, `last_log_anchor` opt-in resume.

## Out of scope

Things considered but deliberately deferred:

- **Cross-team chronology** (interleaving entries from multiple teams
  in a single band). The single-team-required constraint is the v1
  answer; revisit only if real-world complaints arrive.
- **Auto-load on scroll** for older days. Explicit "Load earlier"
  button is the v1 affordance.
- **Per-hour timeline within a day** (gantt-style). Out of scope;
  the dense tabular row is enough.
- **Last-viewed-range auto-resume**. Available as opt-in setting in
  v4; never automatic.
- **In-Log multi-select / bulk operations.** Bulk lives on the table
  view per `multi-select-tables.md`. Log links "View as table" with
  current filters preserved.
- **Per-month / per-quarter rollup pages** (a "Reports" surface).
  Separate roadmap item.

## Open decisions

Closed decisions are above; these still need a call before phase 2
starts:

- **Pre-membership visibility**: status-quo (RLS-permitted only) vs.
  defense-in-depth gate. Pick one; document; test.
- **Print route**: do we add `/time-entries/day/YYYY-MM-DD` for the
  print/share case in phase 2, or defer entirely?
- **`L` shortcut after Day retires**: remap to "expand focused day"
  or remove.
- **Server cap value**: 500 rows/fetch is a placeholder; calibrate
  against the largest real teams' working ranges.
- **`?from`/`?to` cap**: 370 days is a placeholder; tighten if the
  RLS evaluation cost over multi-year ranges proves super-linear.

## Security audit log entries to add when this ships

Document these in `docs/security/SECURITY_AUDIT_LOG.md`:

- **SAL-NNN — Unified Time view: range-bounded RLS read.** The
  scrolling Log re-validates the SAL-006 read-side invariant under a
  new access pattern; record the deep-scroll integration tests +
  hard cap + index audit + anchor-jump rate limit, even if no bug.
- **SAL-NNN — Pre-membership-data exposure decision.** Either status
  quo (visibility intentional, scoped by role) or defense-in-depth
  gate (`membership_started_at` filter). Whichever is chosen, the
  threat-model rationale is logged so a future reviewer can tell
  intent from drift.

If we get this wrong: a 30-second timeout on a `?anchor=1900-01-01`
fetch is a **SAL-NNN — Unified Time view DoS via unbounded date
range**, severity Low (availability). The hard cap + index audit
prevents it.

## Success criteria for "shipped"

The feature is done when:

- A new user lands on `/time-entries` and sees today's entries with
  yesterday's already on screen below; scrolling reveals last week
  without a click.
- Jump-to-date `2026-03-15` lands on that band in <300ms with the
  scroll position deep-linkable as `?anchor=2026-03-15`.
- A 5-person team owner switching `members=all` sees swim-lane mode,
  not a chronological interleave.
- Scrolling into a locked period surfaces the per-band lock strip;
  inline-edit is absent (not "click and get a toast").
- Daily and weekly band totals round-trip identically to the CSV
  export of the same range.
- Screen-reader user navigating bands via heading-jump hears
  "Wed Apr 29, Today, 4 entries, 6h 15m, 4h 30m billable."
- High-contrast theme passes WCAG AA on weekend tint, today highlight,
  and locked-band lock chip.
- A 5-year scroll attempt with a stress fixture produces ≤500 rows,
  ≤K DOM nodes, and a clean "Load earlier" button — not a 30-second
  spinner.
- Day view route is gone; the `view=day` param redirects with no
  data loss.

## Persona reviews

This entry is the synthesis of eight persona lenses. Source notes
(internal — kept here as architectural context):

- **Solo-consultant**: Log replaces Day, never replaces Week.
  Masthead must stay this-ISO-week-anchored. Log wins on mobile and
  on "I forgot Tuesday"; loses on invoice-prep and 6-month-back review.
- **Agency-owner**: single chronological list is wrong at multi-author.
  Swim-lane mode required when `members != me`. Sticky per-band lock
  strip; "since you last viewed" pill; bounded ranges (no infinite
  scroll) for audit-screenshot stability. Defer multi-select to the
  table view.
- **Bookkeeper**: daily band totals from server aggregates, not
  rendered DOM. Year + quarter boundary rules. Locked-period bands
  have edit affordances absent (not error-toasted). Export from-the-view
  must respect visible scope. Default landing should consider
  "since-last-close" not just "today."
- **UX-designer**: don't add a third toggle siblings; demote Day to
  retired, make Log the page. Sticky day band + sticky filter bar.
  Inline expansion (not modal) for show-more. Running timer card stays
  in toolbar, not in today's band. Masthead total must be labeled
  scope ("This week") or it lies.
- **Accessibility-auditor**: `<section>` per day + `<h2>`,
  `aria-current="date"`. Sticky headers need `scroll-margin-top`.
  Date-jump non-modal popover. Lazy-load announcements via polite
  live region. Running timer per-second duration `aria-hidden`,
  milestones via separate `role="status"`. Print stylesheet from
  build time. Three-theme contrast for weekend / today / lock.
- **QA-tester**: pre-implementation prerequisites — shared
  time-edges fixture module, virtualization contract test, keyboard
  collision negative test. Filter matrix as fixture-driven loop.
  Sticky-header behavior in Playwright, not jsdom.
- **Security-reviewer**: server hard cap + cursor pagination + index
  audit + anchor-jump rate limit. Deep-scroll RLS integration tests
  (SAL-006 personas, 5-year window). Pre-membership visibility
  decision required up front. Export must reuse the role-gated route
  with a strict-subset URL params.
- **Platform-architect**: stays in Stint. No registry edit, no new
  module, no new tables. Cursor pagination, no offset. No Data Cache
  caching. Index `(team_id, start_time DESC)` re-used; add
  `(team_id, user_id, start_time DESC)` for swim-lane.
