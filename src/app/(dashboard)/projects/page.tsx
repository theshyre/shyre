import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import { getVisibleCategorySets } from "@/lib/categories/queries";
import { NewProjectForm } from "./new-project-form";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const { org: selectedOrgId } = await searchParams;
  const t = await getTranslations("projects");
  const tc = await getTranslations("common");

  let projectsQuery = supabase
    .from("projects")
    .select("*, clients(name)")
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (selectedOrgId) projectsQuery = projectsQuery.eq("organization_id", selectedOrgId);
  const { data: projects } = await projectsQuery;

  let clientsQuery = supabase
    .from("clients")
    .select("id, name")
    .eq("archived", false)
    .order("name");
  if (selectedOrgId) clientsQuery = clientsQuery.eq("organization_id", selectedOrgId);
  const { data: clients } = await clientsQuery;

  const categorySetsFull = await getVisibleCategorySets(selectedOrgId);
  const categorySets = categorySetsFull.map(
    ({ id, organization_id, name, description, is_system, created_by, created_at }) => ({
      id,
      organization_id,
      name,
      description,
      is_system,
      created_by,
      created_at,
    }),
  );

  const orgName = (orgId: string) => orgs.find(o => o.id === orgId)?.name ?? "\u2014";

  return (
    <div>
      <div className="flex items-center gap-3">
        <FolderKanban size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <OrgFilter orgs={orgs} selectedOrgId={selectedOrgId ?? null} />
      </div>

      <NewProjectForm
        clients={clients ?? []}
        orgs={orgs}
        defaultOrgId={selectedOrgId}
        categorySets={categorySets}
      />

      {projects && projects.length > 0 ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge bg-surface-inset">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {tc("table.name")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  Org
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.client")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.hourlyRate")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const clientName =
                  project.clients &&
                  typeof project.clients === "object" &&
                  "name" in project.clients
                    ? (project.clients as { name: string }).name
                    : "—";
                return (
                  <tr
                    key={project.id}
                    className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-accent hover:underline font-medium"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-content-secondary text-xs">
                      {orgName(project.organization_id)}
                    </td>
                    <td className="px-4 py-3 text-content-secondary">
                      {clientName}
                    </td>
                    <td className="px-4 py-3 text-content-secondary font-mono">
                      {project.hourly_rate
                        ? `$${Number(project.hourly_rate).toFixed(2)}/hr`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={project.status ?? "active"} label={tc(`status.${project.status ?? "active"}`)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-sm text-content-muted">
          {t("noProjects")}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }): React.JSX.Element {
  const colorMap: Record<string, string> = {
    active: "bg-success-soft text-success",
    paused: "bg-warning-soft text-warning",
    completed: "bg-info-soft text-info",
    archived: "bg-surface-inset text-content-muted",
  };
  const classes = colorMap[status] ?? "bg-surface-inset text-content-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
