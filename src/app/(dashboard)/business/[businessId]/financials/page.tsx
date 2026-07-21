import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import {
  financialTeamIds,
  groupByCurrency,
  netForBusiness,
  parsePeriod,
  periodCutoff,
  sortByCurrency,
  type Period,
} from "../../business-list-helpers";
import {
  splitCollectedRevenue,
  summarizeOutstanding,
  AGING_BUCKETS,
  type AgingBucket,
  type OutstandingRow,
  type PaymentSplitRow,
} from "./compute";
import { FinancialsView, type FinancialsData } from "./financials-view";

interface PageProps {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ period?: string }>;
}

/** PostgREST returns a to-one embed as an object, but supabase-js types it
 *  loosely (sometimes an array). Normalize to the first row or null. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  if (Array.isArray(embed)) return embed[0] ?? null;
  return embed ?? null;
}

export default async function BusinessFinancialsPage({
  params,
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const { period: rawPeriod } = await searchParams;
  const period: Period = parsePeriod(rawPeriod);
  const t = await getTranslations("business");
  const supabase = await createClient();

  // Financials are per-team-admin: scope to the teams in this business the
  // viewer administers (the SAL-057 pattern), never the aggregate role. A
  // viewer with no admin team here doesn't get the tab — 404 like the
  // period-locks page. Membership is enforced by the business-team join.
  const userTeams = await getUserTeams();
  const userTeamIds = userTeams.map((tm) => tm.id);
  const { data: bizTeamRows } =
    userTeamIds.length > 0
      ? await supabase
          .from("teams")
          .select("id")
          .eq("business_id", businessId)
          .in("id", userTeamIds)
      : { data: [] };
  const bizTeamIdSet = new Set((bizTeamRows ?? []).map((r) => r.id as string));
  const teamsInBusiness = userTeams.filter((tm) => bizTeamIdSet.has(tm.id));
  const adminTeamIds = financialTeamIds(teamsInBusiness);
  if (adminTeamIds.length === 0) {
    notFound();
  }

  const now = new Date();
  const sinceIso = periodCutoff(period, now);
  const sinceDate = sinceIso.slice(0, 10);
  const todayDate = now.toISOString().slice(0, 10);

  const [
    paymentRows,
    outstandingRows,
    expenseRows,
    unbilledRows,
    lockRows,
  ] = await Promise.all([
    // Collected / Revenue / Tax — recorded payments in the period, joined
    // to the invoice's tax split for ex-tax apportionment.
    supabase
      .from("invoice_payments")
      .select(
        "amount, currency, invoices(subtotal, discount_amount, tax_amount, total)",
      )
      .in("team_id", adminTeamIds)
      .gte("paid_on", sinceDate)
      .lte("paid_on", todayDate),
    // Outstanding AR — a snapshot (not period-bounded), netted per invoice
    // against its same-currency payments.
    supabase
      .from("invoices")
      .select("total, currency, due_date, invoice_payments(amount, currency)")
      .in("team_id", adminTeamIds)
      .in("status", ["sent", "overdue"])
      .is("voided_at", null),
    // Expenses — ALL operating expenses in the period (billable included),
    // matching the Expenses tab + CSV definition.
    supabase
      .from("expenses")
      .select("amount, currency")
      .in("team_id", adminTeamIds)
      .is("deleted_at", null)
      .gte("incurred_on", sinceDate),
    // Unbilled billable time not yet invoiced (all-time snapshot).
    supabase
      .from("time_entries")
      .select("duration_min")
      .in("team_id", adminTeamIds)
      .eq("billable", true)
      .eq("invoiced", false)
      .not("end_time", "is", null)
      .is("deleted_at", null),
    supabase
      .from("team_period_locks")
      .select("period_end")
      .in("team_id", adminTeamIds)
      .order("period_end", { ascending: false })
      .limit(1),
  ]);

  const payments: PaymentSplitRow[] = (paymentRows.data ?? []).map((row) => {
    const inv = one(
      row.invoices as
        | {
            subtotal: number | string | null;
            discount_amount: number | string | null;
            tax_amount: number | string | null;
            total: number | string | null;
          }
        | Array<{
            subtotal: number | string | null;
            discount_amount: number | string | null;
            tax_amount: number | string | null;
            total: number | string | null;
          }>
        | null,
    );
    return {
      amount: row.amount as number | string | null,
      currency: row.currency as string | null,
      invoiceSubtotal: inv?.subtotal ?? 0,
      invoiceDiscount: inv?.discount_amount ?? 0,
      invoiceTaxAmount: inv?.tax_amount ?? 0,
      invoiceTotal: inv?.total ?? 0,
    };
  });
  const { collectedByCurrency, revenueByCurrency, taxByCurrency } =
    splitCollectedRevenue(payments);

  const expensesByCurrency = groupByCurrency(
    (expenseRows.data ?? []).map((row) => ({
      amount: row.amount as number | string | null,
      currency: row.currency as string | null,
    })),
  );

  const net = netForBusiness(revenueByCurrency, expensesByCurrency);

  // AR: net each outstanding invoice against its same-currency payments.
  const outstanding: OutstandingRow[] = (outstandingRows.data ?? []).map(
    (row) => {
      const invoiceCurrency = (
        (row.currency as string | null) ?? "USD"
      ).toUpperCase();
      const paymentsEmbed = (row.invoice_payments ?? []) as Array<{
        amount: number | string | null;
        currency: string | null;
      }>;
      const paidSameCurrency = paymentsEmbed.reduce((sum, p) => {
        const code = ((p.currency as string | null) ?? "USD").toUpperCase();
        return code === invoiceCurrency ? sum + Number(p.amount ?? 0) : sum;
      }, 0);
      const amountDue = Number(row.total ?? 0) - paidSameCurrency;
      return {
        amountDue,
        currency: invoiceCurrency,
        dueDate: (row.due_date as string | null) ?? null,
      };
    },
  );
  const ar = summarizeOutstanding(outstanding, now);

  const totalMin = (unbilledRows.data ?? []).reduce(
    (sum, e) => sum + ((e.duration_min as number | null) ?? 0),
    0,
  );
  const unbilledHours = Math.round((totalMin / 60) * 10) / 10;

  const lockedThrough =
    (lockRows.data?.[0]?.period_end as string | undefined) ?? null;

  const arAging: Array<{
    currency: string;
    buckets: Record<AgingBucket, number>;
  }> = Array.from(ar.agingByCurrency.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, buckets]) => ({ currency, buckets }));
  // Guarantee every bucket key exists (belt-and-suspenders for the view).
  for (const row of arAging) {
    for (const bucket of AGING_BUCKETS) {
      row.buckets[bucket] = row.buckets[bucket] ?? 0;
    }
  }

  const data: FinancialsData = {
    businessId,
    period,
    periodLabel: formatPeriodLabel(period, now, t),
    collected: sortByCurrency(collectedByCurrency),
    revenue: sortByCurrency(revenueByCurrency),
    tax: sortByCurrency(taxByCurrency),
    expenses: sortByCurrency(expensesByCurrency),
    net,
    arTotal: sortByCurrency(ar.totalByCurrency),
    arAging,
    unbilledHours,
    lockedThrough,
  };

  return <FinancialsView data={data} />;
}

function formatPeriodLabel(
  period: Period,
  now: Date,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const asOf = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(now);
  if (period === "ytd") {
    return t("stats.periodYtd", { year: now.getFullYear(), date: asOf });
  }
  if (period === "month") {
    return t("stats.periodMonth", { date: asOf });
  }
  return t("stats.periodLast12", { date: asOf });
}
