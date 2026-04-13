import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Clock, FolderKanban } from "lucide-react";
import { ProjectEditForm } from "./project-edit-form";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const t = await getTranslations("projects");

  const { data: project } = await supabase
    .from("projects")
    .select("*, clients(name)")
    .eq("id", id)
    .single();

  if (!project) notFound();

  const { data: timeEntries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("project_id", id)
    .order("start_time", { ascending: false })
    .limit(20);

  const totalMinutes = (timeEntries ?? []).reduce(
    (sum, e) => sum + (e.duration_min ?? 0),
    0
  );
  const totalHours = (totalMinutes / 60).toFixed(1);

  return (
    <div>
      <ProjectEditForm project={project} />

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock size={20} className="text-accent" />
            <h2 className="text-lg font-semibold text-content">
              {t("timeEntries.title")}
            </h2>
          </div>
          {totalMinutes > 0 && (
            <span className="text-sm font-mono text-content-secondary">
              {t("timeEntries.totalHours", { hours: totalHours })}
            </span>
          )}
        </div>

        {timeEntries && timeEntries.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {timeEntries.map((entry) => {
              const hours = entry.duration_min
                ? Math.floor(entry.duration_min / 60)
                : 0;
              const mins = entry.duration_min ? entry.duration_min % 60 : 0;
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-edge bg-surface-raised px-4 py-3"
                >
                  <div>
                    <span className="text-content">
                      {entry.description || "—"}
                    </span>
                    <span className="ml-3 text-xs text-content-muted">
                      {new Date(entry.start_time).toLocaleDateString()}
                    </span>
                  </div>
                  <span className="text-sm font-mono text-content-secondary">
                    {entry.duration_min
                      ? `${hours}h ${mins}m`
                      : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-content-muted">
            {t("timeEntries.noEntries")}
          </p>
        )}
      </div>
    </div>
  );
}
