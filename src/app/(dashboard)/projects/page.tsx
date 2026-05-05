import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { FolderKanban } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects");
  return { title: t("title") };
}
import { TeamFilter } from "@/components/TeamFilter";
import { getVisibleCategorySets } from "@/lib/categories/queries";
import { NewProjectForm } from "./new-project-form";
import { parseListPagination } from "@/lib/pagination/list-pagination";
import { ProjectsTable, type ProjectRow } from "./projects-table";

// Whitelist for sort keys — gates URL input before it reaches the
// query builder. Everything else falls back to the default.
const ALLOWED_SORTS = ["name", "hourly_rate", "status", "created_at"] as const;
type SortKey = (typeof ALLOWED_SORTS)[number];
const DEFAULT_SORT: SortKey = "name";

function parseSort(
  raw: string | undefined,
): SortKey {
  return (ALLOWED_SORTS as readonly string[]).includes(raw ?? "")
    ? (raw as SortKey)
    : DEFAULT_SORT;
}

function parseDir(raw: string | undefined): "asc" | "desc" {
  return raw === "desc" ? "desc" : "asc";
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    org?: string;
    limit?: string;
    sort?: string;
    dir?: string;
  }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const sp = await searchParams;
  const { org: selectedTeamId } = sp;
  const t = await getTranslations("projects");
  const { limit } = parseListPagination(sp);

  const sort = parseSort(sp.sort);
  const dir = parseDir(sp.dir);

  // count: "exact" + .range() + id tiebreaker — same shape as
  // every other list page in Shyre. See the expenses page for
  // the rationale on why created_at alone isn't a stable sort.
  // nullsFirst: false on hourly_rate so projects without a rate
  // ($-/hr) stay at the bottom regardless of asc/desc.
  let projectsQuery = supabase
    .from("projects_v")
    .select("*, customers(name)", { count: "exact" })
    .neq("status", "archived")
    .order(sort, { ascending: dir === "asc", nullsFirst: false })
    .order("id", { ascending: false });
  if (selectedTeamId) projectsQuery = projectsQuery.eq("team_id", selectedTeamId);
  const { data: projects, count: projectsMatchingCount } =
    await projectsQuery.range(0, limit - 1);

  let clientsQuery = supabase
    .from("customers")
    .select("id, name")
    .eq("archived", false)
    .order("name");
  if (selectedTeamId) clientsQuery = clientsQuery.eq("team_id", selectedTeamId);
  const { data: customers } = await clientsQuery;

  const categorySetsFull = await getVisibleCategorySets(selectedTeamId);
  const categorySets = categorySetsFull.map(
    ({ id, team_id, name, description, is_system, created_by, created_at }) => ({
      id,
      team_id,
      name,
      description,
      is_system,
      created_by,
      created_at,
    }),
  );

  const teamNameById = new Map(
    teams.map((o) => [o.id as string, (o.name as string) ?? "—"]),
  );

  return (
    <div>
      <div className="flex items-center gap-3">
        <FolderKanban size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
        <TeamFilter teams={teams} selectedTeamId={selectedTeamId ?? null} />
      </div>

      <NewProjectForm
        customers={customers ?? []}
        teams={teams}
        defaultTeamId={selectedTeamId}
        categorySets={categorySets}
      />

      <ProjectsTable
        projects={(projects ?? []) as unknown as ProjectRow[]}
        totalCount={projectsMatchingCount ?? projects?.length ?? 0}
        teamNameById={teamNameById}
        sort={sort}
        dir={dir}
        selectedTeamId={selectedTeamId}
        limitParam={sp.limit}
      />
    </div>
  );
}

