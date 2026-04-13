import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Clock, Hash, ExternalLink } from "lucide-react";
import { ProjectEditForm } from "./project-edit-form";

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
  const { orgId } = await getOrgContext();
  const t = await getTranslations("projects");

  const { data: project } = await supabase
    .from("projects")
    .select("*, clients(name)")
    .eq("organization_id", orgId)
    .eq("id", id)
    .single();

  if (!project) notFound();

  const { data: timeEntries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("organization_id", orgId)
    .eq("project_id", id)
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

  return (
    <div>
      <ProjectEditForm project={project} />

      {/* Issue Time Summary */}
      {issueSummaries.length > 0 && project.github_repo && (
        <div className="mt-8">
          <div className="flex items-center gap-3">
            <Hash size={20} className="text-accent" />
            <h2 className="text-lg font-semibold text-content">
              Time by Issue
            </h2>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge bg-surface-inset">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                    Issue
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                    Entries
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
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
                      <span className="text-xs font-mono text-accent">
                        #{entry.github_issue}
                      </span>
                    )}
                    <span className="text-xs text-content-muted">
                      {new Date(entry.start_time).toLocaleDateString()}
                    </span>
                  </div>
                  <span className="text-sm font-mono text-content-secondary">
                    {entry.duration_min ? `${hours}h ${mins}m` : "—"}
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
