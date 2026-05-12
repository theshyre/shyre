"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarClock, Target, X } from "lucide-react";
import type { BudgetPeriod } from "@/lib/projects/budget-period";

export interface BudgetMastheadProps {
  projectId: string;
  /** Hours total across the project's lifetime, regardless of period.
   *  Used by the lifetime row (always shown). */
  lifetimeMinutes: number;
  /** Lifetime cap in hours. Null when no overall budget set —
   *  lifetime row still renders but as plain "logged" text without
   *  a bar (no cap means no progress to show). */
  lifetimeBudgetHours: number | null;
  /** Effective hourly rate for converting lifetime hours to a
   *  dollar caption. Null = caption omitted. */
  lifetimeRate: number | null;
  /** Lifetime dollar cap. Today there's no UI to set this; reserved
   *  so future "lifetime $X" caps land without a layout change. */
  lifetimeBudgetDollars: number | null;
  /** Period config + computed burn. Null when the project has no
   *  recurring period configured. */
  period: {
    type: BudgetPeriod;
    /** Local YYYY-MM-DD (start of current period in user's TZ). */
    startLocal: string;
    /** Local YYYY-MM-DD (start of next period — exclusive end). */
    endLocal: string;
    minutes: number;
    capHours: number | null;
    capDollars: number | null;
    /** Effective rate for converting hours to dollars. */
    rate: number | null;
    /** Threshold % at which the alert fires. Null when alerts off. */
    alertThresholdPct: number | null;
    alertActive: boolean;
    /** Optional last-period burn in minutes. */
    previousMinutes: number | null;
  } | null;
}

/**
 * Project budget summary at the top of the project detail page.
 *
 * Layout: a single bordered card containing two stacked rows
 * (period above, lifetime below) separated by a thin divider.
 * Each row is a self-contained block with its own hierarchy:
 *
 *     [icon] LABEL
 *     <hero number>          <cap>            <pct%>
 *     ████████░░░░░░░░░░░░░░░░░░░░░░░░░░  (visible bar)
 *     <secondary caption — dollars / "no cap" / etc>
 *     <last period sub-line>  (period row only)
 *
 * Color on the bar anchors at fixed 80%/100% breakpoints (NOT the
 * user threshold) so green always means the same thing across
 * projects. The user's threshold renders as a tick mark on the bar
 * — separate channel for that signal.
 *
 * Hidden entirely when neither a recurring period nor a lifetime
 * cap is set (project carries no budget signal worth surfacing).
 *
 * The banner above fires when alertActive is true; dismissable per
 * (project, period_start) via localStorage v1.
 */
export function BudgetMasthead({
  projectId,
  lifetimeMinutes,
  lifetimeBudgetHours,
  lifetimeRate,
  lifetimeBudgetDollars,
  period,
}: BudgetMastheadProps): React.JSX.Element | null {
  const t = useTranslations("projects.budget");

  // Hide the entire masthead when there's no budget signal to show.
  if (!period && lifetimeBudgetHours == null) {
    return null;
  }

  const dismissalKey = period
    ? `shyre:budget-alert-dismissed:${projectId}:${period.type}:${period.startLocal}`
    : null;

  return (
    <div className="space-y-3">
      {period && period.alertActive && dismissalKey && (
        <DismissibleAlert
          key={dismissalKey}
          dismissalKey={dismissalKey}
          period={period}
          translateAlertBody={(pct, threshold, periodLabel) =>
            t("alert.body", { pct, threshold, periodLabel })
          }
          alertTitle={t("alert.title")}
          dismissLabel={t("alert.dismiss")}
          periodLabel={t(`periodLabel.${period.type}`)}
        />
      )}

      <div className="rounded-lg border border-edge bg-surface-raised divide-y divide-edge-muted">
        {period && (
          <BudgetRow
            icon={<CalendarClock size={14} aria-hidden="true" />}
            label={t(`periodLabel.${period.type}`)}
            minutes={period.minutes}
            capHours={period.capHours}
            capDollars={period.capDollars}
            rate={period.rate}
            thresholdPct={period.alertThresholdPct}
            previousMinutes={period.previousMinutes}
            previousLabel={t("lastPeriod")}
            hoursOnlyLabel={t("hoursOnlyLabel")}
            ariaLabelKey="periodBurnAria"
          />
        )}
        <BudgetRow
          icon={<Target size={14} aria-hidden="true" />}
          label={t("lifetimeLabel")}
          minutes={lifetimeMinutes}
          capHours={lifetimeBudgetHours}
          capDollars={lifetimeBudgetDollars}
          rate={lifetimeRate}
          thresholdPct={null}
          previousMinutes={null}
          previousLabel={null}
          hoursOnlyLabel={t("hoursOnlyLabel")}
          ariaLabelKey="lifetimeBurnAria"
        />
      </div>
    </div>
  );
}

