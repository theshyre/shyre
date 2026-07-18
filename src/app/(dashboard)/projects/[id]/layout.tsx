import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FolderKanban } from "lucide-react";
import { formatDate } from "@theshyre/ui";
import { CustomerChip } from "@/components/CustomerChip";
import { StatusBadge } from "@/components/StatusBadge";
import { OverdueBadge } from "@/components/OverdueBadge";
import { isProjectOverdue } from "@/lib/projects/lifecycle";
import { loadProject } from "./load-project";
import { ProjectSectionNav } from "./project-section-nav";
import { ProjectLifecycleActions } from "./project-lifecycle-actions";

/**
 * Shared chrome for every /projects/[id]/* route: identity header
 * (breadcrumb to parent, project name, customer chip) + the section
 * nav strip. Each sub-route renders its own content inside `children`.
 *
 * The h1 carries `tabIndex={-1}` so the section nav can
 * programmatically focus it after a route change — gives screen
 * readers an audible "you're now on Settings" announcement and puts
 * keyboard users one Tab from the first interactive element on the
 * new route (a11y review recommendation).
 *
 * History tab in the strip is admin-gated; the corner "View edit
 * history" link from the old monolith is removed (it lived because
 * History wasn't reachable from anywhere else — now it is).
 */
export default async function ProjectDetailLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const project = await loadProject(id);
  const t = await getTranslations("projects");
  const tc = await getTranslations("common");

  const projectName = (project.row.name as string | null) ?? t("untitled");
  const status = (project.row.status as string | null) ?? "active";
  const projectedEndDate =
    (project.row.projected_end_date as string | null) ?? null;
  const closedAt = (project.row.closed_at as string | null) ?? null;
  const overdue = isProjectOverdue(projectedEndDate, status);

  return (
    <div>
      {project.parent && (
        <Link
          href={`/projects/${project.parent.id}`}
          className="inline-flex items-center gap-1 text-caption text-content-secondary hover:text-accent mb-2"
        >
          <span aria-hidden="true">←</span> {project.parent.name}
        </Link>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <FolderKanban size={24} className="text-accent" aria-hidden="true" />
        <h1
          id="project-page-heading"
          tabIndex={-1}
          className="text-page-title font-bold text-content break-words outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-sm"
        >
          {projectName}
        </h1>
      </div>

      <div className="mt-1 flex items-center gap-1.5 text-caption text-content-muted">
        {project.customer ? (
          <>
            <CustomerChip
              customerId={project.customer.id}
              customerName={project.customer.name}
              logoUrl={project.customer.logo_url}
              size={16}
            />
            <span>
              {t("editSubtitleWithCustomer", {
                customer: project.customer.name,
              })}
            </span>
          </>
        ) : project.isInternal ? (
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

      <div className="mt-3 flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={status} label={tc(`status.${status}`)} />
          {overdue && projectedEndDate && (
            <OverdueBadge
              label={t("overdue")}
              tooltip={t("overdueTooltip", {
                date: formatDate(projectedEndDate),
              })}
            />
          )}
          {status === "completed" && closedAt && (
            <span className="text-caption text-content-muted">
              {t("closedOn", { date: formatDate(closedAt) })}
            </span>
          )}
        </div>
        <div className="ml-auto">
          <ProjectLifecycleActions
            projectId={id}
            status={status}
            isAdmin={project.callerIsAdmin}
          />
        </div>
      </div>

      <ProjectSectionNav
        projectId={id}
        callerIsAdmin={project.callerIsAdmin}
      />

      <div className="mt-6">{children}</div>
    </div>
  );
}
