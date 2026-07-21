"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  Receipt,
  Banknote,
  Clock3,
  Landmark,
  AlertCircle,
} from "lucide-react";
import {
  formatCurrency,
  formatSignedCurrency,
  classifyNet,
  type Period,
} from "../../business-list-helpers";
import { AGING_BUCKETS, type AgingBucket } from "./compute";

type CurrencyAmounts = Array<[string, number]>;

export interface FinancialsData {
  businessId: string;
  period: Period;
  periodLabel: string;
  /** Gross cash received in the period, per currency. */
  collected: CurrencyAmounts;
  /** Income recognized, ex-tax, per currency. */
  revenue: CurrencyAmounts;
  /** Remittable tax collected, per currency. */
  tax: CurrencyAmounts;
  /** All operating expenses in the period, per currency. */
  expenses: CurrencyAmounts;
  /** Net = revenue − expenses, only when single shared currency. */
  net: { currency: string; amount: number } | null;
  arTotal: CurrencyAmounts;
  arAging: Array<{ currency: string; buckets: Record<AgingBucket, number> }>;
  /** Unbilled billable hours not yet invoiced (all-time snapshot). */
  unbilledHours: number;
  /** Latest locked period end (YYYY-MM-DD) or null. */
  lockedThrough: string | null;
}

const REVEAL_KEY = "shyre.financials.reveal";
const PERIODS: Period[] = ["last12", "ytd", "month"];

/**
 * The reveal preference is external (per-device localStorage) state, read
 * via useSyncExternalStore so it's SSR-safe (server + first paint see the
 * blurred default) without a setState-in-effect. Cross-tab `storage`
 * events and local toggles both notify subscribers.
 */
