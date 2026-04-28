import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { validateBusinessAccess, getUserTeams } from "@/lib/team-context";
import { LockPeriodForm } from "./lock-period-form";
import { LockRow } from "./lock-row";

interface PageProps {
  params: Promise<{ businessId: string }>;
}

interface LockRecord {
  team_id: string;
  team_name: string;
  period_end: string;
  locked_at: string;
  locked_by_user_id: string | null;
  locked_by_display_name: string | null;
  notes: string | null;
}

/** Period-locks management page — owner|admin only.
 *  Lists existing locks per team in this business and lets the
 *  caller add or remove them. */
export default async function PeriodLocksPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const t = await getTranslations("business.periodLocks");
  const supabase = await createClient();
  const { role } = await validateBusinessAccess(businessId);
  if (role !== "owner" && role !== "admin") {
    notFound();
  }

  // Resolve which teams in this business the caller can manage.
  const userTeams = await getUserTeams();
  const userTeamIds = userTeams.map((tm) => tm.id);
  const { data: businessTeams } =
    userTeamIds.length > 0
      ? await supabase
          .from("teams")
          .select("id, name")
          .eq("business_id", businessId)
          .in("id", userTeamIds)
      : { data: [] };
  const teamOptions = (businessTeams ?? [])
    .map((row) => ({
      id: row.id as string,
      name: (row.name as string) ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (teamOptions.length === 0) {
    notFound();
  }

  // Fetch existing locks for those teams.
  const teamIds = teamOptions.map((tm) => tm.id);
  const { data: lockRows } = await supabase
    .from("team_period_locks")
    .select("team_id, period_end, locked_at, locked_by_user_id, notes")
    .in("team_id", teamIds)
    .order("period_end", { ascending: false });

  const actorIds = Array.from(
    new Set(
      (lockRows ?? [])
        .map((r) => r.locked_by_user_id as string | null)
        .filter((id): id is string => id !== null),
    ),
  );
  const actorNameById = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const p of profiles ?? []) {
      actorNameById.set(
        p.user_id as string,
        (p.display_name as string | null) ?? null,
      );
    }
  }

  const teamNameById = new Map(teamOptions.map((tm) => [tm.id, tm.name]));
  const locks: LockRecord[] = (lockRows ?? []).map((r) => ({
    team_id: r.team_id as string,
    team_name: teamNameById.get(r.team_id as string) ?? "",
    period_end: r.period_end as string,
    locked_at: r.locked_at as string,
    locked_by_user_id: (r.locked_by_user_id as string | null) ?? null,
    locked_by_display_name:
      (r.locked_by_user_id as string | null) !== null
        ? (actorNameById.get(r.locked_by_user_id as string) ?? null)
        : null,
    notes: (r.notes as string | null) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Lock size={20} className="text-accent" />
          <h2 className="text-title font-semibold text-content">
            {t("title")}
          </h2>
        </div>
        <p className="mt-1 text-body text-content-secondary max-w-3xl">
          {t("description")}
        </p>
      </div>

      <LockPeriodForm teamOptions={teamOptions} />

      {locks.length === 0 ? (
        <p className="text-body text-content-muted">{t("noLocks")}</p>
      ) : (
        <div className="space-y-2">
          {locks.map((lock) => (
            <LockRow
              key={`${lock.team_id}::${lock.period_end}`}
              teamId={lock.team_id}
              teamName={lock.team_name}
              periodEnd={lock.period_end}
              lockedAt={lock.locked_at}
              lockedByDisplayName={lock.locked_by_display_name}
              notes={lock.notes}
              showTeam={teamOptions.length > 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
