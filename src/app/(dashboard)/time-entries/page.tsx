import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getWeekRange, parseWeekParam, getWeekStart, getTodayStart } from "@/lib/time/week";
import { TimeHome } from "./time-home";

interface PageProps {
  searchParams: Promise<{ org?: string; week?: string }>;
}

export default async function TimeEntriesPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const { org: selectedOrgId, week: weekParam } = await searchParams;

  // Resolve week start (Monday)
  const weekStart = parseWeekParam(weekParam) ?? getWeekStart(new Date());
  const { start: weekStartDate, end: weekEndDate } = getWeekRange(weekStart);
  const todayStart = getTodayStart();
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Fetch week entries
  let weekQuery = supabase
    .from("time_entries")
    .select("*, projects(id, name, github_repo, category_set_id)")
    .gte("start_time", weekStartDate.toISOString())
    .lt("start_time", weekEndDate.toISOString())
    .order("start_time", { ascending: true });
  if (selectedOrgId) weekQuery = weekQuery.eq("organization_id", selectedOrgId);
  const { data: weekEntries } = await weekQuery;

  // Fetch today entries (can differ from week when viewing past/future week)
  let todayQuery = supabase
    .from("time_entries")
    .select("*, projects(id, name, github_repo, category_set_id)")
    .gte("start_time", todayStart.toISOString())
    .lt("start_time", todayEnd.toISOString())
    .order("start_time", { ascending: false });
  if (selectedOrgId) todayQuery = todayQuery.eq("organization_id", selectedOrgId);
  const { data: todayEntries } = await todayQuery;

  // Running timer (most recent entry with null end_time)
  let runningQuery = supabase
    .from("time_entries")
    .select("*, projects(id, name, github_repo, category_set_id)")
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1);
  if (selectedOrgId) runningQuery = runningQuery.eq("organization_id", selectedOrgId);
  const { data: runningEntries } = await runningQuery;
  const running = runningEntries?.[0] ?? null;

  // Active projects (for selects and recent chips)
  let projectsQuery = supabase
    .from("projects")
    .select("id, name, github_repo, organization_id, category_set_id")
    .eq("status", "active")
    .order("name");
  if (selectedOrgId) projectsQuery = projectsQuery.eq("organization_id", selectedOrgId);
  const { data: projects } = await projectsQuery;

  // Categories for any project's category set
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

  // Recent projects: distinct project_ids from the last 30 days, most recent first
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

  return (
    <TimeHome
      orgs={orgs}
      selectedOrgId={selectedOrgId ?? null}
      weekStartIso={weekStartDate.toISOString()}
      weekEntries={weekEntries ?? []}
      todayEntries={todayEntries ?? []}
      running={running}
      projects={projects ?? []}
      recentProjects={recentProjects}
      categories={categories}
    />
  );
}
