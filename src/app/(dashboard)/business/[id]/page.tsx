import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Users, DollarSign, Receipt, UserCog } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BusinessOverviewPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { id: teamId } = await params;
  const t = await getTranslations("business");
  const supabase = await createClient();

  const { count: customerCount } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("archived", false);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { data: entries } = await supabase
    .from("time_entries")
    .select("duration_min")
    .eq("team_id", teamId)
    .eq("billable", true)
    .not("end_time", "is", null)
    .is("deleted_at", null)
    .gte("start_time", monthStart.toISOString());
  const totalMin = (entries ?? []).reduce(
    (s, e) => s + (e.duration_min ?? 0),
    0,
  );
  const billableHours = Math.round((totalMin / 60) * 10) / 10;

  const monthStartStr = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;
  const { data: expenseRows } = await supabase
    .from("expenses")
    .select("amount")
    .eq("team_id", teamId)
    .gte("incurred_on", monthStartStr);
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
          href={`/business/${teamId}/expenses`}
          className="flex items-start gap-4 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
        >
          <Receipt size={20} className="text-accent shrink-0 mt-1" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-content">{t("tiles.expenses.title")}</p>
            <p className="mt-0.5 text-xs text-content-muted">
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
            <p className="text-sm font-medium text-content-secondary">
              {t("tiles.people.title")}
            </p>
            <p className="mt-1 text-xs text-content-muted">
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
        <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">
          {label}
        </p>
        <p className="text-2xl font-semibold text-content font-mono tabular-nums">
          {value}
        </p>
      </div>
    </Link>
  );
}
