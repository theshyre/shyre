import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Clock, Hash, ExternalLink, FolderKanban, History as HistoryIcon } from "lucide-react";
import { tableClass } from "@/lib/table-styles";
import { validateTeamAccess } from "@/lib/team-context";
import { CustomerChip } from "@/components/CustomerChip";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!project) {
    const t = await getTranslations("projects");
    return { title: t("title") };
  }
  return { title: project.name as string };
}
import { formatDate } from "@theshyre/ui";
import { getVisibleCategorySets } from "@/lib/categories/queries";
import { getUserSettings } from "@/lib/user-settings";
import {
  TZ_COOKIE_NAME,
  parseTzOffset,
  getLocalToday,
  getOffsetForZone,
} from "@/lib/time/tz";
import { cookies } from "next/headers";
import {
  computeProjectPeriodBurn,
  computePreviousPeriodBounds,
  sumMinutesInPeriod,
  type BudgetPeriod,
} from "@/lib/projects/budget-period";
import { BudgetMasthead } from "./budget-masthead";
import { ProjectEditForm } from "./project-edit-form";
import { ProjectClassification } from "./project-classification";
import { SubProjectsSection } from "./sub-projects-section";
import { ProjectCategoriesEditor } from "./project-categories-editor";

interface IssueTimeSummary {
  /** Display key. For new entries this is the unified
   *  linked_ticket_key (e.g. "AE-640" or "owner/repo#42"); for legacy
   *  data it's the bare github_issue number rendered as "#NNN". */
  displayKey: string;
  /** Click-out URL when known (Jira browse / GitHub issues). NULL
   *  when the lookup hasn't run yet — the row still totals correctly,
   *  it just doesn't link. */
  url: string | null;
  /** Sortable bucket id — collapse legacy github_issue and
   *  linked_ticket_key into the same row when they describe the same
   *  GitHub issue under the project's repo. */
  bucketId: string;
  totalMinutes: number;
  entryCount: number;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const t = await getTranslations("projects");

  const { data: project } = await supabase
    .from("projects_v")
    .select("*, customers(id, name)")
    .eq("id", id)
    .single();

  if (!project) notFound();

  // Resolve the caller's role on this project's team — drives the
  // "View edit history" link visibility (owner/admin only, matching
  // the RLS gate on projects_history). Members see the rest of the
  // detail page normally.
  const { role: callerRole } = await validateTeamAccess(
    project.team_id as string,
  );
  const callerIsAdmin = callerRole === "owner" || callerRole === "admin";

