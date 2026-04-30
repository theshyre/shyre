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
import { selfScopedFloor } from "@/lib/time/membership";
import { TimeHome } from "./time-home";
import { NoTeamEmptyState } from "./no-team-empty-state";
import type { TimeView } from "./view-toggle";

// Supabase returns `projects(..., customers(...))` with `customers` as a
// 1-element array even though it's a single FK row. Unwrap so downstream
// code can read `entry.projects.customers.name` cleanly.
function normalizeEntry<T extends { projects: unknown }>(row: T): T {
  const projects = row.projects as
    | { customers?: unknown; [key: string]: unknown }
    | null;
  if (!projects) return row;
  const customers = projects.customers;
  const unwrapped = Array.isArray(customers)
    ? (customers[0] ?? null)
    : (customers ?? null);
  return {
    ...row,
    projects: { ...projects, customers: unwrapped },
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
  }>;
}

function asView(v: string | undefined): TimeView {
  return v === "day" ? "day" : "week";
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

  // User's effective tz: prefer the explicit IANA setting from user_settings,
  // falling back to the browser-detected offset cookie, falling back to UTC.
  const cookieStore = await cookies();
  const cookieOffset = parseTzOffset(cookieStore.get(TZ_COOKIE_NAME)?.value);
  const { data: userPrefs } = await supabase
    .from("user_settings")
    .select("timezone")
    .maybeSingle();
  const tzOffsetMin = userPrefs?.timezone
    ? getOffsetForZone(userPrefs.timezone, new Date())
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
  // No-op when team is "all" or when memberFilter isn't strictly self.
  const weekFloorUtc = await selfScopedFloor(
    supabase,
    callerId,
    selectedTeamId ?? null,
    memberFilter,
    weekStartUtc,
  );
  const dayFloorUtc = await selfScopedFloor(
    supabase,
    callerId,
    selectedTeamId ?? null,
    memberFilter,
    dayStartUtc,
  );

  // Week entries — used by both views (week grid + day view's daily-total strip)
  let weekQuery = supabase
    .from("time_entries")
    .select(
      "*, projects(id, name, github_repo, category_set_id, require_timestamps, customers(id, name))",
    )
    .is("deleted_at", null)
    .gte("start_time", weekFloorUtc.toISOString())
    .lt("start_time", weekEndUtc.toISOString())
    .order("start_time", { ascending: true });
  if (selectedTeamId) weekQuery = weekQuery.eq("team_id", selectedTeamId);
  if (billableOnly) weekQuery = weekQuery.eq("billable", true);
  if (memberFilter !== null) {
    if (memberFilter.length === 0) {
      // "none" — return no rows by filtering on an impossible user_id.
      weekQuery = weekQuery.eq("user_id", "00000000-0000-0000-0000-000000000000");
    } else {
      weekQuery = weekQuery.in("user_id", memberFilter);
    }
  }
  const { data: rawWeekEntries } = await weekQuery;
  const weekEntries = await attachAuthors(
    supabase,
    (rawWeekEntries ?? []).map(normalizeEntry),
  );

  // Day entries — used by day view's entry list
  let dayQuery = supabase
    .from("time_entries")
    .select(
      "*, projects(id, name, github_repo, category_set_id, require_timestamps, customers(id, name))",
    )
    .is("deleted_at", null)
    .gte("start_time", dayFloorUtc.toISOString())
    .lt("start_time", dayEndUtc.toISOString())
    .order("start_time", { ascending: true });
  if (selectedTeamId) dayQuery = dayQuery.eq("team_id", selectedTeamId);
  if (billableOnly) dayQuery = dayQuery.eq("billable", true);
  if (memberFilter !== null) {
    if (memberFilter.length === 0) {
      dayQuery = dayQuery.eq("user_id", "00000000-0000-0000-0000-000000000000");
    } else {
      dayQuery = dayQuery.in("user_id", memberFilter);
    }
  }
  const { data: rawDayEntries } = await dayQuery;
  const dayEntries = await attachAuthors(
    supabase,
    (rawDayEntries ?? []).map(normalizeEntry),
  );

  // Running timer
  let runningQuery = supabase
    .from("time_entries")
    .select(
      "*, projects(id, name, github_repo, category_set_id, require_timestamps, customers(id, name))",
    )
    .is("end_time", null)
    .is("deleted_at", null)
    .order("start_time", { ascending: false })
    .limit(1);
  if (selectedTeamId) runningQuery = runningQuery.eq("team_id", selectedTeamId);
  const { data: runningEntries } = await runningQuery;
  const runningAttached = runningEntries?.[0]
    ? (
        await attachAuthors(supabase, [normalizeEntry(runningEntries[0])])
      )[0] ?? null
    : null;
  const running = runningAttached;

  // Active projects — scoped to teams the user is an actual member of.
  // RLS would also let through customer-shared projects from other teams,
  // but our "you can only log time to teams you're a member of" rule means
  // those projects can't be targets of a new entry. Hide them here so
  // Recent-projects chips and the Start form never show a project that
  // would be rejected on submit.
  let projectsQuery = supabase
    .from("projects")
    .select(
      "id, name, github_repo, team_id, category_set_id, require_timestamps, customers(id, name)",
    )
    .eq("status", "active")
    .in("team_id", userTeamIds)
    .order("name");
  if (selectedTeamId) projectsQuery = projectsQuery.eq("team_id", selectedTeamId);
  const { data: rawProjects } = await projectsQuery;
  const projectsRaw = (rawProjects ?? []).map((p) => ({
    ...p,
    customers: Array.isArray(p.customers) ? (p.customers[0] ?? null) : (p.customers ?? null),
  }));

  // Project-scoped extension category sets, if any. A project's picker
  // shows categories from its base set UNION its extension set.
  const projectIds = projectsRaw.map((p) => p.id);
  const { data: extensionSets } = projectIds.length
    ? await supabase
        .from("category_sets")
        .select("id, project_id")
        .in("project_id", projectIds)
    : { data: [] };
  const extensionByProject = new Map<string, string>();
  for (const row of extensionSets ?? []) {
    extensionByProject.set(row.project_id as string, row.id as string);
  }
  const projects = projectsRaw.map((p) => ({
    ...p,
    extension_category_set_id: extensionByProject.get(p.id) ?? null,
  }));

  // Categories visible to any project's category set (base OR extension).
  const setIds = Array.from(
    new Set(
      projects
        .flatMap((p) => [p.category_set_id, p.extension_category_set_id])
        .filter((id): id is string => !!id),
    ),
  );
  const { data: categoryRows } = setIds.length
    ? await supabase
        .from("categories")
        .select("id, category_set_id, name, color, sort_order")
        .in("category_set_id", setIds)
        .order("sort_order", { ascending: true })
    : { data: [] };
  const categories = categoryRows ?? [];

  // Recent projects — distinct project_ids from the last 30 days.
  // Compute against `new Date()` explicitly — calling it via `new Date()`
  // is allowed, whereas `Date.now()` trips the impure-in-render rule even
  // though this is a server component (the lint rule is context-unaware).
  const recentSinceIso = new Date(
    new Date().getTime() - 30 * 24 * 3600 * 1000,
  ).toISOString();
  let recentQuery = supabase
    .from("time_entries")
    .select("project_id, start_time")
    .is("deleted_at", null)
    .gte("start_time", recentSinceIso)
    .order("start_time", { ascending: false })
    .limit(50);
  if (selectedTeamId) recentQuery = recentQuery.eq("team_id", selectedTeamId);
  const { data: recentRows } = await recentQuery;
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

  const allTemplates = await getMyTemplates(selectedTeamId);
  const templates = allTemplates.slice(0, 8);

  // Team-member list for the member-filter dropdown.
  //
  // Scope depends on the team-filter state:
  //   - A specific team is selected → members of that team.
  //   - Team filter is "All" (no selection) → members across every team
  //     the caller belongs to, deduplicated by user_id so someone who
  //     belongs to multiple teams shows up once.
  //
  // The filter is useful in both modes. When viewing "All", the user
  // still wants to say "show only me + Jordan + Riley" even if entries
  // may come from multiple teams.
  const memberTeamIds = selectedTeamId ? [selectedTeamId] : userTeamIds;
  let memberOptions: Array<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    isSelf: boolean;
  }> = [];
  if (memberTeamIds.length > 0) {
    // Two-step: team_members has no FK to user_profiles (both go through
    // auth.users), so PostgREST can't embed. Fetch memberships first,
    // then batch-fetch profiles.
    const { data: memberRows } = await supabase
      .from("team_members")
      .select("user_id, role, joined_at")
      .in("team_id", memberTeamIds)
      .order("joined_at", { ascending: true });
    const memberUserIds = Array.from(
      new Set((memberRows ?? []).map((m) => m.user_id as string)),
    );
    const { data: profiles } = memberUserIds.length > 0
      ? await supabase
          .from("user_profiles")
          .select("user_id, display_name, avatar_url")
          .in("user_id", memberUserIds)
      : { data: [] };
    const profileByUserId = new Map<
      string,
      { display_name: string | null; avatar_url: string | null }
    >(
      (profiles ?? []).map((p) => [
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
    // Move self to the top for consistent ordering.
    const self = [...byUserId.values()].find((m) => m.isSelf);
    const others = [...byUserId.values()].filter((m) => !m.isSelf);
    memberOptions = self ? [self, ...others] : others;
  }

  // Trash count — only surfaced in the UI if > 0
  let trashQuery = supabase
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .not("deleted_at", "is", null);
  if (selectedTeamId) trashQuery = trashQuery.eq("team_id", selectedTeamId);
  const { count: trashCount } = await trashQuery;

  // Latest period lock per team in scope — drives the "Locked
  // through" banner so users editing a March entry on April 5 see
  // the lock state inline instead of getting an opaque DB error
  // from the trigger. Mirrors the expenses page's banner.
  const lockTeamIds = selectedTeamId ? [selectedTeamId] : userTeamIds;
  const { data: lockRows } =
    lockTeamIds.length > 0
      ? await supabase
          .from("team_period_locks")
          .select("team_id, period_end")
          .in("team_id", lockTeamIds)
      : { data: [] };
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
      tzOffsetMin={tzOffsetMin}
      currentUserId={callerId}
      weekEntries={weekEntries}
      dayEntries={dayEntries}
      running={running}
      projects={projects}
      recentProjects={recentProjects}
      categories={categories}
      templates={templates}
      trashCount={trashCount ?? 0}
      memberOptions={memberOptions}
      memberSelection={memberSelection}
      lockSummary={lockSummary}
    />
  );
}
