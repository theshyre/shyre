import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Briefcase,
  Plus,
  Receipt,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams, type TeamListItem } from "@/lib/team-context";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { buttonSecondaryClass } from "@/lib/form-styles";
import {
  formatCurrency,
  formatSignedCurrency,
  groupByCurrency,
  maxRole,
  netForBusiness,
  rolling12MonthCutoff,
  sortByCurrency,
  type Role,
} from "./business-list-helpers";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("business");
  return { title: t("listTitle") };
}

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
  /** Highest role the viewer holds across this business's teams.
   *  Drives whether financial KPIs render at all — non-admins see
   *  only customer count + entity metadata. */
  viewerRole: Role;
  /** Cash collected in the last 12 months, grouped by currency.
   *  ISO 4217 → minor-unit total. We never sum across currencies. */
  revenueByCurrency: Map<string, number>;
  /** Non-billable expenses in the last 12 months, by currency.
   *  Billable-to-customer expenses are excluded by default — they
   *  rebill on the income side and including them inflates the
   *  expenses figure (see bookkeeper persona). */
  expensesByCurrency: Map<string, number>;
}

export default async function BusinessListPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("business");
  const supabase = await createClient();
  const teams = await getUserTeams();

  // Resolve every team's business_id in one query (lets us dedupe
  // before fetching per-team stats — no point hitting customers /
  // invoices / expenses twice for two teams in one business).
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
  const teamsByBusiness = new Map<string, TeamListItem[]>();
  for (const team of teams) {
    const bid = businessIdByTeamId.get(team.id);
    if (!bid) continue;
    const list = teamsByBusiness.get(bid) ?? [];
    list.push(team);
    teamsByBusiness.set(bid, list);
  }

  const since = rolling12MonthCutoff();
  const summaries: BusinessSummary[] = await Promise.all(
    Array.from(teamsByBusiness.entries()).map(([businessId, teamGroup]) =>
      fetchSummary(supabase, businessId, teamGroup, since),
    ),
  );

  const periodLabel = t("stats.period", { date: formatPeriodAsOf(new Date()) });

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
            <BusinessCard
              key={biz.id}
              biz={biz}
              periodLabel={periodLabel}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders one business card. Whole-card link to `/business/[id]`.
 *
 * Layout:
 *   - Header: icon + legal name + entity-type pill + customer count + team count
 *   - Period sub-label: "Last 12 months · as of <date>"
 *   - For admin/owner: 2-up grid (Revenue · Expenses) + Net spanning bottom row
 *   - For member: a quiet "Financial details require admin access" line
 *
 * Net tile uses three encoding channels (color + icon + word) so it
 * passes the redundant-encoding rule and reads cleanly to screen
 * readers ("Profit $12,450" not just "+$12,450").
 */
function BusinessCard({
  biz,
  periodLabel,
  t,
}: {
  biz: BusinessSummary;
  periodLabel: string;
  // i18n function; typed loosely because next-intl's getTranslations
  // returns a complex generic that's painful to thread through.
  t: (key: string, values?: Record<string, string | number>) => string;
}): React.JSX.Element {
  const isAdmin = biz.viewerRole === "owner" || biz.viewerRole === "admin";
  const customersLabel = t("stats.customersWithCount", {
    count: biz.customerCount,
  });

  return (
    <Link
      href={`/business/${biz.id}`}
      aria-label={cardAriaLabel(biz, customersLabel, isAdmin, t)}
      className="rounded-lg border border-edge bg-surface-raised p-5 hover:bg-hover transition-colors space-y-4 block"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent-soft shrink-0"
          aria-hidden="true"
        >
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
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-label font-medium text-content-secondary">
              <Users size={10} aria-hidden="true" />
              {customersLabel}
            </span>
            {biz.teamCount > 1 && (
              <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-label font-medium text-accent-text">
                {t("stats.teamCount", { count: biz.teamCount })}
              </span>
            )}
          </div>
        </div>
        <LinkPendingSpinner size={14} className="" />
      </div>

      {isAdmin ? (
        <FinancialPanel
          biz={biz}
          periodLabel={periodLabel}
          t={t}
        />
      ) : (
        <p
          className="text-caption text-content-muted italic"
          // Members aren't shown the financial figures. We keep the
          // card link target intact (the detail page does its own
          // gating) so a member who wants to look around can still
          // navigate in.
        >
          {t("stats.memberView")}
        </p>
      )}
    </Link>
  );
}