interface RowProps {
  icon: React.ReactNode;
  label: string;
  minutes: number;
  capHours: number | null;
  capDollars: number | null;
  rate: number | null;
  /** When non-null, draws a tick mark at this % on the bar so the
   *  user's custom threshold is visible without remapping the
   *  color (which is anchored at fixed 80/100 breakpoints). */
  thresholdPct: number | null;
  previousMinutes: number | null;
  previousLabel: string | null;
  /** Translation for the "no cap set" caption when neither hours
   *  nor dollar cap exists on this row. */
  hoursOnlyLabel: string;
  ariaLabelKey: "periodBurnAria" | "lifetimeBurnAria";
}

function BudgetRow({
  icon,
  label,
  minutes,
  capHours,
  capDollars,
  rate,
  thresholdPct,
  previousMinutes,
  previousLabel,
  hoursOnlyLabel,
  ariaLabelKey,
}: RowProps): React.JSX.Element {
  const t = useTranslations("projects.budget");
  const hours = minutes / 60;
  const dollars = rate != null && rate > 0 ? hours * rate : null;

  // Compute the bar's burn % from whichever cap is set. Hours cap
  // wins when both are set (it's the more concrete number for a
  // burn bar). Falls back to dollar cap when hours is null.
  // Returns null when neither is set — bar then doesn't render.
  let pctForBar: number | null = null;
  if (capHours != null && capHours > 0) {
    pctForBar = (hours / capHours) * 100;
  } else if (capDollars != null && capDollars > 0 && dollars != null) {
    pctForBar = (dollars / capDollars) * 100;
  }
  const fillPct =
    pctForBar === null ? null : Math.min(100, pctForBar);
  const displayPct = pctForBar === null ? null : Math.round(pctForBar);

  // Color anchored at fixed 80/100 breakpoints — same rule across
  // every project so green/yellow/red read consistently.
  const colorClass =
    pctForBar === null
      ? "bg-accent"
      : pctForBar >= 100
        ? "bg-error"
        : pctForBar >= 80
          ? "bg-warning"
          : "bg-accent";
  const pctTextClass =
    pctForBar === null
      ? "text-content-muted"
      : pctForBar >= 100
        ? "text-error"
        : pctForBar >= 80
          ? "text-warning"
          : "text-content";

  // Cap caption sits at the right of the hero line ("of 30h",
  // "of $2,500", or both when both caps are set).
  const capCaption: string | null = (() => {
    if (capHours != null && capDollars != null && dollars != null) {
      return t("capBoth", {
        hours: capHours.toFixed(1),
        dollars: capDollars.toFixed(0),
      });
    }
    if (capHours != null) {
      return t("capHours", { cap: capHours.toFixed(1) });
    }
    if (capDollars != null) {
      return t("capDollars", { cap: capDollars.toFixed(0) });
    }
    return null;
  })();

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 text-content-muted">
        {icon}
        <h3 className="text-label uppercase tracking-wider">{label}</h3>
      </div>

      <div className="mt-1.5 flex items-baseline gap-3 flex-wrap">
        <span className="font-mono text-title font-semibold tabular-nums text-content">
          {hours.toFixed(1)}h
        </span>
        {capCaption && (
          <span className="font-mono text-body text-content-muted tabular-nums">
            {capCaption}
          </span>
        )}
        {displayPct != null && (
          <span
            className={`ml-auto font-mono text-body-lg font-semibold tabular-nums ${pctTextClass}`}
          >
            {displayPct}%
          </span>
        )}
      </div>

      {fillPct !== null && (
        <div className="mt-2 relative">
          <div
            className="h-2 rounded-full bg-edge overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(pctForBar ?? 0)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t(ariaLabelKey, {
              pct: Math.round(pctForBar ?? 0),
            })}
          >
            <div
              className={`h-2 rounded-full transition-all ${colorClass}`}
              style={{ width: `${fillPct}%` }}
            />
          </div>
          {thresholdPct !== null &&
            thresholdPct > 0 &&
            thresholdPct < 100 && (
              <div
                className="absolute top-0 h-2 w-0.5 bg-content"
                style={{ left: `${thresholdPct}%` }}
                aria-hidden="true"
              />
            )}
        </div>
      )}

      {/* Caption row beneath the bar — surfaces the secondary
          metric (dollars when hours is the primary, or "no cap"
          when neither). */}
      {capCaption == null ? (
        <p className="mt-2 text-caption text-content-muted italic">
          {hoursOnlyLabel}
        </p>
      ) : capDollars != null && dollars != null ? (
        <>
          <p className="mt-2 text-caption text-content-muted font-mono tabular-nums">
            {t("dollarCaption", {
              used: dollars.toFixed(2),
              cap: capDollars.toFixed(2),
            })}
          </p>
          {rate != null && rate > 0 && (
            <p className="mt-0.5 text-caption text-content-muted italic">
              {t("dollarsDerivedFromRate", {
                rate: `$${rate.toFixed(2)}`,
              })}
            </p>
          )}
        </>
      ) : null}

      {previousMinutes !== null && previousLabel && (
        <p className="mt-1 text-caption text-content-muted">
          {previousLabel}:{" "}
          <span className="font-mono tabular-nums">
            {(previousMinutes / 60).toFixed(1)}h
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Banner with localStorage-backed dismissal. Keyed on dismissalKey
 * by the parent so a period rollover remounts the component — the
 * useState lazy initializer reads localStorage cleanly without an
 * effect (which the set-state-in-effect lint rule blocks). Once
 * mounted, dismissal is purely client-state via setDismissed.
 */
function DismissibleAlert({
  dismissalKey,
  period,
  translateAlertBody,
  alertTitle,
  dismissLabel,
  periodLabel,
}: {
  dismissalKey: string;
  period: NonNullable<BudgetMastheadProps["period"]>;
  translateAlertBody: (
    pct: number,
    threshold: number,
    periodLabel: string,
  ) => string;
  alertTitle: string;
  dismissLabel: string;
  periodLabel: string;
}): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(dismissalKey) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  function dismiss(): void {
    try {
      window.localStorage.setItem(dismissalKey, "1");
    } catch {
      // localStorage unavailable — banner reappears on next load.
    }
    setDismissed(true);
  }

  // Pick the burn % that drives the alert — same precedence as the
  // bar (hours cap first, then dollars).
  let pct = 0;
  const hours = period.minutes / 60;
  if (period.capHours && period.capHours > 0) {
    pct = Math.round((hours / period.capHours) * 100);
  } else if (
    period.capDollars &&
    period.capDollars > 0 &&
    period.rate &&
    period.rate > 0
  ) {
    pct = Math.round(((hours * period.rate) / period.capDollars) * 100);
  }

  return (
    <div
      role="status"
      className="rounded-md border border-warning/40 bg-warning-soft/50 p-3 flex items-start gap-2"
    >
      <AlertTriangle
        size={16}
        className="text-warning shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 text-caption text-content-secondary">
        <strong className="text-content">{alertTitle}</strong>{" "}
        {translateAlertBody(pct, period.alertThresholdPct ?? 0, periodLabel)}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={dismissLabel}
        className="shrink-0 rounded p-1 text-content-muted hover:bg-hover transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
