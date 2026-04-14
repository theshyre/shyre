import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
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
import { TimeHome } from "./time-home";
import type { TimeView } from "./view-toggle";

// Supabase returns `projects(..., clients(...))` with `clients` as a 1-element
// array even though it's a single FK row. Unwrap so downstream code can read
// `entry.projects.clients.name` cleanly.
function normalizeEntry<T extends { projects: unknown }>(row: T): T {
  const projects = row.projects as
    | { clients?: unknown; [key: string]: unknown }
    | null;
  if (!projects) return row;
  const clients = projects.clients;
  const unwrappedClients = Array.isArray(clients)
    ? (clients[0] ?? null)
    : (clients ?? null);
  return {
    ...row,
    projects: { ...projects, clients: unwrappedClients },
  };
}

interface PageProps {
  searchParams: Promise<{
    org?: string;
    view?: string;
    anchor?: string;
    billable?: string;
  }>;
}

function asView(v: string | undefined): TimeView {
  return v === "day" ? "day" : "week";
}

export default async function TimeEntriesPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const sp = await searchParams;
  const { org: selectedOrgId } = sp;

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

  // Week entries — used by both views (week grid + day view's daily-total strip)
  let weekQuery = supabase
    .from("time_entries")
    .select(
      "*, projects(id, name, github_repo, category_set_id, require_timestamps, clients(id, name))",
    )
    .gte("start_time", weekStartUtc.toISOString())
    .lt("start_time", weekEndUtc.toISOString())
    .order("start_time", { ascending: true });
  if (selectedOrgId) weekQuery = weekQuery.eq("organization_id", selectedOrgId);
  if (billableOnly) weekQuery = weekQuery.eq("billable", true);
  const { data: rawWeekEntries } = await weekQuery;
  const weekEntries = (rawWeekEntries ?? []).map(normalizeEntry);

  // Day entries — used by day view's entry list
  let dayQuery = supabase
    .from("time_entries")
    .select(
      "*, projects(id, name, github_repo, category_set_id, require_timestamps, clients(id, name))",
    )
    .gte("start_time", dayStartUtc.toISOString())
    .lt("start_time", dayEndUtc.toISOString())
    .order("start_time", { ascending: true });
  if (selectedOrgId) dayQuery = dayQuery.eq("organization_id", selectedOrgId);
  if (billableOnly) dayQuery = dayQuery.eq("billable", true);
  const { data: rawDayEntries } = await dayQuery;
  const dayEntries = (rawDayEntries ?? []).map(normalizeEntry);

  // Running timer
  let runningQuery = supabase
    .from("time_entries")
    .select(
      "*, projects(id, name, github_repo, category_set_id, require_timestamps, clients(id, name))",
    )
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1);
  if (selectedOrgId) runningQuery = runningQuery.eq("organization_id", selectedOrgId);
  const { data: runningEntries } = await runningQuery;
  const running = runningEntries?.[0] ? normalizeEntry(runningEntries[0]) : null;

  // Active projects
  let projectsQuery = supabase
    .from("projects")
    .select(
      "id, name, github_repo, organization_id, category_set_id, require_timestamps, clients(id, name)",
    )
    .eq("status", "active")
    .order("name");
  if (selectedOrgId) projectsQuery = projectsQuery.eq("organization_id", selectedOrgId);
  const { data: rawProjects } = await projectsQuery;
  const projects = (rawProjects ?? []).map((p) => ({
    ...p,
    clients: Array.isArray(p.clients) ? (p.clients[0] ?? null) : (p.clients ?? null),
  }));

  // Categories visible to any project's category set
  const setIds = Array.from(
    new Set(
      projects
        .map((p) => p.category_set_id)
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

  // Recent projects — distinct project_ids from the last 30 days
  const recentSinceIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  let recentQuery = supabase
    .from("time_entries")
    .select("project_id, start_time")
    .gte("start_time", recentSinceIso)
    .order("start_time", { ascending: false })
    .limit(50);
  if (selectedOrgId) recentQuery = recentQuery.eq("organization_id", selectedOrgId);
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

  const allTemplates = await getMyTemplates(selectedOrgId);
  const templates = allTemplates.slice(0, 8);

  return (
    <TimeHome
      orgs={orgs}
      selectedOrgId={selectedOrgId ?? null}
      view={view}
      billableOnly={billableOnly}
      dayStr={day}
      weekStartStr={weekStart}
      tzOffsetMin={tzOffsetMin}
      weekEntries={weekEntries}
      dayEntries={dayEntries}
      running={running}
      projects={projects}
      recentProjects={recentProjects}
      categories={categories}
      templates={templates}
    />
  );
}
