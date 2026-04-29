import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { HarvestImport } from "./harvest-import";
import { ExpensesCsvImport } from "./expenses-csv-import";
import { ImportHistory, type ImportRunRow } from "./import-history";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import");
  return { title: t("title") };
}

export default async function ImportPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("import");
  const supabase = await createClient();
  const teams = await getUserTeams();

  const [runs, adminTeamIds] = await fetchImportHistory(supabase, teams);

  return (
    <div>
      <div className="flex items-center gap-3">
        <Upload size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>

      <p className="mt-2 text-sm text-content-secondary">{t("subtitle")}</p>

      <HarvestImport teams={teams} />
      <ExpensesCsvImport teams={teams} />
      <ImportHistory runs={runs} adminTeamIds={adminTeamIds} />
    </div>
  );
}

async function fetchImportHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teams: Awaited<ReturnType<typeof getUserTeams>>,
): Promise<[ImportRunRow[], string[]]> {
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length === 0) return [[], []];

  const { data: rawRuns } = await supabase
    .from("import_runs")
    .select(
      "id, team_id, imported_from, source_account_identifier, started_at, completed_at, status, summary, undone_at, triggered_by_user_id, undone_by_user_id",
    )
    .in("team_id", teamIds)
    .order("started_at", { ascending: false })
    .limit(50);

  const runs = rawRuns ?? [];
  const adminTeamIds = teams
    .filter((team) => team.role === "owner" || team.role === "admin")
    .map((team) => team.id);

  if (runs.length === 0) return [[], adminTeamIds];

  // Resolve display names for triggered_by / undone_by in one query.
  const userIds = Array.from(
    new Set(
      runs.flatMap((r) => [
        r.triggered_by_user_id as string | null,
        r.undone_by_user_id as string | null,
      ]),
    ),
  ).filter((id): id is string => typeof id === "string");

  const nameByUserId = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    for (const p of profiles ?? []) {
      nameByUserId.set(
        p.user_id as string,
        (p.display_name as string | null) ?? null,
      );
    }
  }

  const result: ImportRunRow[] = runs.map((r) => ({
    id: r.id as string,
    team_id: r.team_id as string,
    imported_from: r.imported_from as string,
    source_account_identifier: (r.source_account_identifier as string | null) ?? null,
    started_at: r.started_at as string,
    completed_at: (r.completed_at as string | null) ?? null,
    status: r.status as ImportRunRow["status"],
    summary: (r.summary as ImportRunRow["summary"]) ?? null,
    undone_at: (r.undone_at as string | null) ?? null,
    triggered_by_display_name:
      r.triggered_by_user_id
        ? (nameByUserId.get(r.triggered_by_user_id as string) ?? null)
        : null,
    undone_by_display_name:
      r.undone_by_user_id
        ? (nameByUserId.get(r.undone_by_user_id as string) ?? null)
        : null,
  }));

  return [result, adminTeamIds];
}
