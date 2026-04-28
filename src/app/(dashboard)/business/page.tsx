import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Briefcase, Plus, Users, DollarSign, Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { buttonSecondaryClass } from "@/lib/form-styles";

const ENTITY_LABEL: Record<string, string> = {
  sole_prop: "Sole Proprietorship",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  nonprofit: "Nonprofit",
  other: "Other",
};

interface BusinessSummary {
  /** business_id — anchor for /business/[businessId]. */
  id: string;
  /** Fallback display name (the first team's name) when the
   *  business has no legal_name set yet. */
  name: string;
  legalName: string | null;
  entityType: string | null;
  /** Number of teams under this business that the viewer can
   *  access. >1 surfaces a "+N teams" hint on the card. */
  teamCount: number;
  customerCount: number;
  billableHoursThisMonth: number;
  expensesThisMonth: number;
  expensesCountThisMonth: number;
}

export default async function BusinessListPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("business");
  const supabase = await createClient();
  const teams = await getUserTeams();

  // Resolve every team's business_id in one query (lets us dedupe
  // before fetching per-team stats — no point hitting customers /
  // time_entries / expenses twice for two teams in one business).
  const teamIds = teams.map((t) => t.id);
  const { data: teamRows } =
    teamIds.length > 0
      ? await supabase
          .from("teams")
          .select("id, business_id")
          .in("id", teamIds)
      : { data: [] };
  const businessIdByTeamId = new Map<string, string | null>();
  for (const row of teamRows ?? []) {
    businessIdByTeamId.set(
      row.id as string,
      (row.business_id as string | null) ?? null,
    );
  }

  // Group teams by business_id. Teams without a business_id (legacy
  // rows; should not exist post-migration but defense in depth) get
  // skipped — without a business_id they can't anchor a card link
  // that the new /business/[businessId] route can resolve.
  const teamsByBusiness = new Map<string, typeof teams>();
  for (const team of teams) {
    const bid = businessIdByTeamId.get(team.id);
    if (!bid) continue;
    const list = teamsByBusiness.get(bid) ?? [];
    list.push(team);
    teamsByBusiness.set(bid, list);
  }

  const summaries: BusinessSummary[] = await Promise.all(
    Array.from(teamsByBusiness.entries()).map(([businessId, teamGroup]) =>
      fetchSummary(supabase, businessId, teamGroup),
    ),
  );

  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <Briefcase size={24} className="text-accent" />
          <h1 className="text-page-title font-bold text-content">
            {t("listTitle")}
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-caption font-medium text-content-muted">
            {summaries.length}
          </span>
        </div>
        <p className="mt-2 text-body text-content-secondary max-w-3xl">
          {t("listSubtitle")}
        </p>
      </div>

      {summaries.length === 0 ? (
        <div className="rounded-lg border border-edge bg-surface-raised p-8 text-center space-y-3">
          <Briefcase size={28} className="text-content-muted mx-auto" />
          <p className="text-body text-content-secondary">{t("listEmpty")}</p>
          <Link
            href="/teams"
            className={`${buttonSecondaryClass} inline-flex`}
          >
            <Plus size={14} />
            {t("createBusiness")}
            <LinkPendingSpinner size={12} className="" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {summaries.map((biz) => (
            <Link
              key={biz.id}
              href={`/business/${biz.id}`}
              className="rounded-lg border border-edge bg-surface-raised p-5 hover:bg-hover transition-colors space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent-soft shrink-0">
                  <Briefcase size={22} className="text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-body-lg font-semibold text-content break-words">
                    {biz.legalName ?? biz.name}
                  </h2>
                  {biz.legalName && biz.legalName !== biz.name && (
                    <p className="text-caption text-content-muted truncate">
                      {biz.name}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {biz.entityType && (
                      <span className="inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-label font-medium text-content-secondary">
                        {ENTITY_LABEL[biz.entityType] ?? biz.entityType}
                      </span>
                    )}
                    {biz.teamCount > 1 && (
                      <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-label font-medium text-accent-text">
                        {t("stats.teamCount", { count: biz.teamCount })}
                      </span>
                    )}
                  </div>
                </div>
                <LinkPendingSpinner size={14} className="" />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Stat
                  icon={Users}
                  label={t("stats.customers")}
                  value={String(biz.customerCount)}
                />
                <Stat
                  icon={DollarSign}
                  label={t("stats.billableHoursShort")}
                  value={`${biz.billableHoursThisMonth}h`}
                />
                <Stat
                  icon={Receipt}
                  label={t("stats.expensesShort")}
                  value={
                    biz.expensesCountThisMonth === 0
                      ? "—"
                      : fmt.format(biz.expensesThisMonth)
                  }
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

async function fetchSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  teams: { id: string; name: string }[],
): Promise<BusinessSummary> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartStr = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;

  const sortedTeams = [...teams].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const representative = sortedTeams[0]!;
  const teamIds = sortedTeams.map((t) => t.id);

  const [business, customerCount, entries, expenseRows] = await Promise.all([
    supabase
      .from("businesses")
      .select("legal_name, entity_type")
      .eq("id", businessId)
      .maybeSingle(),
    // Stats are summed across all teams in the business — a card
    // reflects the business, not one team.
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .in("team_id", teamIds)
      .eq("archived", false),
    supabase
      .from("time_entries")
      .select("duration_min")
      .in("team_id", teamIds)
      .eq("billable", true)
      .not("end_time", "is", null)
      .is("deleted_at", null)
      .gte("start_time", monthStart.toISOString()),
    supabase
      .from("expenses")
      .select("amount")
      .in("team_id", teamIds)
      .is("deleted_at", null)
      .gte("incurred_on", monthStartStr),
  ]);

  const totalMin = (entries.data ?? []).reduce(
    (s, e) => s + (e.duration_min ?? 0),
    0,
  );
  const expensesTotal = (expenseRows.data ?? []).reduce(
    (s, e) => s + Number(e.amount ?? 0),
    0,
  );

  return {
    id: businessId,
    name: representative.name,
    legalName: (business.data?.legal_name as string | null) ?? null,
    entityType: (business.data?.entity_type as string | null) ?? null,
    teamCount: sortedTeams.length,
    customerCount: customerCount.count ?? 0,
    billableHoursThisMonth: Math.round((totalMin / 60) * 10) / 10,
    expensesThisMonth: expensesTotal,
    expensesCountThisMonth: expenseRows.data?.length ?? 0,
  };
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-edge bg-surface p-2">
      <div className="flex items-center gap-1 text-content-muted mb-0.5">
        <Icon size={10} />
        <span className="text-label uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-body font-semibold font-mono tabular-nums text-content">
        {value}
      </p>
    </div>
  );
}
