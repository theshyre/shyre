import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Users, DollarSign, Receipt, UserCog } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";

interface PageProps {
  params: Promise<{ businessId: string }>;
}

export default async function BusinessOverviewPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const t = await getTranslations("business");
  const supabase = await createClient();

  // Stats are scoped to every team under this business that the
  // viewer is a member of. Single-team businesses match exactly one
  // team here; multi-team agencies sum across the group.
  const userTeams = await getUserTeams();
  const userTeamIds = userTeams.map((tm) => tm.id);
  const { data: businessTeams } =
    userTeamIds.length > 0
      ? await supabase
          .from("teams")
          .select("id")
          .eq("business_id", businessId)
          .in("id", userTeamIds)
      : { data: [] };
  const teamIds = (businessTeams ?? []).map((row) => row.id as string);

  const { count: customerCount } =
    teamIds.length > 0
      ? await supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .in("team_id", teamIds)
          .eq("archived", false)
      : { count: 0 };

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { data: entries } =
    teamIds.length > 0
      ? await supabase
          .from("time_entries")
          .select("duration_min")
          .in("team_id", teamIds)
          .eq("billable", true)
          .not("end_time", "is", null)
          .is("deleted_at", null)
          .gte("start_time", monthStart.toISOString())
      : { data: [] };
  const totalMin = (entries ?? []).reduce(
    (s, e) => s + (e.duration_min ?? 0),
    0,
  );
  const billableHours = Math.round((totalMin / 60) * 10) / 10;

  const monthStartStr = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;
  const { data: expenseRows } =
    teamIds.length > 0
      ? await supabase
          .from("expenses")
          .select("amount")
          .in("team_id", teamIds)
          .gte("incurred_on", monthStartStr)
      : { data: [] };
  const expensesCount = expenseRows?.length ?? 0;
  const expensesTotal = (expenseRows ?? []).reduce(
    (s, e) => s + Number(e.amount ?? 0),
    0,
  );

  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard
          icon={Users}
          label={t("stats.customers")}
          value={String(customerCount ?? 0)}
          href="/customers"
        />
        <StatCard
          icon={DollarSign}
          label={t("stats.billableHours")}
          value={`${billableHours}h`}
          href="/time-entries"
        />
      </section>

      {/* Module tiles */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`/business/${businessId}/expenses`}
          className="flex items-start gap-4 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
        >
          <Receipt size={20} className="text-accent shrink-0 mt-1" />
          <div className="min-w-0">
            <p className="text-body-lg font-medium text-content">
              {t("tiles.expenses.title")}
            </p>
            <p className="mt-0.5 text-caption text-content-muted">
              {t("tiles.expenses.summary", {
                count: expensesCount,
                amount: fmt.format(expensesTotal),
              })}
            </p>
          </div>
        </Link>

        <div className="flex items-start gap-4 rounded-lg border border-dashed border-edge bg-surface-raised/40 p-4">
          <UserCog size={20} className="text-content-muted shrink-0 mt-1" />
          <div className="min-w-0">
            <p className="text-body-lg font-medium text-content-secondary">
              {t("tiles.people.title")}
            </p>
            <p className="mt-1 text-caption text-content-muted">
              {t("tiles.people.hint")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  href: string;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
    >
      <Icon size={20} className="text-accent shrink-0" />
      <div>
        <p className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {label}
        </p>
        <p className="text-page-title font-semibold text-content font-mono tabular-nums">
          {value}
        </p>
      </div>
    </Link>
  );
}