const revealListeners = new Set<() => void>();
function subscribeReveal(callback: () => void): () => void {
  revealListeners.add(callback);
  const onStorage = (e: StorageEvent): void => {
    if (e.key === REVEAL_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    revealListeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}
function readReveal(): boolean {
  try {
    return window.localStorage.getItem(REVEAL_KEY) === "1";
  } catch {
    return false;
  }
}
function writeReveal(next: boolean): void {
  try {
    window.localStorage.setItem(REVEAL_KEY, next ? "1" : "0");
  } catch {
    /* private mode / storage blocked */
  }
  revealListeners.forEach((cb) => cb());
}

/**
 * The masked amount primitive. While hidden the real value is UNMOUNTED —
 * a masked placeholder replaces it in the DOM and a11y tree, so a screen
 * reader never leaks a number the presenter is hiding (the
 * FinancialDisclosure privacy contract, applied per-figure). Module-scope
 * (not defined in render) so it isn't recreated each paint.
 */
function Amount({
  entries,
  revealed,
  hiddenLabel,
  signed = false,
  className = "",
}: {
  entries: CurrencyAmounts;
  revealed: boolean;
  hiddenLabel: string;
  signed?: boolean;
  className?: string;
}): React.JSX.Element {
  if (!revealed) {
    return (
      <span
        className={`font-mono tracking-widest text-content-muted ${className}`}
        aria-label={hiddenLabel}
      >
        ••••
      </span>
    );
  }
  if (entries.length === 0) {
    return <span className={`text-content-muted ${className}`}>—</span>;
  }
  return (
    <span className={className}>
      {entries.map(([code, amt]) => (
        <span key={code} className="font-mono tabular-nums block">
          {signed
            ? formatSignedCurrency(amt, code)
            : formatCurrency(amt, code)}
        </span>
      ))}
    </span>
  );
}

/**
 * The Financials tab body. Server passes plain per-currency data; this
 * client component owns the reveal state (blurred-by-default, remembered
 * per device) and renders the Cash + P&L blocks.
 */
export function FinancialsView({
  data,
}: {
  data: FinancialsData;
}): React.JSX.Element {
  const t = useTranslations("business");
  // Blurred by default on server + first paint (safe for screen-sharing);
  // the stored per-device preference is read on the client.
  const revealed = useSyncExternalStore(
    subscribeReveal,
    readReveal,
    () => false,
  );
  function toggleReveal(): void {
    writeReveal(!revealed);
  }

  const hiddenLabel = t("financials.hidden");
  const netClass = data.net ? classifyNet(data.net.amount) : null;

  return (
    <div className="space-y-6">
      {/* Header: period + basis on the left, reveal toggle on the right */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div
            role="group"
            aria-label={t("stats.periodToggleLabel")}
            className="inline-flex items-center gap-0.5 rounded-md border border-edge bg-surface-raised p-0.5"
          >
            {PERIODS.map((p) => {
              const active = p === data.period;
              const href =
                p === "last12"
                  ? `/business/${data.businessId}/financials`
                  : `/business/${data.businessId}/financials?period=${p}`;
              return (
                <Link
                  key={p}
                  href={href}
                  aria-current={active ? "true" : undefined}
                  className={`px-2.5 py-1 rounded text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised ${
                    active
                      ? "bg-accent text-content-inverse"
                      : "text-content-secondary hover:bg-hover"
                  }`}
                >
                  {t(`stats.periodToggle.${p}`)}
                </Link>
              );
            })}
          </div>
          <p className="text-caption text-content-muted">
            {data.periodLabel} · {t("financials.basis")}
          </p>
        </div>

        <button
          type="button"
          onClick={toggleReveal}
          aria-pressed={revealed}
          className="inline-flex items-center gap-2 rounded-md border border-edge bg-surface-raised px-3 py-1.5 text-body font-medium text-content-secondary hover:bg-hover hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        >
          {revealed ? (
            <EyeOff size={14} aria-hidden="true" />
          ) : (
            <Eye size={14} aria-hidden="true" />
          )}
          {revealed
            ? t("financials.hideAmounts")
            : t("financials.revealAmounts")}
        </button>
      </div>

      {data.lockedThrough && (
        <div className="flex items-center gap-2 rounded-md border border-edge bg-surface-inset px-3 py-2 text-caption text-content-secondary">
          <AlertCircle
            size={14}
            className="shrink-0 text-content-muted"
            aria-hidden="true"
          />
          {t("financials.lockedThrough", { date: data.lockedThrough })}
        </div>
      )}

      {/* Cash block */}
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Banknote size={16} className="text-accent" aria-hidden="true" />
          <h2 className="text-body-lg font-semibold text-content">
            {t("financials.cashHeading")}
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile
            icon={<Banknote size={12} aria-hidden="true" />}
            label={t("financials.collected")}
            hint={t("financials.collectedHint")}
          >
            <Amount
              entries={data.collected}
              revealed={revealed}
              hiddenLabel={hiddenLabel}
              className="text-title"
            />
          </Tile>
          <Tile
            icon={<AlertCircle size={12} aria-hidden="true" />}
            label={t("financials.outstanding")}
            hint={t("financials.outstandingHint")}
          >
            <Amount
              entries={data.arTotal}
              revealed={revealed}
              hiddenLabel={hiddenLabel}
              className="text-title"
            />
          </Tile>
          <Tile
            icon={<Clock3 size={12} aria-hidden="true" />}
            label={t("financials.unbilled")}
            hint={t("financials.unbilledHint")}
          >
            <span className="text-title font-mono tabular-nums text-content">
              {t("financials.hours", { hours: data.unbilledHours })}
            </span>
          </Tile>
        </div>

        {data.arAging.length > 0 && (
          <div className="pt-1 space-y-2">
            <p className="text-label uppercase tracking-wider text-content-muted">
              {t("financials.aging")}
            </p>
            {data.arAging.map((row) => (
              <div key={row.currency} className="space-y-1">
                {data.arAging.length > 1 && (
                  <p className="text-caption font-medium text-content-secondary">
                    {row.currency}
                  </p>
                )}
                <div className="grid grid-cols-5 gap-1">
                  {AGING_BUCKETS.map((bucket) => (
                    <div
                      key={bucket}
                      className="rounded border border-edge bg-surface p-1.5 text-center"
                    >
                      <p className="text-label uppercase tracking-wider text-content-muted">
                        {t(`financials.agingBuckets.${bucket}`)}
                      </p>
                      <Amount
                        entries={[[row.currency, row.buckets[bucket]]]}
                        revealed={revealed}
                        hiddenLabel={hiddenLabel}
                        className="text-caption"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* P&L block */}
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-accent" aria-hidden="true" />
          <h2 className="text-body-lg font-semibold text-content">
            {t("financials.plHeading")}
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile
            icon={<TrendingUp size={12} aria-hidden="true" />}
            label={t("financials.revenue")}
            hint={t("financials.revenueHint")}
          >
            <Amount
              entries={data.revenue}
              revealed={revealed}
              hiddenLabel={hiddenLabel}
              className="text-title"
            />
          </Tile>
          <Tile
            icon={<Receipt size={12} aria-hidden="true" />}
            label={t("financials.expenses")}
            hint={t("financials.expensesHint")}
          >
            <Amount
              entries={data.expenses}
              revealed={revealed}
              hiddenLabel={hiddenLabel}
              className="text-title"
            />
          </Tile>
        </div>

        {/* Net — three channels (color + icon + word) */}
        {data.net === null || netClass === null ? (
          <div className="rounded-md border border-edge bg-surface p-3">
            <p className="text-label uppercase tracking-wider text-content-muted">
              {t("financials.net")}
            </p>
            <p className="text-body text-content-secondary italic">
              {t("financials.mixedCurrencies")}
            </p>
          </div>
        ) : (
          <NetRow
            amount={data.net.amount}
            currency={data.net.currency}
            revealed={revealed}
            netClass={netClass}
            labels={{
              net: t("financials.net"),
              profit: t("financials.netProfit"),
              loss: t("financials.netLoss"),
              breakEven: t("financials.netBreakEven"),
              hidden: hiddenLabel,
            }}
          />
        )}

        {/* Tax collected — remittable liability, kept out of Net */}
        <div className="flex items-center justify-between gap-3 rounded-md border border-edge bg-surface px-3 py-2">
          <div className="flex items-center gap-1.5 text-content-muted">
            <Landmark size={12} aria-hidden="true" />
            <span className="text-label uppercase tracking-wider">
              {t("financials.taxCollected")}
              <span className="sr-only">
                {" "}
                — {t("financials.taxCollectedHint")}
              </span>
            </span>
          </div>
          <Amount
            entries={data.tax}
            revealed={revealed}
            hiddenLabel={hiddenLabel}
            className="text-body text-right"
          />
        </div>
      </section>
    </div>
  );
}

function Tile({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-edge bg-surface p-3">
      <div className="flex items-center gap-1.5 text-content-muted mb-1">
        {icon}
        <span className="text-label uppercase tracking-wider">
          {label}
          <span className="sr-only"> — {hint}</span>
        </span>
      </div>
      <div className="font-semibold text-content">{children}</div>
    </div>
  );
}

function NetRow({
  amount,
  currency,
  revealed,
  netClass,
  labels,
}: {
  amount: number;
  currency: string;
  revealed: boolean;
  netClass: "profit" | "loss" | "breakEven";
  labels: {
    net: string;
    profit: string;
    loss: string;
    breakEven: string;
    hidden: string;
  };
}): React.JSX.Element {
  const word =
    netClass === "profit"
      ? labels.profit
      : netClass === "loss"
        ? labels.loss
        : labels.breakEven;
  const color =
    netClass === "profit"
      ? "text-success-text"
      : netClass === "loss"
        ? "text-error-text"
        : "text-content-secondary";
  const Icon =
    netClass === "profit"
      ? TrendingUp
      : netClass === "loss"
        ? TrendingDown
        : null;

  return (
    <div className="rounded-md border border-edge bg-surface p-3">
      <p className="text-label uppercase tracking-wider text-content-muted mb-1">
        {labels.net}
      </p>
      <div className="flex items-center gap-2">
        {Icon && <Icon size={18} className={color} aria-hidden="true" />}
        <span className={`text-title font-semibold ${color}`}>{word}</span>
        <span
          className={`text-title font-semibold font-mono tabular-nums ml-auto ${color}`}
        >
          {revealed ? (
            formatSignedCurrency(amount, currency)
          ) : (
            <span
              className="tracking-widest text-content-muted"
              aria-label={labels.hidden}
            >
              ••••
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