/**
 * The three-tile financial summary, gated to admins/owners.
 *
 * Shape:
 *   ┌──────────────┬──────────────┐
 *   │  Revenue     │  Expenses    │
 *   ├──────────────┴──────────────┤
 *   │  Net (wide, larger type)    │
 *   └─────────────────────────────┘
 *
 * Net is computed only when both Revenue and Expenses are
 * single-currency AND the same currency. Otherwise the Net tile
 * shows "Mixed currencies — open the business to see breakdown."
 * (Per bookkeeper persona: never silently sum across currencies.)
 */
function FinancialPanel({
  biz,
  periodLabel,
  t,
}: {
  biz: BusinessSummary;
  periodLabel: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}): React.JSX.Element {
  const revenueEntries = sortByCurrency(biz.revenueByCurrency);
  const expensesEntries = sortByCurrency(biz.expensesByCurrency);

  const noActivity =
    revenueEntries.length === 0 && expensesEntries.length === 0;

  if (noActivity) {
    return (
      <div className="space-y-2">
        <p className="text-label uppercase tracking-wider text-content-muted">
          {periodLabel}
        </p>
        <p className="text-body text-content-secondary italic">
          {t("stats.noActivity")}
        </p>
      </div>
    );
  }

  const net = netForBusiness(biz.revenueByCurrency, biz.expensesByCurrency);
  const netAmount = net?.amount ?? null;
  const sharedCurrency = net?.currency ?? null;

  return (
    <div className="space-y-2">
      <p className="text-label uppercase tracking-wider text-content-muted">
        {periodLabel}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <FinancialTile
          icon={<TrendingUp size={11} aria-hidden="true" />}
          label={t("stats.revenue")}
          srHint={t("stats.revenueHint")}
          entries={revenueEntries}
        />
        <FinancialTile
          icon={<Receipt size={11} aria-hidden="true" />}
          label={t("stats.expenses")}
          srHint={t("stats.expensesHint")}
          entries={expensesEntries}
        />
      </div>
      <NetTile
        amount={netAmount}
        currency={sharedCurrency}
        srHint={t("stats.netHint")}
        labels={{
          net: t("stats.net"),
          profit: t("stats.netProfit"),
          loss: t("stats.netLoss"),
          breakEven: t("stats.netBreakEven"),
          mixed: t("stats.mixedCurrencies"),
        }}
      />
    </div>
  );
}

/**
 * One financial KPI tile (Revenue or Expenses).
 *
 * `srHint` is rendered as `<span className="sr-only">` rather than
 * a tooltip — the whole card is a `<Link>`, so a tooltip trigger
 * inside it would conflict with the navigation hover state. Sighted
 * users see only the label; screen-reader users hear the cash-basis
 * caveat without an extra trigger.
 */
