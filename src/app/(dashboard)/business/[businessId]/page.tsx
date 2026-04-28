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
          .select("amount, currency")
          .in("team_id", teamIds)
          .is("deleted_at", null)
          .gte("incurred_on", monthStartStr)
      : { data: [] };
  const expensesCount = expenseRows?.length ?? 0;
  // Expenses can be in different currencies; group by code so we
  // never silently sum across them.
  const expensesByCurrency = new Map<string, number>();
  for (const row of expenseRows ?? []) {
    const code = ((row.currency as string | null) ?? "USD").toUpperCase();
    expensesByCurrency.set(
      code,
      (expensesByCurrency.get(code) ?? 0) + Number(row.amount ?? 0),
    );
  }

  // People living on this business — owners/employees/contractors
  // collectively. Live count powers the People tile (replacing the
  // old "Coming soon" placeholder now that /people is shipped).
  const { count: peopleCount } = await supabase
    .from("business_people")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .is("deleted_at", null);

  function fmtMoney(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }
  const expensesTotalLabel =
    expensesByCurrency.size === 0
      ? fmtMoney(0, "USD")
      : Array.from(expensesByCurrency.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([code, amt]) => fmtMoney(amt, code))
          .join(" · ");

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
                amount: expensesTotalLabel,
              })}
            </p>
          </div>
        </Link>

        <Link
          href={`/business/${businessId}/people`}
          className="flex items-start gap-4 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
        >
          <UserCog size={20} className="text-accent shrink-0 mt-1" />
          <div className="min-w-0">
            <p className="text-body-lg font-medium text-content">
              {t("tiles.people.title")}
            </p>
            <p className="mt-0.5 text-caption text-content-muted">
              {t("tiles.people.summary", { count: peopleCount ?? 0 })}
            </p>
          </div>
        </Link>
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
