import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  LayoutDashboard,
  Clock,
  Timer,
  DollarSign,
  Users,
  FolderKanban,
  ArrowRight,
  Play,
  Plus,
} from "lucide-react";
import { buttonPrimaryClass, kbdClass } from "@/lib/form-styles";

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const { userEmail, orgName } = await getOrgContext();
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  // Get today's start/end
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();

  // Parallel queries
  const [todayEntries, weekEntries, activeTimers, unbilledEntries, clients, projects, recentEntries] =
    await Promise.all([
      supabase
        .from("time_entries")
        .select("duration_min")
        .gte("start_time", todayStart)
        .not("end_time", "is", null),
      supabase
        .from("time_entries")
        .select("duration_min")
        .gte("start_time", weekStart)
        .not("end_time", "is", null),
      supabase
        .from("time_entries")
        .select("id")
        .is("end_time", null),
      supabase
        .from("time_entries")
        .select("duration_min")
        .eq("invoiced", false)
        .eq("billable", true)
        .not("end_time", "is", null),
      supabase
        .from("clients")
        .select("id")
        .eq("archived", false),
      supabase
        .from("projects")
        .select("id")
        .eq("status", "active"),
      supabase
        .from("time_entries")
        .select("id, description, start_time, end_time, duration_min, projects(name)")
        .order("start_time", { ascending: false })
        .limit(5),
    ]);

  const todayMinutes = (todayEntries.data ?? []).reduce(
    (sum, e) => sum + (e.duration_min ?? 0), 0
  );
  const weekMinutes = (weekEntries.data ?? []).reduce(
    (sum, e) => sum + (e.duration_min ?? 0), 0
  );
  const unbilledMinutes = (unbilledEntries.data ?? []).reduce(
    (sum, e) => sum + (e.duration_min ?? 0), 0
  );
  const activeCount = activeTimers.data?.length ?? 0;
  const clientCount = clients.data?.length ?? 0;
  const projectCount = projects.data?.length ?? 0;

  const fmtHours = (mins: number): string => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const stats = [
    {
      label: t("stats.todayHours"),
      value: fmtHours(todayMinutes),
      icon: Clock,
      color: "text-accent" as const,
      bgColor: "bg-accent-soft" as const,
    },
    {
      label: t("stats.weekHours"),
      value: fmtHours(weekMinutes),
      icon: Clock,
      color: "text-info" as const,
      bgColor: "bg-info-soft" as const,
    },
    {
      label: t("stats.activeTimers"),
      value: String(activeCount),
      icon: Timer,
      color: activeCount > 0 ? "text-success" as const : "text-content-muted" as const,
      bgColor: activeCount > 0 ? "bg-success-soft" as const : "bg-surface-inset" as const,
    },
    {
      label: t("stats.unbilledHours"),
      value: fmtHours(unbilledMinutes),
      icon: DollarSign,
      color: "text-warning" as const,
      bgColor: "bg-warning-soft" as const,
    },
    {
      label: t("stats.totalClients"),
      value: String(clientCount),
      icon: Users,
      color: "text-accent" as const,
      bgColor: "bg-accent-soft" as const,
    },
    {
      label: t("stats.totalProjects"),
      value: String(projectCount),
      icon: FolderKanban,
      color: "text-accent" as const,
      bgColor: "bg-accent-soft" as const,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard size={24} className="text-accent" />
          <div>
            <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
            <p className="text-sm text-content-secondary">
              {t("welcomeBack", { email: userEmail })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/timer" className={buttonPrimaryClass}>
            <Play size={16} />
            {tc("nav.timer")}
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="rounded-lg border border-edge bg-surface-raised p-4"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.bgColor}`}
                >
                  <Icon size={20} className={stat.color} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
                    {stat.label}
                  </p>
                  <p className="text-xl font-bold font-mono text-content">
                    {stat.value}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Activity */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-content">
            {t("recentActivity")}
          </h2>
          <Link
            href="/time-entries"
            className="flex items-center gap-1 text-sm text-accent hover:underline"
          >
            {t("viewAll")}
            <ArrowRight size={14} />
          </Link>
        </div>

        {recentEntries.data && recentEntries.data.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {recentEntries.data.map((entry) => {
              const projectName =
                entry.projects &&
                typeof entry.projects === "object" &&
                "name" in entry.projects
                  ? (entry.projects as { name: string }).name
                  : "—";
              const isRunning = !entry.end_time;
              const hours = entry.duration_min
                ? Math.floor(entry.duration_min / 60)
                : 0;
              const mins = entry.duration_min
                ? Math.round(entry.duration_min % 60)
                : 0;

              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-edge bg-surface-raised px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    {isRunning ? (
                      <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-content-muted" />
                    )}
                    <div>
                      <span className="text-sm text-content">
                        {entry.description || "—"}
                      </span>
                      <span className="ml-2 text-xs text-content-muted">
                        {projectName}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-mono text-content-secondary">
                    {isRunning ? (
                      <span className="text-success">Running</span>
                    ) : (
                      `${hours}h ${mins}m`
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-content-muted">
            {clientCount === 0 ? t("getStarted") : t("noRecentActivity")}
          </p>
        )}
      </div>
    </div>
  );
}