  // Customers on the same team — drives the "Make client work" picker
  // in ProjectClassification. Scoped to the project's team and to
  // non-archived customers; RLS narrows further.
  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, name")
    .eq("team_id", project.team_id)
    .eq("archived", false)
    .order("name");
  const customerOptions = (customerRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  // Eligible parent projects for the edit form's "Parent project"
  // dropdown — same team, non-archived, top-level (no parent of
  // their own), and the same customer as this project. The trigger
  // enforces same-customer + same-team server-side; client-side
  // filtering surfaces only the realistically-pickable options.
  const { data: eligibleParents } = project.customer_id
    ? await supabase
        .from("projects_v")
        .select("id, name, customer_id")
        .eq("team_id", project.team_id)
        .eq("customer_id", project.customer_id)
        .neq("status", "archived")
        .is("parent_project_id", null)
        .neq("id", project.id)
        .order("name")
    : { data: [] };

  // Children of this project — drives both the "hasChildren" gate on
  // the edit form (a project with children can't itself be re-
  // parented) and the "Sub-projects" section + rolled-up totals.
  const { data: childRows } = await supabase
    .from("projects_v")
    .select("id, name, status, budget_hours, hourly_rate")
    .eq("parent_project_id", project.id)
    .order("name");
  const children = (childRows ?? []) as Array<{
    id: string;
    name: string;
    status: string | null;
    budget_hours: number | null;
    hourly_rate: number | null;
  }>;
  const hasChildren = children.length > 0;

  // Parent reference — drives:
  //   (a) the breadcrumb on a child detail page;
  //   (b) the "Apply parent's settings" affordance on the edit form,
  //       which retroactively pulls the parent's current inheritable
  //       fields onto this child. Same field list as the New project
  //       form's pre-fill — see `src/lib/projects/parent-defaults.ts`.
  const parentRef = project.parent_project_id
    ? await supabase
        .from("projects_v")
        .select(
          "id, name, hourly_rate, default_billable, github_repo, jira_project_key, invoice_code, category_set_id, require_timestamps",
        )
        .eq("id", project.parent_project_id)
        .maybeSingle()
        .then(
          (r) =>
            r.data as {
              id: string;
              name: string;
              hourly_rate: number | string | null;
              default_billable: boolean | null;
              github_repo: string | null;
              jira_project_key: string | null;
              invoice_code: string | null;
              category_set_id: string | null;
              require_timestamps: boolean | null;
            } | null,
        )
    : null;

  const categorySetsFull = await getVisibleCategorySets(project.team_id);
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

  // Fetch project-scoped extension set (if any) + its categories. Also
  // fetch the categories of the project's base set so the editor can
  // render them read-only — you can't add meaningful extensions without
  // knowing what's already available.
  const { data: projectSet } = await supabase
    .from("category_sets")
    .select("id, name, categories(id, name, color, sort_order)")
    .eq("project_id", id)
    .maybeSingle();
  const projectSetCategories =
    projectSet && Array.isArray(projectSet.categories)
      ? (projectSet.categories as Array<{
          id: string;
          name: string;
          color: string;
          sort_order: number;
        }>)
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
      : [];

  let baseSetName: string | null = null;
  let baseCategories: Array<{ id: string; name: string; color: string }> = [];
  if (project.category_set_id) {
    const { data: baseSet } = await supabase
      .from("category_sets")
      .select("name, categories(id, name, color, sort_order)")
      .eq("id", project.category_set_id)
      .maybeSingle();
    baseSetName = (baseSet?.name as string) ?? null;
    if (baseSet && Array.isArray(baseSet.categories)) {
      baseCategories = (
        baseSet.categories as Array<{
          id: string;
          name: string;
          color: string;
          sort_order: number;
        }>
      )
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id: cid, name: cname, color }) => ({
          id: cid,
          name: cname,
          color,
        }));
    }
  }

  const { data: timeEntries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("start_time", { ascending: false });

  const allEntries = timeEntries ?? [];

  const totalMinutes = allEntries.reduce(
    (sum, e) => sum + (e.duration_min ?? 0),
    0
  );
  const totalHours = (totalMinutes / 60).toFixed(1);

  // Budget masthead — period bar + lifetime bar.
  // Resolve the user's TZ via the shared settings + cookie pipeline
  // (matches /time-entries/page.tsx). When the project has no
  // recurring period, the masthead component renders only the
  // lifetime bar (or nothing, when neither is set).
  const cookieStore = await cookies();
  const cookieOffset = parseTzOffset(cookieStore.get(TZ_COOKIE_NAME)?.value);
  const userSettings = await getUserSettings();
  const tzOffsetMin = userSettings.timezone
    ? getOffsetForZone(userSettings.timezone, new Date())
    : cookieOffset;
  const todayLocal = getLocalToday(tzOffsetMin);

  const projectBudgetPeriod = (project.budget_period as BudgetPeriod | null) ??
    null;
  const projectRate = (project.hourly_rate as number | null) ?? null;
  const periodBurn = projectBudgetPeriod
    ? computeProjectPeriodBurn({
        budget_period: projectBudgetPeriod,
        budget_hours_per_period:
          (project.budget_hours_per_period as number | null) ?? null,
        budget_dollars_per_period:
          (project.budget_dollars_per_period as number | null) ?? null,
        budget_alert_threshold_pct:
          (project.budget_alert_threshold_pct as number | null) ?? null,
        effectiveRate: projectRate,
        entries: allEntries.map((e) => ({
          start_time: e.start_time as string,
          duration_min: (e.duration_min as number | null) ?? null,
        })),
        anchorLocalDate: todayLocal,
        tzOffsetMin,
      })
    : null;
  const previousPeriodMinutes = projectBudgetPeriod
    ? (() => {
        const bounds = computePreviousPeriodBounds(
          projectBudgetPeriod,
          todayLocal,
          tzOffsetMin,
        );
        return sumMinutesInPeriod(
          allEntries.map((e) => ({
            start_time: e.start_time as string,
            duration_min: (e.duration_min as number | null) ?? null,
          })),
          bounds.startUtc,
          bounds.endUtc,
        );
      })()
    : null;

  // Group time by linked ticket. Prefer the unified linked_ticket_*
  // columns; fall back to legacy github_issue (integer) so old data
  // imported pre-linked_ticket_* still aggregates. Both shapes
  // collapse into the same bucket when they reference the same
  // GitHub issue under the project's repo.
  const issueMap = new Map<string, IssueTimeSummary>();
  const projectRepo = project.github_repo as string | null;
  for (const entry of allEntries) {
    let bucketId: string | null = null;
    let displayKey: string | null = null;
    let url: string | null = null;

    if (entry.linked_ticket_provider && entry.linked_ticket_key) {
      bucketId = `${entry.linked_ticket_provider}:${entry.linked_ticket_key}`;
      displayKey = entry.linked_ticket_key as string;
      url = (entry.linked_ticket_url as string | null) ?? null;
    } else if (entry.github_issue && projectRepo) {
      bucketId = `github:${projectRepo}#${entry.github_issue}`;
      displayKey = `${projectRepo}#${entry.github_issue}`;
      url = `https://github.com/${projectRepo}/issues/${entry.github_issue}`;
    } else if (entry.github_issue) {
      // No project repo — render the bare number, no URL.
      bucketId = `github_issue:${entry.github_issue}`;
      displayKey = `#${entry.github_issue}`;
      url = null;
    }

    if (!bucketId || !displayKey) continue;

    const existing = issueMap.get(bucketId);
    if (existing) {
      existing.totalMinutes += entry.duration_min ?? 0;
      existing.entryCount += 1;
      // Keep the first non-null URL we see — newer entries' resolved
      // URL is preferred over a synthesized fallback.
      if (!existing.url && url) existing.url = url;
    } else {
      issueMap.set(bucketId, {
        bucketId,
        displayKey,
        url,
        totalMinutes: entry.duration_min ?? 0,
        entryCount: 1,
      });
    }
  }
  const issueSummaries = Array.from(issueMap.values()).sort(
    (a, b) => b.totalMinutes - a.totalMinutes
  );

  const recentEntries = allEntries.slice(0, 20);

  // Defensive fallback: projects.name is NOT NULL in schema; this
  // arm only fires under future schema drift. Mirrors the
  // business / customer / team headers — every detail page must
  // surface identifying text in the h1, never a generic noun.
  const projectName = (project.name as string | null) ?? t("untitled");
  // Customer context disambiguates two "Migration" projects under
  // different customers — the form below doesn't show it
  // prominently, so we surface it in the page header subline.
  const customerName =
    project.customers &&
    typeof project.customers === "object" &&
    "name" in project.customers
      ? ((project.customers as { name: string | null }).name ?? null)
      : null;
  const customerId =
    project.customers &&
    typeof project.customers === "object" &&
    "id" in project.customers
      ? ((project.customers as { id: string | null }).id ?? null)
      : null;
  const projectIsInternal = project.is_internal === true;

  return (
    <div>
      {/* Breadcrumb-style parent link, when this project IS a child.
          Shown above the h1 so the user lands on a child page and
          immediately sees which umbrella it sits under. */}
      {parentRef && (
        <Link
          href={`/projects/${parentRef.id}`}
          className="inline-flex items-center gap-1 text-caption text-content-secondary hover:text-accent mb-2"
        >
          <span aria-hidden="true">←</span> {parentRef.name}
        </Link>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <FolderKanban size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content break-words">
          {projectName}
        </h1>
        {callerIsAdmin && (
          <Link
            href={`/projects/${id}/history`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface px-2.5 py-1 text-caption text-content-muted hover:text-content hover:bg-hover transition-colors"
          >
            <HistoryIcon size={12} aria-hidden="true" />
            {t("history.viewLink")}
          </Link>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-caption text-content-muted">
        {customerName ? (
          <>
            <CustomerChip
              customerId={customerId}
              customerName={customerName}
              size={14}
            />
            <span>
              {t("editSubtitleWithCustomer", { customer: customerName })}
            </span>
          </>
        ) : projectIsInternal ? (
          <>
            <CustomerChip
              customerId={null}
              customerName={null}
              internal
              size={14}
            />
            <span>{t("editSubtitle")}</span>
          </>
        ) : (
          <span>{t("editSubtitle")}</span>
        )}
      </div>

      <div className="mt-4">
        <BudgetMasthead
          projectId={id}
          lifetimeMinutes={totalMinutes}
          lifetimeBudgetHours={
            (project.budget_hours as number | null) ?? null
          }
          lifetimeRate={projectRate}
          lifetimeBudgetDollars={null}
          period={
            periodBurn && projectBudgetPeriod
              ? {
                  type: projectBudgetPeriod,
                  startLocal: periodBurn.bounds.startLocal,
                  endLocal: periodBurn.bounds.endLocal,
                  minutes: periodBurn.minutes,
                  capHours: periodBurn.capHours,
                  capDollars: periodBurn.capDollars,
                  rate: projectRate,
                  alertThresholdPct:
                    (project.budget_alert_threshold_pct as number | null) ??
                    null,
                  alertActive: periodBurn.alertActive,
                  previousMinutes: previousPeriodMinutes,
                }
              : null
          }
        />
      </div>

      <div className="mt-6">
        <ProjectEditForm
          project={project}
          eligibleParents={(eligibleParents ?? []) as Array<{
            id: string;
            name: string;
            customer_id: string | null;
          }>}
          hasChildren={hasChildren}
          parent={parentRef}
        />
      </div>

      {/* Sub-projects section (parent view only) — lists each child
          with its own burn vs budget, plus a "rolled-up totals" card
          that sums the parent's own work + every child's. Hidden
          when there are no children, since the section title would
          read empty. */}
      {hasChildren && (
        <div className="mt-8">
          <div className="flex items-center gap-3">
            <FolderKanban size={20} className="text-accent" />
            <h2 className="text-title font-semibold text-content">
              {t("subProjects.heading")}
            </h2>
          </div>
          <SubProjectsSection
            parentId={project.id}
            parentBudgetHours={(project.budget_hours as number | null) ?? null}
            parentHourlyRate={(project.hourly_rate as number | null) ?? null}
            parentOwnMinutes={totalMinutes}
            subProjects={children}
          />
        </div>
      )}

      <div className="mt-6">
        <ProjectClassification
          projectId={project.id}
          isInternal={project.is_internal === true}
          defaultBillable={project.default_billable !== false}
          currentCustomerId={(project.customer_id as string | null) ?? null}
          customers={customerOptions}
        />
      </div>

      <div className="mt-6">
        <ProjectCategoriesEditor
          projectId={project.id}
          setId={projectSet?.id ?? null}
          setName={projectSet?.name ?? ""}
          initialCategories={projectSetCategories}
          initialBaseSetId={project.category_set_id}
          baseSetName={baseSetName}
          baseCategories={baseCategories}
          availableSets={categorySets.map((s) => ({
            id: s.id,
            name: s.name,
            is_system: s.is_system,
          }))}
        />
      </div>

      {/* Time by linked ticket — provider-agnostic. Renders for any
          project with at least one linked entry; shows whether the
          source is GitHub or Jira. */}
      {issueSummaries.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-3">
            <Hash size={20} className="text-accent" />
            <h2 className="text-title font-semibold text-content">
              Time by ticket
            </h2>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
            <table className={tableClass}>
              <thead>
                <tr className="border-b border-edge bg-surface-inset">
                  <th className="px-4 py-3 text-left text-caption font-semibold uppercase tracking-wider text-content-muted">
                    Ticket
                  </th>
                  <th className="px-4 py-3 text-right text-caption font-semibold uppercase tracking-wider text-content-muted">
                    Entries
                  </th>
                  <th className="px-4 py-3 text-right text-caption font-semibold uppercase tracking-wider text-content-muted">
                    Total Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {issueSummaries.map((summary) => {
                  const h = Math.floor(summary.totalMinutes / 60);
                  const m = Math.round(summary.totalMinutes % 60);
                  const linkBody = (
                    <span className="inline-flex items-center gap-1.5 text-accent font-mono">
                      {summary.displayKey}
                      {summary.url && <ExternalLink size={12} />}
                    </span>
                  );
                  return (
                    <tr
                      key={summary.bucketId}
                      className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                    >
                      <td className="px-4 py-3">
                        {summary.url ? (
                          <a
                            href={summary.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {linkBody}
                          </a>
                        ) : (
                          linkBody
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-content-secondary">
                        {summary.entryCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content">
                        {h}h {m}m
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Time Entries */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock size={20} className="text-accent" />
            <h2 className="text-title font-semibold text-content">
              {t("timeEntries.title")}
            </h2>
          </div>
          {totalMinutes > 0 && (
            <span className="text-body-lg font-mono text-content-secondary">
              {t("timeEntries.totalHours", { hours: totalHours })}
            </span>
          )}
        </div>

        {recentEntries.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {recentEntries.map((entry) => {
              const hours = entry.duration_min
                ? Math.floor(entry.duration_min / 60)
                : 0;
              const mins = entry.duration_min ? entry.duration_min % 60 : 0;
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-edge bg-surface-raised px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-content">
                      {entry.description || "—"}
                    </span>
                    {entry.linked_ticket_key ? (
                      <span className="text-caption font-mono text-accent">
                        {entry.linked_ticket_key}
                      </span>
                    ) : (
                      entry.github_issue && (
                        <span className="text-caption font-mono text-accent">
                          #{entry.github_issue}
                        </span>
                      )
                    )}
                    <span className="text-caption text-content-muted">
                      {formatDate(entry.start_time)}
                    </span>
                  </div>
                  <span className="text-body-lg font-mono text-content-secondary">
                    {entry.duration_min ? `${hours}h ${mins}m` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-body-lg text-content-muted">
            {t("timeEntries.noEntries")}
          </p>
        )}
      </div>
    </div>
  );
}
