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
import { getUserSettings } from "@/lib/user-settings";
import { cookies } from "next/headers";
import {
  TZ_COOKIE_NAME,
  parseTzOffset,
  getOffsetForZone,
  getLocalToday,
} from "@/lib/time/tz";
import {
  computeProjectPeriodBurn,
  type BudgetPeriod,
} from "@/lib/projects/budget-period";
import { NewProjectForm } from "./new-project-form";
import { parseListPagination } from "@/lib/pagination/list-pagination";
import { ProjectsTable, type ProjectRow } from "./projects-table";
import {
  CustomerFilter,
  ProjectFiltersClearHint,
  ProjectSearchInput,
  StatusFilter,
} from "./projects-filters";

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

// `?status=` whitelist. "all" relaxes the default-archived-hidden
// filter and shows every status; "active" (the default) hides
// archived. Anything outside the set falls back to the default.
const ALLOWED_STATUS_FILTERS = [
  "active",
  "paused",
  "completed",
  "archived",
  "all",
] as const;
type StatusFilter = (typeof ALLOWED_STATUS_FILTERS)[number];

function parseStatusFilter(raw: string | undefined): StatusFilter {
  return (ALLOWED_STATUS_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as StatusFilter)
    : "active";
}

// `?customer=` is either a customer UUID or the literal "internal"
// (matches projects with is_internal=true). Empty / unknown =
// no filter. The UUID itself is validated structurally below; an
// invalid one will simply yield no results, which is fine.
function parseCustomerFilter(
  raw: string | undefined,
): { kind: "all" } | { kind: "internal" } | { kind: "id"; id: string } {
  if (!raw) return { kind: "all" };
  if (raw === "internal") return { kind: "internal" };
  // Loose UUID guard so a typo or tampered URL doesn't reach the
  // query builder as a free-text. Supabase will reject malformed
  // UUIDs anyway; this is a friendlier short-circuit.
  if (/^[0-9a-fA-F-]{36}$/.test(raw)) return { kind: "id", id: raw };
  return { kind: "all" };
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    org?: string;
    limit?: string;
    sort?: string;
    dir?: string;
    /** Status filter — `active` (default) hides archived; `all`
     *  shows every status; the four named statuses pin to a
     *  single value. */
    status?: string;
    /** Customer filter — UUID, "internal", or empty/missing. */
    customer?: string;
    /** Free-text name search — server-side ILIKE match. */
    q?: string;
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
  const statusFilter = parseStatusFilter(sp.status);
  const customerFilter = parseCustomerFilter(sp.customer);
  const searchQuery = (sp.q ?? "").trim();

  // count: "exact" + .range() + id tiebreaker — same shape as
  // every other list page in Shyre. See the expenses page for
  // the rationale on why created_at alone isn't a stable sort.
  // nullsFirst: false on hourly_rate so projects without a rate
  // ($-/hr) stay at the bottom regardless of asc/desc.
  let projectsQuery = supabase
    .from("projects_v")
    .select("*, customers(name)", { count: "exact" })
    .order(sort, { ascending: dir === "asc", nullsFirst: false })
    .order("id", { ascending: false });

  // Status filter — "active" hides archived (the original default
  // behavior); the four named statuses pin to a single value;
  // "all" applies no status filter.
  if (statusFilter === "active") {
    projectsQuery = projectsQuery.neq("status", "archived");
  } else if (statusFilter !== "all") {
    projectsQuery = projectsQuery.eq("status", statusFilter);
  }

  // Customer filter — id, internal, or no-op.
  if (customerFilter.kind === "internal") {
    projectsQuery = projectsQuery.eq("is_internal", true);
  } else if (customerFilter.kind === "id") {
    projectsQuery = projectsQuery.eq("customer_id", customerFilter.id);
  }

  // Free-text search — case-insensitive substring on the project's
  // own name. Escape % and _ in the user's input so a user typing
  // "100%" doesn't accidentally match every project. PostgreSQL's
  // ILIKE treats those as wildcards. Backslash escapes them.
  if (searchQuery.length > 0) {
    const escaped = searchQuery.replace(/[\\%_]/g, "\\$&");
    projectsQuery = projectsQuery.ilike("name", `%${escaped}%`);
  }

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

  // Eligible parent projects for the New project form's "Sub-project
  // of" dropdown — top-level (no parent themselves) + active +
  // external (internal projects can be parents but the create form
  // hides the picker when is_internal=true so we filter both ways
  // client-side). Capped at the team scope. Pulls the inheritable
  // fields too so the form can pre-fill them when a parent is
  // picked — see `src/lib/projects/parent-defaults.ts`.
  let parentsQuery = supabase
    .from("projects_v")
    .select(
      "id, name, customer_id, is_internal, hourly_rate, default_billable, github_repo, jira_project_key, invoice_code, category_set_id, require_timestamps",
    )
    .neq("status", "archived")
    .is("parent_project_id", null)
    .order("name");
  if (selectedTeamId) parentsQuery = parentsQuery.eq("team_id", selectedTeamId);
  const { data: eligibleParents } = await parentsQuery;

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

  // Period-burn % per row — only for projects with a recurring
  // period configured. Cheap-but-not-free: one wide query for time
  // entries on those projects within the last 90 days (covers
  // every period type up to quarterly), grouped per-project in JS
  // and run through the period-burn helper. Hidden cells render as
  // "—" so projects without a period don't push a noisy column.
  const projectsWithPeriod = (projects ?? []).filter(
    (p) =>
      (p as { budget_period?: string | null }).budget_period != null,
  );
  const periodBurnByProject = new Map<string, number | null>();
  if (projectsWithPeriod.length > 0) {
    const cookieStore = await cookies();
    const cookieOffset = parseTzOffset(
      cookieStore.get(TZ_COOKIE_NAME)?.value,
    );
    const userSettings = await getUserSettings();
    const tzOffsetMin = userSettings.timezone
      ? getOffsetForZone(userSettings.timezone, new Date())
      : cookieOffset;
    const todayLocal = getLocalToday(tzOffsetMin);

    const ninetyDaysAgo = new Date(
      new Date().getTime() - 90 * 24 * 3600 * 1000,
    ).toISOString();
    const projectIdsWithPeriod = projectsWithPeriod.map(
      (p) => (p as { id: string }).id,
    );
    const { data: burnEntries } = await supabase
      .from("time_entries")
      .select("project_id, start_time, duration_min")
      .in("project_id", projectIdsWithPeriod)
      .is("deleted_at", null)
      .gte("start_time", ninetyDaysAgo);
    const entriesByProject = new Map<
      string,
      Array<{ start_time: string; duration_min: number | null }>
    >();
    for (const e of burnEntries ?? []) {
      const pid = e.project_id as string;
      const list = entriesByProject.get(pid) ?? [];
      list.push({
        start_time: e.start_time as string,
        duration_min: (e.duration_min as number | null) ?? null,
      });
      entriesByProject.set(pid, list);
    }
    type ProjectRowShape = {
      id: string;
      budget_period?: string | null;
      budget_hours_per_period?: number | string | null;
      budget_dollars_per_period?: number | string | null;
      budget_alert_threshold_pct?: number | null;
      hourly_rate?: number | string | null;
    };
    for (const p of projectsWithPeriod as ProjectRowShape[]) {
      const burn = computeProjectPeriodBurn({
        budget_period: p.budget_period as BudgetPeriod,
        budget_hours_per_period:
          p.budget_hours_per_period == null
            ? null
            : Number(p.budget_hours_per_period),
        budget_dollars_per_period:
          p.budget_dollars_per_period == null
            ? null
            : Number(p.budget_dollars_per_period),
        budget_alert_threshold_pct: p.budget_alert_threshold_pct ?? null,
        effectiveRate:
          p.hourly_rate == null ? null : Number(p.hourly_rate),
        entries: entriesByProject.get(p.id) ?? [],
        anchorLocalDate: todayLocal,
        tzOffsetMin,
      });
      periodBurnByProject.set(p.id, burn?.pctHours ?? null);
    }
  }

  const filtersActive =
    statusFilter !== "active" ||
    customerFilter.kind !== "all" ||
    searchQuery.length > 0;

  return (
    <div>
      <div className="flex items-center gap-3">
        <FolderKanban size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <TeamFilter teams={teams} selectedTeamId={selectedTeamId ?? null} />
        <StatusFilter selected={statusFilter} />
        <CustomerFilter
          selection={customerFilter}
          customers={customers ?? []}
        />
        <div className="ml-auto">
          <ProjectSearchInput initialQuery={searchQuery} />
        </div>
      </div>

      <NewProjectForm
        customers={customers ?? []}
        teams={teams}
        defaultTeamId={selectedTeamId}
        categorySets={categorySets}
        eligibleParents={(eligibleParents ?? []) as Array<{
          id: string;
          name: string;
          customer_id: string | null;
          is_internal: boolean;
          hourly_rate: number | string | null;
          default_billable: boolean | null;
          github_repo: string | null;
          jira_project_key: string | null;
          invoice_code: string | null;
          category_set_id: string | null;
          require_timestamps: boolean | null;
        }>}
      />

      <ProjectsTable
        projects={(projects ?? []) as unknown as ProjectRow[]}
        totalCount={projectsMatchingCount ?? projects?.length ?? 0}
        teamNameById={teamNameById}
        sort={sort}
        dir={dir}
        selectedTeamId={selectedTeamId}
        limitParam={sp.limit}
        categorySets={categorySets.map((s) => ({
          id: s.id,
          name: s.name,
          is_system: s.is_system,
        }))}
        periodBurnPctById={Object.fromEntries(periodBurnByProject.entries())}
      />
      {(projects?.length ?? 0) === 0 && (
        <ProjectFiltersClearHint active={filtersActive} />
      )}
    </div>
  );
}

