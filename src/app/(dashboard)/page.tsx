import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}
import {
  LayoutDashboard,
  Clock,
  Timer,
  DollarSign,
  Users,
  FolderKanban,
  ArrowRight,
  Play,
} from "lucide-react";
import { buttonPrimaryClass } from "@/lib/form-styles";
import { ExpiringCredentialsBanner } from "@/components/ExpiringCredentialsBanner";
import { EntryAuthor, type EntryAuthorInfo } from "@/components/EntryAuthor";

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const { userEmail } = await getUserContext();
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  // Get today's start/end
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();

  // Parallel queries
  const [todayEntries, weekEntries, activeTimers, unbilledEntries, customers, projects, recentEntries] =
    await Promise.all([
      supabase
        .from("time_entries")
        .select("duration_min")

        .gte("start_time", todayStart)
        .not("end_time", "is", null)
        .is("deleted_at", null),
      supabase
        .from("time_entries")
        .select("duration_min")

        .gte("start_time", weekStart)
        .not("end_time", "is", null)
        .is("deleted_at", null),
      supabase
        .from("time_entries")
        .select("id")

        .is("end_time", null)
        .is("deleted_at", null),
      supabase
        .from("time_entries")
        .select("duration_min")

        .eq("invoiced", false)
        .eq("billable", true)
        .not("end_time", "is", null)
        .is("deleted_at", null),
      supabase
        .from("customers")
        .select("id")

        .eq("archived", false),
      supabase
        .from("projects")
        .select("id")

        .eq("status", "active"),
      supabase
        .from("time_entries")
        .select(
          "id, description, start_time, end_time, duration_min, user_id, projects(name)",
        )

        .is("deleted_at", null)
        .order("start_time", { ascending: false })
        .limit(5),
    ]);

  // Resolve author profiles in one round-trip so the recent-activity
  // list can show who logged each entry — required by the mandatory
  // time-entry authorship rule (CLAUDE.md).
  const recentRows = recentEntries.data ?? [];
  const authorIds = Array.from(
    new Set(
      recentRows
        .map((r) => (r.user_id as string | null) ?? null)
        .filter((id): id is string => id !== null),
    ),
  );
  const authorById = new Map<string, EntryAuthorInfo>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", authorIds);
    for (const p of profiles ?? []) {
      authorById.set(p.user_id as string, {
        user_id: p.user_id as string,
        display_name: (p.display_name as string | null) ?? null,
        avatar_url: (p.avatar_url as string | null) ?? null,
      });
    }
  }

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
  const clientCount = customers.data?.length ?? 0;
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
            <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
            <p className="text-body-lg text-content-secondary">
              {t("welcomeBack", { email: userEmail })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/time-entries" className={buttonPrimaryClass}>
            <Play size={16} />
            {tc("nav.time")}
          </Link>
        </div>
      </div>

      {/* Credential expiry warnings — hides itself when nothing
          is expiring within 30 days. RLS scopes which credentials
          each viewer can see. */}
      <div className="mt-6">
        <ExpiringCredentialsBanner />
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
                  <p className="text-caption font-semibold uppercase tracking-wider text-content-muted">
                    {stat.label}
                  </p>
                  <p className="text-title font-bold font-mono text-content">
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
          <h2 className="text-title font-semibold text-content">
            {t("recentActivity")}
          </h2>
          <Link
            href="/time-entries"
            className="flex items-center gap-1 text-body-lg text-accent hover:underline"
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

              const author =
                (entry.user_id &&
                  authorById.get(entry.user_id as string)) ||
                null;

              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-edge bg-surface-raised px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {isRunning ? (
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-success-soft text-success-text"
                        aria-label={tc("status.running")}
                      >
                        <Play size={10} />
                      </span>
                    ) : (
                      <span
                        className="h-2 w-2 rounded-full bg-content-muted"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <span className="text-body text-content">
                        {entry.description || "—"}
                      </span>
                      <span className="ml-2 text-caption text-content-muted">
                        {projectName}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <EntryAuthor author={author} compact />
                    <span className="text-body font-mono text-content-secondary">
                      {isRunning ? (
                        <span className="text-success">
                          {tc("status.running")}
                        </span>
                      ) : (
                        `${hours}h ${mins}m`
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-body-lg text-content-muted">
            {clientCount === 0 ? t("getStarted") : t("noRecentActivity")}
          </p>
        )}
      </div>
    </div>
  );
}
