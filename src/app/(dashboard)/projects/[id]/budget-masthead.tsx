"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarClock, Target, X } from "lucide-react";
import type { BudgetPeriod } from "@/lib/projects/budget-period";

export interface BudgetMastheadProps {
  projectId: string;
  /** Hours total across the project's lifetime, regardless of period.
   *  Used by the lifetime bar (always shown). */
  lifetimeMinutes: number;
  /** Lifetime cap in hours. Null when no overall budget set. */
  lifetimeBudgetHours: number | null;
  /** Effective hourly rate used for the lifetime dollar caption.
   *  Null when no rate (caption then renders hours only). */
  lifetimeRate: number | null;
  /** Lifetime dollar cap. Null when no dollar cap on lifetime
   *  (today there's only an hours lifetime cap, but the structure
   *  matches the period bar for layout consistency). */
  lifetimeBudgetDollars: number | null;
  /** Period config + computed burn. Null when the project has no
   *  recurring period — the period bar is hidden. */
  period: {
    type: BudgetPeriod;
    /** Local YYYY-MM-DD (start of current period in user's TZ). */
    startLocal: string;
    /** Local YYYY-MM-DD (start of next period — exclusive end). */
    endLocal: string;
    minutes: number;
    capHours: number | null;
    capDollars: number | null;
    /** Effective rate for converting hours to dollars when a dollar
     *  cap is set. */
    rate: number | null;
    /** Threshold % at which the alert fires. Null when alerts off. */
    alertThresholdPct: number | null;
    /** True when current burn meets/exceeds alertThresholdPct (on
     *  either hours or dollars). Computed server-side. */
    alertActive: boolean;
    /** Optional last-period burn for the "last period: 28h/30h"
     *  caption — null when there's no prior period worth showing
     *  (e.g. this is the first month after the project was created). */
    previousMinutes: number | null;
  } | null;
}

/**
 * Stacked masthead block on the project detail page. Two bars,
 * period-first + lifetime, each with icon + label + numeric +
 * colored fill. Color anchors at fixed 80%/100% (not the
 * user-configurable threshold, per UX-designer review) so a green
 * bar always means "comfortably under" across every project.
 *
 * Banner above when `alertActive` is true; dismissable per period
 * crossing via localStorage. Solo-consultant + agency-owner agreed
 * fire-once-per-crossing > sticky-every-page-load.
 *
 * Fully hidden when neither lifetime nor period caps are set —
 * keeps the masthead off projects with no budget configured.
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
  // A project without any cap shouldn't take up vertical space here.
  if (!period && lifetimeBudgetHours == null) {
    return null;
  }

  // Dismissal key encodes (project, period_start) so a new period
  // re-opens the banner. The Banner component is keyed on this so
  // a period rollover remounts the component, and localStorage is
  // re-read fresh via the useState lazy initializer (no effect, no
  // setState-in-effect lint friction).
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

      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        {period && (
          <BudgetBar
            icon={<CalendarClock size={14} />}
            label={t(`periodLabel.${period.type}`)}
            minutes={period.minutes}
            capHours={period.capHours}
            capDollars={period.capDollars}
            rate={period.rate}
            thresholdPct={period.alertThresholdPct}
            previousMinutes={period.previousMinutes}
            previousLabel={t("lastPeriod")}
            ariaLabelKey="periodBurnAria"
          />
        )}
        <BudgetBar
          icon={<Target size={14} />}
          label={t("lifetimeLabel")}
          minutes={lifetimeMinutes}
          capHours={lifetimeBudgetHours}
          capDollars={lifetimeBudgetDollars}
          rate={lifetimeRate}
          thresholdPct={null}
          previousMinutes={null}
          previousLabel={null}
          ariaLabelKey="lifetimeBurnAria"
        />
      </div>
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
      // localStorage unavailable (private mode) — fall through and
      // accept that the banner reappears on next load.
    }
    setDismissed(true);
  }

  const pct = period.capHours
    ? Math.round((period.minutes / 60 / period.capHours) * 100)
    : 0;
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

interface BarProps {
  icon: React.ReactNode;
  label: string;
  minutes: number;
  capHours: number | null;
  capDollars: number | null;
  rate: number | null;
  /** When set, draws a tick mark at this % on the bar so the user's
   *  custom threshold remains visible without remapping the color. */
  thresholdPct: number | null;
  previousMinutes: number | null;
  /** Translation prefix for the "Last period" caption. Null hides. */
  previousLabel: string | null;
  ariaLabelKey: "periodBurnAria" | "lifetimeBurnAria";
}

function BudgetBar({
  icon,
  label,
  minutes,
  capHours,
  capDollars,
  rate,
  thresholdPct,
  previousMinutes,
  previousLabel,
  ariaLabelKey,
}: BarProps): React.JSX.Element {
  const t = useTranslations("projects.budget");
  const hours = minutes / 60;
  const pct = capHours && capHours > 0 ? (hours / capHours) * 100 : null;
  const fillPct = pct === null ? null : Math.min(100, pct);
  const dollars = rate ? hours * rate : null;
  const dollarPct =
    capDollars && capDollars > 0 && dollars != null
      ? (dollars / capDollars) * 100
      : null;

  // Color anchored at fixed 80/100 — never tied to the user's
  // threshold (UX-designer review).
  const colorClass =
    pct === null
      ? "bg-accent"
      : pct >= 100
        ? "bg-error"
        : pct >= 80
          ? "bg-warning"
          : "bg-accent";

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-content-muted shrink-0">{icon}</span>
        <span className="text-label uppercase tracking-wider text-content-muted">
          {label}
        </span>
        <span className="ml-auto font-mono tabular-nums text-content">
          {capHours != null
            ? t("hoursOfCap", {
                used: hours.toFixed(1),
                cap: capHours.toFixed(1),
              })
            : t("hoursOnly", { used: hours.toFixed(1) })}
        </span>
      </div>
      {capDollars != null && dollars != null && (
        <p className="mt-0.5 text-caption text-content-muted text-right font-mono tabular-nums">
          {t("dollarsOfCap", {
            used: dollars.toFixed(2),
            cap: capDollars.toFixed(2),
          })}
        </p>
      )}
      {fillPct !== null && (
        <div className="mt-1.5 relative">
          <div
            className="h-1.5 rounded-full bg-edge overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(pct ?? 0)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t(ariaLabelKey, {
              pct: Math.round(pct ?? 0),
            })}
          >
            <div
              className={`h-1.5 ${colorClass}`}
              style={{ width: `${fillPct}%` }}
            />
          </div>
          {thresholdPct !== null && thresholdPct > 0 && thresholdPct < 100 && (
            // Threshold tick — the "color stays anchored at 80/100,
            // user threshold renders as a separate channel" pattern
            // from the UX review.
            <div
              className="absolute top-0 h-1.5 w-0.5 bg-content-muted"
              style={{ left: `${thresholdPct}%` }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
      {previousMinutes !== null && previousLabel && (
        <p className="mt-1 text-caption text-content-muted">
          {previousLabel}: {(previousMinutes / 60).toFixed(1)}h
          {dollarPct !== null && Math.round(dollarPct) !== Math.round(pct ?? 0) && (
            <span className="ml-2">
              {t("dollarBurnNote", { pct: Math.round(dollarPct) })}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
