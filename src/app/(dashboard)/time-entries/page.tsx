import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { parseIntervalParams } from "@/lib/time/intervals";
import { getTodayStart } from "@/lib/time/week";
import type { GroupingKind } from "@/lib/time/grouping";
import { TimeHome } from "./time-home";

interface PageProps {
  searchParams: Promise<{
    org?: string;
    interval?: string;
    anchor?: string;
    from?: string;
    to?: string;
    groupBy?: string;
  }>;
}

function asGrouping(v: string | undefined): GroupingKind {
  if (v === "category" || v === "project" || v === "day") return v;
  return "day";
}

export default async function TimeEntriesPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const sp = await searchParams;
  const { org: selectedOrgId } = sp;

  const interval = parseIntervalParams(sp);
  const grouping = asGrouping(sp.groupBy);
  const todayStart = getTodayStart();
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Entries for the selected interval
  let intervalQuery = supabase
    .from("time_entries")
    .select("*, projects(id, name, github_repo, category_set_id)")
    .gte("start_time", interval.start.toISOString())
    .lt("start_time", interval.end.toISOString())
    .order("start_time", { ascending: true });
  if (selectedOrgId) intervalQuery = intervalQuery.eq("organization_id", selectedOrgId);
  const { data: intervalEntries } = await intervalQuery;

  // Today entries
  let todayQuery = supabase
    .from("time_entries")
    .select("*, projects(id, name, github_repo, category_set_id)")
    .gte("start_time", todayStart.toISOString())
    .lt("start_time", todayEnd.toISOString())
    .order("start_time", { ascending: false });
  if (selectedOrgId) todayQuery = todayQuery.eq("organization_id", selectedOrgId);
  const { data: todayEntries } = await todayQuery;

  // Running timer
  let runningQuery = supabase
    .from("time_entries")
    .select("*, projects(id, name, github_repo, category_set_id)")
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1);
  if (selectedOrgId) runningQuery = runningQuery.eq("organization_id", selectedOrgId);
  const { data: runningEntries } = await runningQuery;
  const running = runningEntries?.[0] ?? null;

  // Active projects
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

  return (
    <TimeHome
      orgs={orgs}
      selectedOrgId={selectedOrgId ?? null}
      intervalKind={interval.kind}
      intervalStartIso={interval.start.toISOString()}
      intervalEndIso={interval.end.toISOString()}
      grouping={grouping}
      intervalEntries={intervalEntries ?? []}
      todayEntries={todayEntries ?? []}
      running={running}
      projects={projects ?? []}
      recentProjects={recentProjects}
      categories={categories}
    />
  );
}
