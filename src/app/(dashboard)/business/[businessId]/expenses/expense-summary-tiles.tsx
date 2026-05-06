import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  CalendarDays,
  CalendarRange,
  TrendingUp,
} from "lucide-react";
import { formatCurrency } from "@/lib/invoice-utils";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import {
  buildExpenseFilterParams,
  type ExpenseFilters,
} from "./filter-params";

export interface PeriodTotal {
  /** "ytd" | "month" | "lastMonth" | "quarter" — also used as the
   *  React key + drives the icon selection. */
  key: "ytd" | "month" | "lastMonth" | "quarter";
  /** Per-currency totals. Each entry: ISO 4217 code → amount.
   *  Multi-currency totals stack vertically inside the tile. */
  totalsByCurrency: Map<string, number>;
  /** ISO YYYY-MM-DD lower bound the tile applies as a filter. */
  from: string;
  /** ISO YYYY-MM-DD upper bound (inclusive) the tile applies as a
   *  filter. */
  to: string;
}

interface Props {
  /** Resolved totals for the four periods. Order matters for the
   *  layout (Year-to-date first, current then trailing). */
  periods: PeriodTotal[];
  /** Currently-active filters — drives the "selected tile"
   *  treatment when one of the period ranges matches. Only an
   *  exact (from, to) match counts as active so partial ranges
   *  don't show two tiles highlighted. */
  filters: ExpenseFilters;
  /** /business/[businessId] base path the tile links target. */
  basePath: string;
}

/**
 * KPI strip rendered above the New expense form on /expenses.
 * Replaces the single "This month · $0.00" chip that was the only
 * summary affordance previously. Each tile is a clickable filter
 * — clicking applies the corresponding date range — so the tile
 * doubles as a "where am I scoped" indicator.
 *
 * Server component on purpose: the totals are derived from a
 * server-side aggregate, the link hrefs are static once the
 * filters are known, and there's no internal state.
 */
export function ExpenseSummaryTiles({
  periods,
  filters,
  basePath,
}: Props): React.JSX.Element {
  const t = useTranslations("expenses.summary");

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {periods.map((p) => (
        <Tile
          key={p.key}
          label={t(`labels.${p.key}`)}
          icon={iconFor(p.key)}
          totalsByCurrency={p.totalsByCurrency}
          href={hrefFor(filters, p.from, p.to, basePath)}
          active={
            filters.from === p.from &&
            filters.to === p.to
          }
          emptyLabel={t("empty")}
        />
      ))}
    </div>
  );
}

function iconFor(key: PeriodTotal["key"]): React.ReactNode {
  if (key === "ytd")
    return <TrendingUp size={14} className="text-content-muted" aria-hidden="true" />;
  if (key === "quarter")
    return <CalendarRange size={14} className="text-content-muted" aria-hidden="true" />;
  return <CalendarDays size={14} className="text-content-muted" aria-hidden="true" />;
}

/**
 * Build the URL the tile links to. Preserves the user's current
 * `q` / `project` / `billable` / `categories` filters and only
 * overrides the date range. Clicking a tile when its range is
 * already active toggles the filter back off (clears `from` /
 * `to`) so the user has a one-click way out.
 */
function hrefFor(
  filters: ExpenseFilters,
  from: string,
  to: string,
  basePath: string,
): string {
  const next: ExpenseFilters = { ...filters };
  if (filters.from === from && filters.to === to) {
    next.from = null;
    next.to = null;
  } else {
    next.from = from;
    next.to = to;
  }
  const params = buildExpenseFilterParams(next);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function Tile({
  label,
  icon,
  totalsByCurrency,
  href,
  active,
  emptyLabel,
}: {
  label: string;
  icon: React.ReactNode;
  totalsByCurrency: Map<string, number>;
  href: string;
  active: boolean;
  emptyLabel: string;
}): React.JSX.Element {
  const entries = Array.from(totalsByCurrency.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  return (
    <Link
      href={href}
      className={`group rounded-lg border p-3 transition-colors block ${
        active
          ? "border-accent ring-1 ring-accent/30 bg-accent-soft/30"
          : "border-edge bg-surface-raised hover:border-edge-strong hover:bg-hover"
      }`}
      aria-pressed={active}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-label uppercase tracking-wider text-content-muted">
          {label}
        </span>
        <LinkPendingSpinner size={10} className="ml-auto" />
      </div>
      {entries.length === 0 ? (
        <p className="mt-1 text-title font-semibold text-content-muted tabular-nums italic">
          {emptyLabel}
        </p>
      ) : (
        <div className="mt-1 space-y-0.5">
          {entries.map(([code, amt]) => (
            <p
              key={code}
              className="text-title font-semibold text-content tabular-nums font-mono"
            >
              {formatCurrency(Math.round(amt * 100) / 100, code)}
            </p>
          ))}
        </div>
      )}
    </Link>
  );
}