function FinancialTile({
  icon,
  label,
  srHint,
  entries,
}: {
  icon: React.ReactNode;
  label: string;
  srHint: string;
  entries: Array<[string, number]>;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-edge bg-surface p-2">
      <div className="flex items-center gap-1 text-content-muted mb-0.5">
        {icon}
        <span className="text-label uppercase tracking-wider">
          {label}
          <span className="sr-only"> — {srHint}</span>
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="text-body font-semibold font-mono tabular-nums text-content-muted italic">
          —
        </p>
      ) : (
        <div className="space-y-0.5">
          {entries.map(([code, amt]) => (
            <p
              key={code}
              className="text-body font-semibold font-mono tabular-nums text-content"
            >
              {formatCurrency(amt, code)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Net P/L tile spanning the full width of the financial panel.
 *
 * Renders three encoding channels:
 *   - color (success / danger / muted)
 *   - icon (TrendingUp / TrendingDown / none)
 *   - word ("Profit" / "Loss" / "Break-even")
 *
 * That word matters for screen readers: a bare `+$12,450` is
 * announced as "plus twelve thousand," not as "profit." The visible
 * label drives both readability and accessibility (per the
 * accessibility-auditor review).
 */
function NetTile({
  amount,
  currency,
  srHint,
  labels,
}: {
  amount: number | null;
  currency: string | null;
  srHint: string;
  labels: {
    net: string;
    profit: string;
    loss: string;
    breakEven: string;
    mixed: string;
  };
}): React.JSX.Element {
  if (amount === null || currency === null) {
    return (
      <div className="rounded-md border border-edge bg-surface p-2.5">
        <div className="flex items-center gap-1 text-content-muted mb-0.5">
          <span className="text-label uppercase tracking-wider">
            {labels.net}
          </span>
        </div>
        <p className="text-body text-content-secondary italic">
          {labels.mixed}
        </p>
      </div>
    );
  }

  // Treat values within a half-cent of zero as break-even — avoids a
  // "Loss · -$0.00" footgun from float subtraction.
  const isProfit = amount > 0.005;
  const isLoss = amount < -0.005;
  const word = isProfit
    ? labels.profit
    : isLoss
      ? labels.loss
      : labels.breakEven;
  const color = isProfit
    ? "text-success"
    : isLoss
      ? "text-danger"
      : "text-content-secondary";
  const Icon = isProfit ? TrendingUp : isLoss ? TrendingDown : null;
  const signed = formatSignedCurrency(amount, currency);

  return (
    <div className="rounded-md border border-edge bg-surface p-2.5">
      <div className="flex items-center gap-1 text-content-muted mb-0.5">
        <span className="text-label uppercase tracking-wider">
          {labels.net}
          <span className="sr-only"> — {srHint}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        {Icon && <Icon size={16} className={color} aria-hidden="true" />}
        <span className={`text-title font-semibold ${color}`}>{word}</span>
        <span
          className={`text-title font-semibold font-mono tabular-nums ${color} ml-auto`}
        >
          {signed}
        </span>
      </div>
    </div>
  );
}

/**
 * Build a screen-reader summary for the whole-card link. Concatenates
 * the business name, customer count, and (if visible) the period
 * label so the SR user gets the gist without having to hear every
 * tile read out individually.
 */
function cardAriaLabel(
  biz: BusinessSummary,
  customersLabel: string,
  isAdmin: boolean,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [biz.legalName ?? biz.name, customersLabel];
  if (!isAdmin) parts.push(t("stats.memberView"));
  return parts.join(" · ");
}

async function fetchSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  teams: TeamListItem[],
  sinceIso: string,
): Promise<BusinessSummary> {
  const sortedTeams = [...teams].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const representative = sortedTeams[0]!;
  const teamIds = sortedTeams.map((t) => t.id);

  // Highest role across the viewer's teams in this business.
  // owner > admin > member. Drives whether financial tiles render.
  const viewerRole: Role = maxRole(sortedTeams.map((t) => t.role));

  const [business, customerCount, paidInvoices, expenseRows] =
    await Promise.all([
      supabase
        .from("businesses")
        .select("legal_name, entity_type")
        .eq("id", businessId)
        .maybeSingle(),
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .in("team_id", teamIds)
        .eq("archived", false),
      // Cash basis: only invoices marked paid count toward revenue.
      // Filter on `paid_at` (not `issued_date`) so the period anchor
      // is the cash event, and ignore voided rows defensively even
      // though `status='paid'` should preclude voided.
      viewerRole === "member"
        ? Promise.resolve({ data: [] })
        : supabase
            .from("invoices")
            .select("total, currency")
            .in("team_id", teamIds)
            .eq("status", "paid")
            .is("voided_at", null)
            .gte("paid_at", sinceIso),
      // Exclude billable-to-customer expenses by default — they
      // rebill on the income side and including them double-deflates
      // the net figure.
      viewerRole === "member"
        ? Promise.resolve({ data: [] })
        : supabase
            .from("expenses")
            .select("amount, currency")
            .in("team_id", teamIds)
            .is("deleted_at", null)
            .eq("billable", false)
            .gte("incurred_on", sinceIso.slice(0, 10)),
    ]);

  const revenueByCurrency = groupByCurrency(
    (paidInvoices.data ?? []).map((row) => ({
      amount: row.total as number | string | null,
      currency: row.currency as string | null,
    })),
  );

  const expensesByCurrency = groupByCurrency(
    (expenseRows.data ?? []).map((row) => ({
      amount: row.amount as number | string | null,
      currency: row.currency as string | null,
    })),
  );

  return {
    id: businessId,
    name: representative.name,
    legalName: (business.data?.legal_name as string | null) ?? null,
    entityType: (business.data?.entity_type as string | null) ?? null,
    teamCount: sortedTeams.length,
    customerCount: customerCount.count ?? 0,
    viewerRole,
    revenueByCurrency,
    expensesByCurrency,
  };
}

function formatPeriodAsOf(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
