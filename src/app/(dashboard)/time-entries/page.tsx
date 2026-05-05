import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUserContext, getUserTeams } from "@/lib/team-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("time");
  return { title: t("title") };
}
import {
  TZ_COOKIE_NAME,
  parseTzOffset,
  getLocalToday,
  getLocalWeekStart,
  addLocalDays,
  localDateMidnightUtc,
  validateLocalDateStr,
  getOffsetForZone,
} from "@/lib/time/tz";
import { getMyTemplates } from "@/lib/templates/queries";
import { getMembershipJoinedAt } from "@/lib/time/membership";
import { getUserSettings } from "@/lib/user-settings";
import { TimeHome } from "./time-home";
import { NoTeamEmptyState } from "./no-team-empty-state";
import type { TimeView } from "./view-toggle";
import type { CategoryOption, TimeEntry } from "./types";

// Supabase returns `projects(..., customers(...))` with `customers` as a
// 1-element array even though it's a single FK row. Unwrap so downstream
// code can read `entry.projects.customers.name` cleanly. Same shape for
// the optional `invoices(invoice_number)` join — flatten it onto the
// row as `invoice_number` so the lock-state UI can read it directly.
function normalizeEntry<
  T extends { projects: unknown; invoices?: unknown },
>(row: T): T & { invoice_number: string | null } {
  const projects = row.projects as
    | { customers?: unknown; [key: string]: unknown }
    | null;
  const invoices = row.invoices as
    | { invoice_number?: string | null }
    | Array<{ invoice_number?: string | null }>
    | null;
  const invoiceNumber = (() => {
    if (!invoices) return null;
    if (Array.isArray(invoices)) {
      return (invoices[0]?.invoice_number as string | null) ?? null;
    }
    return (invoices.invoice_number as string | null) ?? null;
  })();
  if (!projects) {
    return { ...row, invoice_number: invoiceNumber };
  }
  const customers = projects.customers;
  const unwrapped = Array.isArray(customers)
    ? (customers[0] ?? null)
    : (customers ?? null);
  return {
    ...row,
    projects: { ...projects, customers: unwrapped },
    invoice_number: invoiceNumber,
  };
}

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * time_entries.user_id FK points at auth.users, not user_profiles, so
 * PostgREST can't auto-join the profile. Batch-fetch profiles for the
 * set of authors once, then attach to each entry. Null when the profile
 * row is missing (shouldn't happen post-signup trigger, but be tolerant).
 */
async function attachAuthors<T extends { user_id: string }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entries: T[],
): Promise<(T & { author: ProfileRow | null })[]> {
  const userIds = Array.from(
    new Set(entries.map((e) => e.user_id).filter(Boolean)),
  );
  if (userIds.length === 0) return entries.map((e) => ({ ...e, author: null }));
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, avatar_url")
    .in("user_id", userIds);
  const byId = new Map<string, ProfileRow>(
    (profiles ?? []).map((p) => [
      p.user_id as string,
      {
        user_id: p.user_id as string,
        display_name: (p.display_name as string | null) ?? null,
        avatar_url: (p.avatar_url as string | null) ?? null,
      },
    ]),
  );
  return entries.map((e) => ({ ...e, author: byId.get(e.user_id) ?? null }));
}

interface PageProps {
  searchParams: Promise<{
    org?: string;
    view?: string;
    anchor?: string;
    billable?: string;
    members?: string;
    /** Log view only — how many days back from anchor to render.
     *  Default 14, max 90. Clamped server-side. */
    windowDays?: string;
  }>;
}

function asView(v: string | undefined): TimeView {
  if (v === "day") return "day";
  if (v === "log") return "log";
  return "week";
}

const LOG_DEFAULT_WINDOW_DAYS = 14;
const LOG_MAX_WINDOW_DAYS = 90;

function parseWindowDays(raw: string | undefined): number {
  if (!raw) return LOG_DEFAULT_WINDOW_DAYS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return LOG_DEFAULT_WINDOW_DAYS;
  return Math.min(n, LOG_MAX_WINDOW_DAYS);
}

