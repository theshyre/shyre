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
  id: string;
  name: string;
  legalName: string | null;
  entityType: string | null;
  customerCount: number;
  billableHoursThisMonth: number;
  expensesThisMonth: number;
  expensesCountThisMonth: number;
}

export default async function BusinessListPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("business");
  const supabase = await createClient();
  const teams = await getUserTeams();

  const summaries: BusinessSummary[] = await Promise.all(
    teams.map((org) => fetchSummary(supabase, org.id, org.name)),
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
          <h1 className="text-2xl font-bold text-content">{t("listTitle")}</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-xs font-medium text-content-muted">
            {teams.length}
          </span>
        </div>
        <p className="mt-2 text-sm text-content-secondary max-w-3xl">
          {t("listSubtitle")}
        </p>
      </div>

      {summaries.length === 0 ? (
        <div className="rounded-lg border border-edge bg-surface-raised p-8 text-center space-y-3">
          <Briefcase size={28} className="text-content-muted mx-auto" />
          <p className="text-sm text-content-secondary">{t("listEmpty")}</p>
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
                  <h2 className="text-base font-semibold text-content break-words">
                    {biz.legalName ?? biz.name}
                  </h2>
                  {biz.legalName && biz.legalName !== biz.name && (
                    <p className="text-xs text-content-muted truncate">
                      {biz.name}
                    </p>
                  )}
                  {biz.entityType && (
                    <span className="mt-1 inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-[11px] font-medium text-content-secondary">
                      {ENTITY_LABEL[biz.entityType] ?? biz.entityType}
                    </span>
                  )}
                </div>
                <LinkPendingSpinner size={14} className="" />
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
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
  teamId: string,
  fallbackName: string,
): Promise<BusinessSummary> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartStr = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;

  const [settings, customerCount, entries, expenseRows] = await Promise.all([
    supabase
      .from("team_settings")
      .select("legal_name, entity_type")
      .eq("team_id", teamId)
      .maybeSingle(),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .eq("archived", false),
    supabase
      .from("time_entries")
      .select("duration_min")
      .eq("team_id", teamId)
      .eq("billable", true)
      .not("end_time", "is", null)
      .gte("start_time", monthStart.toISOString()),
    supabase
      .from("expenses")
      .select("amount")
      .eq("team_id", teamId)
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
    id: teamId,
    name: fallbackName,
    legalName: (settings.data?.legal_name as string | null) ?? null,
    entityType: (settings.data?.entity_type as string | null) ?? null,
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
        <span className="text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-semibold font-mono tabular-nums text-content">
        {value}
      </p>
    </div>
  );
}
