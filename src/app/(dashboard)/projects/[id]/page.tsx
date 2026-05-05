import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Clock, Hash, ExternalLink, FolderKanban } from "lucide-react";
import { tableClass } from "@/lib/table-styles";

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
import { ProjectEditForm } from "./project-edit-form";
import { ProjectClassification } from "./project-classification";
import { ProjectCategoriesEditor } from "./project-categories-editor";

interface IssueTimeSummary {
  issueNumber: number;
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
    .select("*, customers(name)")
    .eq("id", id)
    .single();

  if (!project) notFound();

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

  // Group time by GitHub issue
  const issueMap = new Map<number, IssueTimeSummary>();
  for (const entry of allEntries) {
    if (entry.github_issue) {
      const existing = issueMap.get(entry.github_issue);
      if (existing) {
        existing.totalMinutes += entry.duration_min ?? 0;
        existing.entryCount += 1;
      } else {
        issueMap.set(entry.github_issue, {
          issueNumber: entry.github_issue,
          totalMinutes: entry.duration_min ?? 0,
          entryCount: 1,
        });
      }
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

  return (
    <div>
      <div className="flex items-center gap-3">
        <FolderKanban size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content break-words">
          {projectName}
        </h1>
      </div>
      <p className="mt-1 text-caption text-content-muted">
        {customerName
          ? t("editSubtitleWithCustomer", { customer: customerName })
          : t("editSubtitle")}
      </p>

      <div className="mt-6">
        <ProjectEditForm project={project} />
      </div>

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

      {/* Issue Time Summary */}
      {issueSummaries.length > 0 && project.github_repo && (
        <div className="mt-8">
          <div className="flex items-center gap-3">
            <Hash size={20} className="text-accent" />
            <h2 className="text-title font-semibold text-content">
              Time by Issue
            </h2>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
            <table className={tableClass}>
              <thead>
                <tr className="border-b border-edge bg-surface-inset">
                  <th className="px-4 py-3 text-left text-caption font-semibold uppercase tracking-wider text-content-muted">
                    Issue
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
                  return (
                    <tr
                      key={summary.issueNumber}
                      className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                    >
                      <td className="px-4 py-3">
                        <a
                          href={`https://github.com/${project.github_repo}/issues/${summary.issueNumber}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-accent hover:underline font-mono"
                        >
                          #{summary.issueNumber}
                          <ExternalLink size={12} />
                        </a>
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
                    {entry.github_issue && (
                      <span className="text-caption font-mono text-accent">
                        #{entry.github_issue}
                      </span>
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