/** URL-param serialization for the members filter. */
export type MemberSelection = "me" | "all" | "none" | string[];

function parseMembers(raw: string | undefined): MemberSelection {
  if (!raw) return "me";
  if (raw === "all") return "all";
  if (raw === "none") return "none";
  if (raw === "me") return "me";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.length === 0 ? "me" : ids;
}

/**
 * Resolve the MemberSelection to the concrete user_id list we filter
 * queries by. Returns null to mean "no user filter" (the `all` case —
 * RLS still narrows to what the caller can see).
 */
function resolveMemberFilter(
  selection: MemberSelection,
  callerId: string,
): string[] | null {
  if (selection === "all") return null;
  if (selection === "me") return [callerId];
  if (selection === "none") return [];
  return selection;
}

export default async function TimeEntriesPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const { userId: callerId } = await getUserContext();
  const teams = await getUserTeams();
  const sp = await searchParams;
  const { org: selectedTeamId } = sp;
  const memberSelection = parseMembers(sp.members);
  const memberFilter = resolveMemberFilter(memberSelection, callerId);

  // No teams → no surface to log time into. Short-circuit to a guidance
  // page instead of rendering the Timer form against a void of projects.
  if (teams.length === 0) {
    return <NoTeamEmptyState />;
  }

  const userTeamIds = teams.map((tm) => tm.id);

  // ────────────────────────────────────────────────────────────
  // Phase 0 — settings + (single) self-scoped floor lookup, in parallel.
  //
  // Pre-2026-05-04 this section ran 3 separate awaits: one
  // `user_settings.timezone` query (now folded into the cached
  // getUserSettings shared with the layout) and TWO
  // selfScopedFloor calls — one for week, one for day — each
  // re-fetching the same `team_members.joined_at` row. A third
  // call sat inside Phase 1 for log view. Now: one
  // joined_at lookup feeds all three floors as pure max math.
  //
  // Cookie-derived tz offset is sync-ish; we resolve cookies()
  // before the Promise.all so the Phase 0 wall-clock cost is
  // just the slowest of the two fetches (typically the joined_at
  // lookup when self-scoped, ~150ms; both are skippable in
  // common cases).
  // ────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const cookieOffset = parseTzOffset(cookieStore.get(TZ_COOKIE_NAME)?.value);

  // joined_at is needed only when the caller is viewing their own
  // entries on a single specific team. In any other shape (all
  // teams, or members ≠ self) the membership floor doesn't apply
  // and we skip the round-trip.
  const needsMembershipFloor =
    selectedTeamId !== undefined &&
    memberFilter !== null &&
    memberFilter.length === 1 &&
    memberFilter[0] === callerId;

  const [userSettings, joinedAt] = await Promise.all([
    getUserSettings(),
    needsMembershipFloor && selectedTeamId
      ? getMembershipJoinedAt(supabase, callerId, selectedTeamId)
      : Promise.resolve(null),
  ]);

  const tzOffsetMin = userSettings.timezone
    ? getOffsetForZone(userSettings.timezone, new Date())
    : cookieOffset;

  const view = asView(sp.view);
  const billableOnly = sp.billable === "1";

  // All day math happens as local-date strings (YYYY-MM-DD) in the user's TZ.
  // Only converted to UTC timestamps right before hitting the DB.
  const today = getLocalToday(tzOffsetMin);
  const anchor = validateLocalDateStr(sp.anchor) ?? today;
  const weekStart = getLocalWeekStart(anchor);
  const weekEnd = addLocalDays(weekStart, 7);
  const day = anchor;
  const dayEnd = addLocalDays(day, 1);

  const weekStartUtc = localDateMidnightUtc(weekStart, tzOffsetMin);
  const weekEndUtc = localDateMidnightUtc(weekEnd, tzOffsetMin);
  const dayStartUtc = localDateMidnightUtc(day, tzOffsetMin);
  const dayEndUtc = localDateMidnightUtc(dayEnd, tzOffsetMin);

  // Defense-in-depth: when self-scoped (members=me) on a single team,
  // clamp the lower bound to team_members.joined_at. See
  // `docs/reference/unified-time.md` §Authorization & cross-team safety.
  // Pure derivation now — joined_at was fetched once in Phase 0.
  function applyMembershipFloor(windowStart: Date): Date {
    if (!joinedAt) return windowStart;
    return joinedAt > windowStart ? joinedAt : windowStart;
  }
  const weekFloorUtc = applyMembershipFloor(weekStartUtc);
  const dayFloorUtc = applyMembershipFloor(dayStartUtc);

  // ────────────────────────────────────────────────────────────
  // Phase 1 — fire every independent query in parallel.
  //
  // Pre-2026-05-04 this section was 13+ serial awaits that
  // accumulated ~1.4s of round-trip latency on the free Supabase
  // tier (each round-trip ~50-200ms on shared compute). Restructure
  // into one Promise.all so the wall-clock time is the slowest
  // single query, not the sum.
  //
  // View-aware gates: dayEntries only fetches when view===day;
  // weekEntries skips when view===log; logEntries was already
  // gated. Saves one full round-trip on Week + Log loads.
  // ────────────────────────────────────────────────────────────

  // Log range — same math as before, hoisted up so the gated
  // logQuery can reference it inside Phase 1.
  const logWindowDays = parseWindowDays(sp.windowDays);
  const logRangeStart =
    view === "log" ? addLocalDays(anchor, -(logWindowDays - 1)) : null;
  const logStartUtc = logRangeStart
    ? localDateMidnightUtc(logRangeStart, tzOffsetMin)
    : null;
  const logEndUtc = logRangeStart
    ? localDateMidnightUtc(addLocalDays(anchor, 1), tzOffsetMin)
    : null;
  // log floor — pure derivation from the Phase-0 joined_at, same
  // contract selfScopedFloor enforces. No round-trip.
  const logFloorUtc =
    view === "log" && logStartUtc ? applyMembershipFloor(logStartUtc) : null;

  function applyMemberFilter<T extends { in: (col: string, vals: string[]) => T; eq: (col: string, val: string) => T }>(
    query: T,
  ): T {
    if (memberFilter === null) return query;
    if (memberFilter.length === 0) {
      // "none" — return no rows by filtering on an impossible user_id.
      return query.eq("user_id", "00000000-0000-0000-0000-000000000000");
    }
    return query.in("user_id", memberFilter);
  }

  const recentSinceIso = new Date(
    new Date().getTime() - 30 * 24 * 3600 * 1000,
  ).toISOString();

  const ENTRY_SELECT =
    "*, projects(id, name, github_repo, category_set_id, require_timestamps, is_internal, default_billable, customers(id, name)), invoices(invoice_number)";

  // Build week query — fetched on Day (for the weekly-totals strip) and
  // Week (for the grid). Skipped on Log to avoid a 7-day scan that view
  // doesn't render.
  const weekPromise = (() => {
    if (view === "log") return Promise.resolve({ data: [] });
    let q = supabase
      .from("time_entries")
      .select(ENTRY_SELECT)
      .is("deleted_at", null)
      .gte("start_time", weekFloorUtc.toISOString())
      .lt("start_time", weekEndUtc.toISOString())
      .order("start_time", { ascending: true });
    if (selectedTeamId) q = q.eq("team_id", selectedTeamId);
    if (billableOnly) q = q.eq("billable", true);
    return applyMemberFilter(q);
  })();

  // Day query — only the Day view consumes the result. Week and Log
  // both skip; their masthead totals come from weekEntries / logEntries.
  const dayPromise = (() => {
    if (view !== "day") return Promise.resolve({ data: [] });
    let q = supabase
      .from("time_entries")
      .select(ENTRY_SELECT)
      .is("deleted_at", null)
      .gte("start_time", dayFloorUtc.toISOString())
      .lt("start_time", dayEndUtc.toISOString())
      .order("start_time", { ascending: true });
    if (selectedTeamId) q = q.eq("team_id", selectedTeamId);
    if (billableOnly) q = q.eq("billable", true);
    return applyMemberFilter(q);
  })();

  // Active projects — fetched always; new-entry form + Recent chips
  // need them on every view.
  const projectsPromise = (() => {
    let q = supabase
      .from("projects")
      .select(
        "id, name, github_repo, team_id, category_set_id, require_timestamps, is_internal, default_billable, customers(id, name)",
      )
      .eq("status", "active")
      .in("team_id", userTeamIds)
      .order("name");
    if (selectedTeamId) q = q.eq("team_id", selectedTeamId);
    return q;
  })();

  // Recent projects — last 30 days of project_ids; doesn't depend on
  // the projects fetch (we resolve project IDs against the project
  // list afterwards, not via PostgREST embedding).
  const recentPromise = (() => {
    let q = supabase
      .from("time_entries")
      .select("project_id, start_time")
      .is("deleted_at", null)
      .gte("start_time", recentSinceIso)
      .order("start_time", { ascending: false })
      .limit(50);
    if (selectedTeamId) q = q.eq("team_id", selectedTeamId);
    return q;
  })();

  // Running timer.
  const runningPromise = (() => {
    let q = supabase
      .from("time_entries")
      .select(ENTRY_SELECT)
      .is("end_time", null)
      .is("deleted_at", null)
      .order("start_time", { ascending: false })
      .limit(1);
    if (selectedTeamId) q = q.eq("team_id", selectedTeamId);
    return q;
  })();

  // Member list (memberships + the subsequent profile lookup) — phase 1
  // gets memberships; phase 2 fetches profiles. Always needed; the
  // member filter dropdown shows on every view.
  const memberTeamIds = selectedTeamId ? [selectedTeamId] : userTeamIds;
  const memberRowsPromise =
    memberTeamIds.length > 0
      ? supabase
          .from("team_members")
          .select("user_id, role, joined_at")
          .in("team_id", memberTeamIds)
          .order("joined_at", { ascending: true })
      : Promise.resolve({ data: [] as Array<{ user_id: string; role: string; joined_at: string }> });

  // Trash count.
  const trashPromise = (() => {
    let q = supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .not("deleted_at", "is", null);
    if (selectedTeamId) q = q.eq("team_id", selectedTeamId);
    return q;
  })();

  // Period locks.
  const lockTeamIds = selectedTeamId ? [selectedTeamId] : userTeamIds;
  const lockRowsPromise =
    lockTeamIds.length > 0
      ? supabase
          .from("team_period_locks")
          .select("team_id, period_end")
          .in("team_id", lockTeamIds)
      : Promise.resolve({ data: [] as Array<{ team_id: string; period_end: string }> });

  const templatesPromise = getMyTemplates(selectedTeamId);

  const [
    { data: rawWeekEntries },
    { data: rawDayEntries },
    { data: rawProjects },
    { data: recentRows },
    { data: runningEntries },
    { data: memberRows },
    { count: trashCount },
    { data: lockRows },
    allTemplates,
  ] = await Promise.all([
    weekPromise,
    dayPromise,
    projectsPromise,
    recentPromise,
    runningPromise,
    memberRowsPromise,
    trashPromise,
    lockRowsPromise,
    templatesPromise,
  ]);

  // ────────────────────────────────────────────────────────────
  // Phase 2 — dependent reads run in parallel with each other.
  // ────────────────────────────────────────────────────────────

  const projectsRaw = (rawProjects ?? []).map((p) => ({
    ...p,
    customers: Array.isArray(p.customers)
      ? (p.customers[0] ?? null)
      : (p.customers ?? null),
  }));
  const projectIds = projectsRaw.map((p) => p.id);
  const memberUserIds = Array.from(
    new Set((memberRows ?? []).map((m) => m.user_id as string)),
  );

  // logFloorUtc resolved synchronously in Phase 0 from the shared
  // joined_at. Whether to issue the log query is gated identically
  // to the prior contract.
  const logEntriesPromise =
    view === "log" && logFloorUtc && logEndUtc
      ? (() => {
          let q = supabase
            .from("time_entries")
            .select(ENTRY_SELECT)
            .is("deleted_at", null)
            .gte("start_time", logFloorUtc.toISOString())
            .lt("start_time", logEndUtc.toISOString())
            .order("start_time", { ascending: true });
          if (selectedTeamId) q = q.eq("team_id", selectedTeamId);
          if (billableOnly) q = q.eq("billable", true);
          return applyMemberFilter(q);
        })()
      : Promise.resolve({ data: null });

  const extensionSetsPromise = projectIds.length
    ? supabase
        .from("category_sets")
        .select("id, project_id")
        .in("project_id", projectIds)
    : Promise.resolve({
        data: [] as Array<{ id: string; project_id: string }>,
      });

  const memberProfilesPromise =
    memberUserIds.length > 0
      ? supabase
          .from("user_profiles")
          .select("user_id, display_name, avatar_url")
          .in("user_id", memberUserIds)
      : Promise.resolve({
          data: [] as Array<{
            user_id: string;
            display_name: string | null;
            avatar_url: string | null;
          }>,
        });

  const [
    { data: rawLogEntries },
    { data: extensionSets },
    { data: memberProfilesRaw },
  ] = await Promise.all([
    logEntriesPromise,
    extensionSetsPromise,
    memberProfilesPromise,
  ]);

  // Stitch projects + extensions; resolve category_set ids needed
  // for the categories fetch.
  const extensionByProject = new Map<string, string>();
  for (const row of extensionSets ?? []) {
    extensionByProject.set(row.project_id as string, row.id as string);
  }
  const projects = projectsRaw.map((p) => ({
    ...p,
    extension_category_set_id: extensionByProject.get(p.id) ?? null,
  }));
  const setIds = Array.from(
    new Set(
      projects
        .flatMap((p) => [p.category_set_id, p.extension_category_set_id])
        .filter((id): id is string => !!id),
    ),
  );

  // ────────────────────────────────────────────────────────────
  // Phase 3 — categories + entry-author profile attaches. Each
  // depends on the previous phase. Run in parallel.
  // ────────────────────────────────────────────────────────────

  const categoriesPromise = setIds.length
    ? supabase
        .from("categories")
        .select("id, category_set_id, name, color, sort_order")
        .in("category_set_id", setIds)
        .order("sort_order", { ascending: true })
    : Promise.resolve({ data: [] as Array<unknown> });

  // The Promise.all result types widened to Record<string, unknown>[]
  // because Phase 1's promise pool unions the typed Supabase
  // builders with the Promise.resolve fallbacks for gated queries.
  // Cast the raw rows back to the shape they actually have at
  // runtime — same shape the pre-refactor code relied on inference
  // to produce.
  type RawEntryRow = {
    id: string;
    user_id: string;
    projects: unknown;
    invoices?: unknown;
    [key: string]: unknown;
  };
  const weekEntriesPromise = attachAuthors(
    supabase,
    ((rawWeekEntries ?? []) as RawEntryRow[]).map(normalizeEntry),
  );
  const dayEntriesPromise = attachAuthors(
    supabase,
    ((rawDayEntries ?? []) as RawEntryRow[]).map(normalizeEntry),
  );
  const logEntriesP = view === "log"
    ? attachAuthors(
        supabase,
        ((rawLogEntries ?? []) as RawEntryRow[]).map(normalizeEntry),
      )
    : Promise.resolve([] as Awaited<ReturnType<typeof attachAuthors>>);
  const runningP = runningEntries?.[0]
    ? attachAuthors(supabase, [
        normalizeEntry(runningEntries[0] as RawEntryRow),
      ]).then((rows) => rows[0] ?? null)
    : Promise.resolve(null);

  const [
    { data: categoryRows },
    weekEntries,
    dayEntries,
    logEntries,
    running,
  ] = await Promise.all([
    categoriesPromise,
    weekEntriesPromise,
    dayEntriesPromise,
    logEntriesP,
    runningP,
  ]);

  const categories = categoryRows ?? [];

  // Recent projects — distinct project_ids from the last 30 days,
  // top 5, joined back against the active project list so an
  // archived project's row doesn't sneak into the chips.
  const seen = new Set<string>();
  const recentProjectIds: string[] = [];
  for (const row of recentRows ?? []) {
    if (!seen.has(row.project_id)) {
      seen.add(row.project_id);
      recentProjectIds.push(row.project_id);
    }
    if (recentProjectIds.length >= 5) break;
  }
  const recentProjects = recentProjectIds
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  const templates = allTemplates.slice(0, 8);

  // Member-filter dropdown — combine memberRows (from phase 1) with
  // memberProfilesRaw (from phase 2). Self moves to the top.
  const profileByUserId = new Map<
    string,
    { display_name: string | null; avatar_url: string | null }
  >(
    (memberProfilesRaw ?? []).map((p) => [
      p.user_id as string,
      {
        display_name: (p.display_name as string | null) ?? null,
        avatar_url: (p.avatar_url as string | null) ?? null,
      },
    ]),
  );
  const byUserId = new Map<
    string,
    {
      user_id: string;
      display_name: string | null;
      avatar_url: string | null;
      isSelf: boolean;
    }
  >();
  for (const userId of memberUserIds) {
    if (byUserId.has(userId)) continue;
    const profile = profileByUserId.get(userId);
    byUserId.set(userId, {
      user_id: userId,
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      isSelf: userId === callerId,
    });
  }
  const self = [...byUserId.values()].find((m) => m.isSelf);
  const others = [...byUserId.values()].filter((m) => !m.isSelf);
  const memberOptions = self ? [self, ...others] : others;

  // Latest period lock per team in scope — drives the "Locked
  // through" banner so users editing a March entry on April 5 see
  // the lock state inline instead of getting an opaque DB error
  // from the trigger. Mirrors the expenses page's banner.
  const latestLockByTeam = new Map<string, string>();
  for (const r of lockRows ?? []) {
    const tid = r.team_id as string;
    const cur = latestLockByTeam.get(tid);
    const next = r.period_end as string;
    if (!cur || cur < next) latestLockByTeam.set(tid, next);
  }
  const teamNameById = new Map(teams.map((tm) => [tm.id, tm.name]));
  const showTeamLabels = !selectedTeamId && latestLockByTeam.size > 1;
  const lockSummary =
    latestLockByTeam.size === 0
      ? null
      : Array.from(latestLockByTeam.entries())
          .map(([tid, end]) =>
            showTeamLabels
              ? `${teamNameById.get(tid) ?? ""}: ${end}`
              : end,
          )
          .join(" · ");

  return (
    <TimeHome
      teams={teams}
      selectedTeamId={selectedTeamId ?? null}
      view={view}
      billableOnly={billableOnly}
      dayStr={day}
      weekStartStr={weekStart}
      anchorStr={anchor}
      todayStr={today}
      tzOffsetMin={tzOffsetMin}
      currentUserId={callerId}
      weekEntries={weekEntries as unknown as TimeEntry[]}
      dayEntries={dayEntries as unknown as TimeEntry[]}
      logEntries={logEntries as unknown as TimeEntry[]}
      logWindowDays={logWindowDays}
      logDefaultWindowDays={LOG_DEFAULT_WINDOW_DAYS}
      logMaxWindowDays={LOG_MAX_WINDOW_DAYS}
      running={running as unknown as TimeEntry | null}
      projects={projects}
      recentProjects={recentProjects}
      categories={categories as unknown as CategoryOption[]}
      templates={templates}
      trashCount={trashCount ?? 0}
      memberOptions={memberOptions}
      memberSelection={memberSelection}
      lockSummary={lockSummary}
    />
  );
}
