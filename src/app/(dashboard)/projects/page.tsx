import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { FolderKanban, Building2 } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects");
  return { title: t("title") };
}
import { TeamFilter } from "@/components/TeamFilter";
import { getVisibleCategorySets } from "@/lib/categories/queries";
import { NewProjectForm } from "./new-project-form";
import { parseListPagination } from "@/lib/pagination/list-pagination";
import { PaginationFooter } from "@/components/PaginationFooter";
import { SortableTableHeader } from "@/components/SortableTableHeader";
import {
  tableClass,
  tableHeaderCellClass,
  tableHeaderRowClass,
  tableBodyRowClass,
  tableBodyCellClass,
  tableWrapperClass,
} from "@/lib/table-styles";

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
  const tc = await getTranslations("common");
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

  const teamName = (teamId: string) =>
    teams.find((o) => o.id === teamId)?.name ?? "—";

  // Team-scope column appears only for multi-team viewers. For solos
  // the team is ambient (one team, never switched), and the column
  // adds visual noise that distracts from project / customer / rate.
  // For agencies, the column tells you which scope the project lives
  // in at a glance — the symptom of "Teams and Projects feel close"
  // dissolves into "Team is the chip on every Project."
  const showTeamColumn = teams.length > 1;

  // Preserve filter + pagination params across sort clicks. Sort
  // clicks reset to page 1 implicitly because we don't carry a page
  // number — limit is the only pagination control on this page.
  const buildSortHref = ({
    sort: nextSort,
    dir: nextDir,
  }: {
    sort: string;
    dir: "asc" | "desc";
  }): string => {
    const params = new URLSearchParams();
    if (selectedTeamId) params.set("org", selectedTeamId);
    if (sp.limit) params.set("limit", sp.limit);
    params.set("sort", nextSort);
    params.set("dir", nextDir);
    return `/projects?${params.toString()}`;
  };

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

      {projects && projects.length > 0 ? (
        <div className={`mt-6 ${tableWrapperClass}`}>
          <table className={tableClass}>
            <thead>
              <tr className={tableHeaderRowClass}>
                <SortableTableHeader
                  label={tc("table.name")}
                  sortKey="name"
                  currentSort={sort}
                  currentDir={dir}
                  href={buildSortHref}
                />
                {showTeamColumn && (
                  <th scope="col" className={`${tableHeaderCellClass} text-left`}>
                    {tc("nav.teams")}
                  </th>
                )}
                <th scope="col" className={`${tableHeaderCellClass} text-left`}>
                  {t("table.customer")}
                </th>
                <SortableTableHeader
                  label={t("table.hourlyRate")}
                  sortKey="hourly_rate"
                  currentSort={sort}
                  currentDir={dir}
                  href={buildSortHref}
                />
                <SortableTableHeader
                  label={t("table.status")}
                  sortKey="status"
                  currentSort={sort}
                  currentDir={dir}
                  href={buildSortHref}
                />
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const customerName =
                  project.customers &&
                  typeof project.customers === "object" &&
                  "name" in project.customers
                    ? (project.customers as { name: string }).name
                    : null;
                const isInternal = project.is_internal === true;
                return (
                  <tr key={project.id} className={tableBodyRowClass}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-accent hover:underline font-medium"
                      >
                        {project.name}
                      </Link>
                      {isInternal && (
                        <span
                          className="ml-2 inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-secondary"
                          title={t("classification.internalDescription")}
                        >
                          <Building2 size={10} />
                          {t("internal")}
                        </span>
                      )}
                    </td>
                    {showTeamColumn && (
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-secondary">
                          {teamName(project.team_id)}
                        </span>
                      </td>
                    )}
                    <td className={tableBodyCellClass}>
                      {isInternal ? (
                        <span className="text-content-muted italic">
                          {t("table.noCustomerInternal")}
                        </span>
                      ) : (
                        (customerName ?? "—")
                      )}
                    </td>
                    <td className={`${tableBodyCellClass} font-mono`}>
                      {project.hourly_rate
                        ? `$${Number(project.hourly_rate).toFixed(2)}/hr`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={project.status ?? "active"}
                        label={tc(`status.${project.status ?? "active"}`)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PaginationFooter
            loaded={projects.length}
            total={projectsMatchingCount ?? projects.length}
          />
        </div>
      ) : (
        <p className="mt-6 text-body text-content-muted">
          {t("noProjects")}
        </p>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  label,
}: {
  status: string;
  label: string;
}): React.JSX.Element {
  const colorMap: Record<string, string> = {
    active: "bg-success-soft text-success",
    paused: "bg-warning-soft text-warning",
    completed: "bg-info-soft text-info",
    archived: "bg-surface-inset text-content-muted",
  };
  const classes = colorMap[status] ?? "bg-surface-inset text-content-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

