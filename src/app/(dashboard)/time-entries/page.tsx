import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import {
  getWeekStart,
  getWeekRange,
  getTodayStart,
  parseWeekParam,
} from "@/lib/time/week";
import { getMyTemplates } from "@/lib/templates/queries";
import { TimeHome } from "./time-home";
import type { TimeView } from "./view-toggle";

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

  const view = asView(sp.view);
  const billableOnly = sp.billable === "1";

  // Anchor date for the view (default: today)
  const anchor = parseWeekParam(sp.anchor) ?? getTodayStart();
  // The "week" that contains the anchor — always used, even in day view
  const { start: weekStart, end: weekEnd } = getWeekRange(anchor);
  // The specific day (day view uses the anchor literally)
  const day = sp.anchor ? anchor : getTodayStart();

  // Entries for the whole week (both views use this — day view also needs it
  // for the 7-day strip totals)
  let weekQuery = supabase
    .from("time_entries")
    .select(
      "*, projects(id, name, github_repo, category_set_id, require_timestamps)",
    )
    .gte("start_time", weekStart.toISOString())
    .lt("start_time", weekEnd.toISOString())
    .order("start_time", { ascending: true });
  if (selectedOrgId) weekQuery = weekQuery.eq("organization_id", selectedOrgId);
  if (billableOnly) weekQuery = weekQuery.eq("billable", true);
  const { data: weekEntries } = await weekQuery;

  // Entries for the specific day being viewed (day view only)
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  let dayQuery = supabase
    .from("time_entries")
    .select(
      "*, projects(id, name, github_repo, category_set_id, require_timestamps)",
    )
    .gte("start_time", dayStart.toISOString())
    .lt("start_time", dayEnd.toISOString())
    .order("start_time", { ascending: true });
  if (selectedOrgId) dayQuery = dayQuery.eq("organization_id", selectedOrgId);
  if (billableOnly) dayQuery = dayQuery.eq("billable", true);
  const { data: dayEntries } = await dayQuery;

  // Running timer
  let runningQuery = supabase
    .from("time_entries")
    .select(
      "*, projects(id, name, github_repo, category_set_id, require_timestamps)",
    )
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1);
  if (selectedOrgId) runningQuery = runningQuery.eq("organization_id", selectedOrgId);
  const { data: runningEntries } = await runningQuery;
  const running = runningEntries?.[0] ?? null;

  // Active projects
  let projectsQuery = supabase
    .from("projects")
    .select(
      "id, name, github_repo, organization_id, category_set_id, require_timestamps",
    )
    .eq("status", "active")
    .order("name");
  if (selectedOrgId) projectsQuery = projectsQuery.eq("organization_id", selectedOrgId);
  const { data: projects } = await projectsQuery;

  // Categories visible to any project's category set
  const setIds = Array.from(
    new Set(
      (projects ?? [])
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
    .map((id) => (projects ?? []).find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  const allTemplates = await getMyTemplates(selectedOrgId);
  const templates = allTemplates.slice(0, 8);

  return (
    <TimeHome
      orgs={orgs}
      selectedOrgId={selectedOrgId ?? null}
      view={view}
      billableOnly={billableOnly}
      dayIso={day.toISOString()}
      weekStartIso={weekStart.toISOString()}
      weekEndIso={weekEnd.toISOString()}
      weekEntries={weekEntries ?? []}
      dayEntries={dayEntries ?? []}
      running={running}
      projects={projects ?? []}
      recentProjects={recentProjects}
      categories={categories}
      templates={templates}
    />
  );
}
