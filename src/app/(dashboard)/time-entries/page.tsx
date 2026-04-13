import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { List, CheckCircle, Circle } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import { NewTimeEntryForm } from "./new-time-entry-form";

export default async function TimeEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const { org: selectedOrgId } = await searchParams;
  const t = await getTranslations("time");
  const tc = await getTranslations("common");

  let entriesQuery = supabase
    .from("time_entries")
    .select("*, projects(name)")
    .order("start_time", { ascending: false })
    .limit(50);
  if (selectedOrgId) entriesQuery = entriesQuery.eq("organization_id", selectedOrgId);
  const { data: entries } = await entriesQuery;

  let projectsQuery = supabase
    .from("projects")
    .select("id, name, github_repo")
    .eq("status", "active")
    .order("name");
  if (selectedOrgId) projectsQuery = projectsQuery.eq("organization_id", selectedOrgId);
  const { data: projects } = await projectsQuery;

  const orgName = (orgId: string) => orgs.find(o => o.id === orgId)?.name ?? "\u2014";

  return (
    <div>
      <div className="flex items-center gap-3">
        <List size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <OrgFilter orgs={orgs} selectedOrgId={selectedOrgId ?? null} />
      </div>

      <NewTimeEntryForm projects={projects ?? []} orgs={orgs} defaultOrgId={selectedOrgId} />

      {entries && entries.length > 0 ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge bg-surface-inset">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.project")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  Org
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.description")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.date")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.duration")}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.billable")}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const projectName =
                  entry.projects &&
                  typeof entry.projects === "object" &&
                  "name" in entry.projects
                    ? (entry.projects as { name: string }).name
                    : "—";
                const hours = entry.duration_min
                  ? Math.floor(entry.duration_min / 60)
                  : 0;
                const mins = entry.duration_min
                  ? Math.round(entry.duration_min % 60)
                  : 0;
                const isRunning = !entry.end_time;

                return (
                  <tr
                    key={entry.id}
                    className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-4 py-3 text-content-secondary">
                      {projectName}
                    </td>
                    <td className="px-4 py-3 text-content-secondary text-xs">
                      {orgName(entry.organization_id)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/time-entries/${entry.id}`}
                        className="text-accent hover:underline"
                      >
                        {entry.description || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-content-secondary text-xs">
                      {new Date(entry.start_time).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-content-secondary">
                      {isRunning ? (
                        <span className="inline-flex items-center gap-1.5 text-success">
                          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                          {t("timer.running")}
                        </span>
                      ) : (
                        `${hours}h ${mins}m`
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {entry.billable ? (
                        <CheckCircle
                          size={16}
                          className="inline text-success"
                        />
                      ) : (
                        <Circle
                          size={16}
                          className="inline text-content-muted"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-sm text-content-muted">
          {t("noEntries")}
        </p>
      )}
    </div>
  );
}
