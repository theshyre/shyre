import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft, History as HistoryIcon } from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess } from "@/lib/team-context";
import { getProjectHistoryAction } from "../../actions";
import { ProjectHistoryTimeline } from "./project-history-timeline";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects.history");
  return { title: t("title") };
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectHistoryPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  const t = await getTranslations("projects.history");

  // Resolve the project's team to gate by role. Owner/admin only —
  // mirrors the RLS policy on projects_history (`ph_select`).
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, team_id")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    return (
      <div className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted">
        {t("notFound")}
      </div>
    );
  }

  const { role } = await validateTeamAccess(project.team_id as string);
  const isAdmin = role === "owner" || role === "admin";

  const { history, hasMore } = isAdmin
    ? await getProjectHistoryAction(id, { limit: 200 })
    : { history: [], hasMore: false };

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/projects/${id}`}
          className="inline-flex items-center gap-1 text-caption text-content-muted hover:text-content"
        >
          <ArrowLeft size={12} />
          {t("backToProject", { name: project.name as string })}
          <LinkPendingSpinner size={10} className="" />
        </Link>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <HistoryIcon size={20} className="text-accent" />
          <h2 className="text-title font-semibold text-content">
            {t("title")}
          </h2>
          <span className="inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-muted">
            {t("entryCount", { count: history.length })}
          </span>
        </div>
        <p className="mt-2 text-body text-content-secondary max-w-3xl">
          {t("description")}
        </p>
      </div>

      {!isAdmin ? (
        <p className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted italic">
          {t("notAdmin")}
        </p>
      ) : history.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted italic">
          {t("empty")}
        </p>
      ) : (
        <ProjectHistoryTimeline
          projectId={id}
          entries={history}
          hasMore={hasMore}
        />
      )}
    </div>
  );
}
