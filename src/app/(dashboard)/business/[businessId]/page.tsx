import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Users,
  DollarSign,
  Receipt,
  UserCog,
  FileBadge,
  Lock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams, validateBusinessAccess } from "@/lib/team-context";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ businessId: string }>;
}): Promise<Metadata> {
  const { businessId } = await params;
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("name, legal_name")
    .eq("id", businessId)
    .maybeSingle();
  const t = await getTranslations("business");
  if (!business) {
    return { title: t("title") };
  }
  return {
    title:
      ((business.legal_name as string | null) ??
        (business.name as string | null) ??
        t("untitled")) as string,
  };
}

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

  // Identity row → drives the Identity tile. Just legal_name +
  // entity_type — no sensitive fields. Falls through to NULLs
  // when the user hasn't filled identity yet.
  const { data: identity } = await supabase
    .from("businesses")
    .select("legal_name, entity_type")
    .eq("id", businessId)
    .maybeSingle();

  // Period locks (admin only) — surface the latest lock on the
  // overview so the bookkeeper / owner can see at a glance "is
  // March closed yet?" without navigating to the period-locks tab.
  const { role: businessRole } = await validateBusinessAccess(businessId);
  const canManagePeriodLocks =
    businessRole === "owner" || businessRole === "admin";
  let latestLockEnd: string | null = null;
  if (canManagePeriodLocks && teamIds.length > 0) {
    const { data: locks } = await supabase
      .from("team_period_locks")
      .select("period_end")
      .in("team_id", teamIds)
      .order("period_end", { ascending: false })
      .limit(1);
    latestLockEnd = (locks?.[0]?.period_end as string | undefined) ?? null;
  }

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

  // The Customers stat used to link to /customers (global) which
  // listed customers from EVERY team the user belonged to, not
  // just teams in this business — so the count on the card and
  // the page contents disagreed. Drop the link until /customers
  // accepts a business filter; render as a stat card. (Persona
  // finding: agency-owner #1.)
  const entityLabel = identity?.entity_type
    ? String(identity.entity_type).replace(/_/g, " ")
    : null;
  // Empty-state CTA: when legal_name is null the business is a
  // bare shell. Setting up identity is the next obvious step
  // (without it invoices can't render the legal entity, fiscal
  // year is unknown, tax IDs are empty). Promote the Identity
  // tile to a full-width call-to-action above the grid so it's
  // the first thing the eye lands on. UX-designer review
  // tradeoff: Overview's layout shifts shape based on this state,
  // which is a small consistency cost in exchange for one click
  // instead of two on the most-common new-shell flow.
  const identityNeedsSetup = !identity?.legal_name;

  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard
          icon={Users}
          label={t("stats.customers")}
          value={String(customerCount ?? 0)}
          href={null}
        />
        <StatCard
          icon={DollarSign}
          label={t("stats.billableHours")}
          value={`${billableHours}h`}
          href="/time-entries"
        />
      </section>

      {identityNeedsSetup && (
        <Link
          href={`/business/${businessId}/identity`}
          className="group flex items-center gap-4 rounded-lg border border-accent/40 bg-accent-soft/40 p-5 hover:bg-accent-soft transition-colors"
        >
          <FileBadge size={24} className="text-accent shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-body-lg font-semibold text-content">
              {t("identityCta.title")}
            </p>
            <p className="mt-0.5 text-caption text-content-secondary">
              {t("identityCta.summary")}
            </p>
          </div>
          <span className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-body font-medium text-accent-text group-hover:opacity-90 transition-opacity">
            {t("identityCta.action")}
          </span>
        </Link>
      )}

      {/* Module tiles — every shipped sub-tab gets a tile so the
          overview is a real summary, not a v0 placeholder grid. */}
      <section className="grid gap-4 sm:grid-cols-2">
        {!identityNeedsSetup && (
          <TileLink
            href={`/business/${businessId}/identity`}
            icon={FileBadge}
            title={t("tiles.identity.title")}
            summary={
              entityLabel
                ? `${identity?.legal_name as string} · ${entityLabel}`
                : (identity?.legal_name as string)
            }
          />
        )}
        <TileLink
          href={`/business/${businessId}/expenses`}
          icon={Receipt}
          title={t("tiles.expenses.title")}
          summary={t("tiles.expenses.summary", {
            count: expensesCount,
            amount: expensesTotalLabel,
          })}
        />
        <TileLink
          href={`/business/${businessId}/people`}
          icon={UserCog}
          title={t("tiles.people.title")}
          summary={t("tiles.people.summary", { count: peopleCount ?? 0 })}
        />
        {canManagePeriodLocks && (
          <TileLink
            href={`/business/${businessId}/period-locks`}
            icon={Lock}
            title={t("tiles.periodLocks.title")}
            summary={
              latestLockEnd
                ? t("tiles.periodLocks.lockedThrough", { date: latestLockEnd })
                : t("tiles.periodLocks.empty")
            }
          />
        )}
      </section>
    </div>
  );
}

function TileLink({
  href,
  icon: Icon,
  title,
  summary,
}: {
  href: string;
  icon: typeof Users;
  title: string;
  summary: string;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      className="flex items-start gap-4 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
    >
      <Icon size={20} className="text-accent shrink-0 mt-1" />
      <div className="min-w-0">
        <p className="text-body-lg font-medium text-content">{title}</p>
        <p className="mt-0.5 text-caption text-content-muted">{summary}</p>
      </div>
    </Link>
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
  /** When null, renders a non-interactive card. Used for stats whose
   *  natural drill-down doesn't yet support a business filter. */
  href: string | null;
}): React.JSX.Element {
  const inner = (
    <>
      <Icon size={20} className="text-accent shrink-0" />
      <div>
        <p className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {label}
        </p>
        <p className="text-page-title font-semibold text-content font-mono tabular-nums">
          {value}
        </p>
      </div>
    </>
  );
  const cls =
    "flex items-center gap-4 rounded-lg border border-edge bg-surface-raised p-4";
  if (href === null) {
    return <div className={cls}>{inner}</div>;
  }
  return (
    <Link href={href} className={`${cls} hover:bg-hover transition-colors`}>
      {inner}
    </Link>
  );
}
