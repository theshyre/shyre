import { requireSystemAdmin } from "@/lib/system-admin";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { Database, Building2 } from "lucide-react";
import { TeamFilter } from "@/components/TeamFilter";
import { SampleDataControls } from "./controls";

interface PageProps {
  searchParams: Promise<{ org?: string }>;
}

interface TeamCounts {
  customersTotal: number;
  customersSample: number;
  projectsTotal: number;
  projectsSample: number;
  entriesTotal: number;
  entriesSample: number;
  expensesTotal: number;
  expensesSample: number;
  firstEntryAt: string | null;
  lastEntryAt: string | null;
}

async function fetchCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamId: string,
): Promise<TeamCounts> {
  const [customersTotal, customersSample, projectsTotal, projectsSample, entriesTotal, entriesSample, expensesTotal, expensesSample, firstEntry, lastEntry] = await Promise.all([
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .eq("is_sample", true),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .eq("is_sample", true),
    supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId),
    supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .eq("is_sample", true),
    supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId),
    supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .eq("is_sample", true),
    supabase
      .from("time_entries")
      .select("start_time")
      .eq("team_id", teamId)
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("time_entries")
      .select("start_time")
      .eq("team_id", teamId)
      .order("start_time", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    customersTotal: customersTotal.count ?? 0,
    customersSample: customersSample.count ?? 0,
    projectsTotal: projectsTotal.count ?? 0,
    projectsSample: projectsSample.count ?? 0,
    entriesTotal: entriesTotal.count ?? 0,
    entriesSample: entriesSample.count ?? 0,
    expensesTotal: expensesTotal.count ?? 0,
    expensesSample: expensesSample.count ?? 0,
    firstEntryAt: (firstEntry.data?.start_time as string | undefined) ?? null,
    lastEntryAt: (lastEntry.data?.start_time as string | undefined) ?? null,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 10);
}

export default async function SampleDataPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  await requireSystemAdmin();
  const t = await getTranslations("sampleData");
  const tc = await getTranslations("common");
  const supabase = await createClient();
  const teams = await getUserTeams();
  const sp = await searchParams;

  const selectedTeamId = sp.org ?? teams[0]?.id ?? null;
  const selectedTeam = teams.find((o) => o.id === selectedTeamId) ?? null;
  const counts = selectedTeamId ? await fetchCounts(supabase, selectedTeamId) : null;

  const multipleOrgs = teams.length > 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Database size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>

      <p className="text-sm text-content-secondary max-w-3xl">{t("subtitle")}</p>

      {!selectedTeamId || !selectedTeam || !counts ? (
        <div className="rounded-lg border border-edge bg-surface-raised p-6 text-sm text-content-muted">
          {t("noTeam")}
        </div>
      ) : (
        <>
          {/* Hero: which org is being targeted. Destructive per-org tool — the
              operator needs to see this at a glance, not hunt for a pill. */}
          <section className="rounded-lg border-2 border-accent/50 bg-accent-soft p-5 flex items-center gap-5 flex-wrap">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent/20">
              <Building2 size={28} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                {t("operatingOn")}
              </p>
              <h2 className="mt-0.5 text-3xl font-bold text-content break-words">
                {selectedTeam.name}
              </h2>
              {!multipleOrgs && (
                <p className="mt-0.5 text-xs text-content-muted">
                  {t("onlyTeam")}
                </p>
              )}
            </div>
            {multipleOrgs && (
              <div className="shrink-0">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-content-muted">
                  {t("switchTeam")}
                </p>
                <TeamFilter teams={teams} selectedTeamId={selectedTeamId} />
              </div>
            )}
          </section>

          {/* Counts for the selected org. */}
          <section className="rounded-lg border border-edge bg-surface-raised p-5 space-y-3">
            <h2 className="text-sm font-semibold text-content">
              {t("currentData")}
            </h2>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <CountBlock
                label={tc("nav.customers")}
                total={counts.customersTotal}
                sample={counts.customersSample}
                tSample={t("sampleLabel")}
              />
              <CountBlock
                label={tc("nav.projects")}
                total={counts.projectsTotal}
                sample={counts.projectsSample}
                tSample={t("sampleLabel")}
              />
              <CountBlock
                label={tc("nav.time")}
                total={counts.entriesTotal}
                sample={counts.entriesSample}
                tSample={t("sampleLabel")}
              />
              <CountBlock
                label={t("expensesLabel")}
                total={counts.expensesTotal}
                sample={counts.expensesSample}
                tSample={t("sampleLabel")}
              />
            </dl>
            <div className="text-xs text-content-muted pt-1">
              {t("entryRange", {
                first: formatDate(counts.firstEntryAt),
                last: formatDate(counts.lastEntryAt),
              })}
            </div>
          </section>

          <SampleDataControls
            teamId={selectedTeamId}
            teamName={selectedTeam.name}
            hasSample={
              counts.entriesSample > 0 ||
              counts.projectsSample > 0 ||
              counts.customersSample > 0 ||
              counts.expensesSample > 0
            }
          />
        </>
      )}
    </div>
  );
}

function CountBlock({
  label,
  total,
  sample,
  tSample,
}: {
  label: string;
  total: number;
  sample: number;
  tSample: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-edge bg-surface p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
        {label}
      </dt>
      <dd className="mt-1">
        <span className="text-2xl font-bold text-content tabular-nums">{total}</span>
        {sample > 0 && (
          <span className="ml-2 text-xs text-content-muted">
            · {sample} {tSample}
          </span>
        )}
      </dd>
    </div>
  );
}
