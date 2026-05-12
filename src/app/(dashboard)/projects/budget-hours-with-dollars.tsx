"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { inputClass, labelClass } from "@/lib/form-styles";

/**
 * Paired-input helper for project lifetime budget.
 *
 * Marcus's mental model: "Client agreed to $20k at $135/hr → that's
 * ~148 hours." Typing dollars and seeing hours fall out is the
 * dominant entry path; typing hours directly is the secondary path
 * (sub-projects carving out a chunk of a parent's known total).
 *
 * Persistence: `budget_hours` is the persisted column. The dollar
 * value is a *derived display* — not stored independently in Phase 1
 * (see roadmap / 2026-05-12 persona-converged design). When the
 * project's hourly_rate changes later, the displayed dollar budget
 * silently re-binds at the new rate. The caption admits this so the
 * change isn't hidden. Phase 2 may add a `budget_dollars` column to
 * lock the dollar intent.
 *
 * Internal projects (no rate by definition) hide the dollar side
 * entirely and behave like a plain hours input.
 *
 * Submit shape: a hidden `<input name="budget_hours">` carries the
 * hours value to the server action. The dollar field is for display
 * only and does NOT submit a value.
 */
interface Props {
  /** DOM-id prefix so the new-project and edit-project mounts don't
   *  collide on the same page. */
  idPrefix: string;
  /** Initial hours value as a string ("" for empty). */
  defaultHours?: string;
  /** Effective hourly rate (string from the rate input above). When
   *  empty / zero / non-numeric, the dollar side hides. */
  hourlyRate: string;
  /** Internal projects have no rate by design — hide the dollar
   *  side regardless of `hourlyRate` to avoid a $0 phantom. */
  isInternal: boolean;
}

const HOURS_STEP = 0.5;
const DOLLARS_STEP = 0.01;

function parseNonNegativeNumber(raw: string): number | null {
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}

export function BudgetHoursWithDollars({
  idPrefix,
  defaultHours = "",
  hourlyRate,
  isInternal,
}: Props): React.JSX.Element {
  const t = useTranslations("projects.fields");
  const tHelper = useTranslations("projects.budgetHelper");
  const [hours, setHours] = useState<string>(defaultHours);
  const [dollars, setDollars] = useState<string>("");
  // Track which input the user last typed in. We only auto-fill the
  // OTHER one on rate change so we never overwrite a value the user is
  // actively editing.
  const lastEditedRef = useRef<"hours" | "dollars" | null>(null);

  const rate = parseNonNegativeNumber(hourlyRate);
  const dollarSideEnabled = !isInternal && rate != null && rate > 0;

  // Initialize the dollar field from defaultHours on mount when the
  // rate is known. Sets up the "I'm editing an existing project that
  // has 60h saved" case so the user sees "$8,100 at $135/hr" right
  // away.
  useEffect(() => {
    if (!dollarSideEnabled) return;
    if (lastEditedRef.current === null) {
      const h = parseNonNegativeNumber(hours);
      if (h != null && rate != null && rate > 0) {
        setDollars(formatDollars(h * rate));
      }
    }
    // We intentionally do NOT depend on `rate` here — that's handled
    // by the next effect. This effect is mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the rate changes after either side has been touched,
  // recompute the OTHER side from the last-edited one so the visible
  // numbers stay coherent. Truth is: whatever the user last typed.
  // - Last typed hours → keep hours, recompute dollars at new rate.
  // - Last typed dollars → keep dollars (the intent), recompute hours.
  useEffect(() => {
    if (!dollarSideEnabled || rate == null) return;
    if (lastEditedRef.current === "hours") {
      const h = parseNonNegativeNumber(hours);
      setDollars(h != null ? formatDollars(h * rate) : "");
    } else if (lastEditedRef.current === "dollars") {
      const d = parseNonNegativeNumber(dollars);
      setHours(d != null ? formatHours(d / rate) : "");
    } else {
      // Neither side has been touched yet (e.g., user just toggled
      // is_internal off after the rate appeared) — re-derive dollars
      // from the stored hours so the field populates.
      const h = parseNonNegativeNumber(hours);
      if (h != null) setDollars(formatDollars(h * rate));
    }
  }, [hourlyRate, dollarSideEnabled, rate, hours, dollars]);

  const handleHoursChange = (raw: string): void => {
    lastEditedRef.current = "hours";
    setHours(raw);
    if (dollarSideEnabled && rate != null) {
      const h = parseNonNegativeNumber(raw);
      setDollars(h != null ? formatDollars(h * rate) : "");
    }
  };

  const handleDollarsChange = (raw: string): void => {
    lastEditedRef.current = "dollars";
    setDollars(raw);
    if (dollarSideEnabled && rate != null && rate > 0) {
      const d = parseNonNegativeNumber(raw);
      setHours(d != null ? formatHours(d / rate) : "");
    }
  };

  const rateCaption = useMemo(() => {
    if (!dollarSideEnabled || rate == null) return null;
    return tHelper("atRate", { rate: formatDollars(rate) });
  }, [dollarSideEnabled, rate, tHelper]);

  // Internal-project case: render only the hours input. No paired
  // dollar field, no rate caption — the helper has nothing to add.
  if (isInternal) {
    return (
      <div>
        <label htmlFor={`${idPrefix}-budget-hours`} className={labelClass}>
          {t("budgetHours")}
        </label>
        <input
          id={`${idPrefix}-budget-hours`}
          name="budget_hours"
          type="number"
          step={HOURS_STEP}
          min="0"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-caption text-content-muted">
          {tHelper("internalHint")}
        </p>
      </div>
    );
  }

  // Rate-not-set case: hours input only, dollar field disabled with
  // an explanatory caption pointing at the rate field above.
  if (!dollarSideEnabled) {
    return (
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-budget-hours`} className={labelClass}>
          {t("budgetHours")}
        </label>
        <input
          id={`${idPrefix}-budget-hours`}
          name="budget_hours"
          type="number"
          step={HOURS_STEP}
          min="0"
          value={hours}
          onChange={(e) => handleHoursChange(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-caption text-content-muted">
          {tHelper("noRateHint")}
        </p>
      </div>
    );
  }

  // Paired input layout: hours on the left, dollars on the right,
  // sharing a single label group so the relationship reads as one
  // affordance, not two separate fields.
  return (
    <div className="sm:col-span-2">
      <label htmlFor={`${idPrefix}-budget-hours`} className={labelClass}>
        {t("budgetHours")}
      </label>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center">
        <input
          id={`${idPrefix}-budget-hours`}
          name="budget_hours"
          type="number"
          step={HOURS_STEP}
          min="0"
          value={hours}
          onChange={(e) => handleHoursChange(e.target.value)}
          placeholder={tHelper("hoursPlaceholder")}
          className={inputClass}
          aria-describedby={`${idPrefix}-budget-hours-caption`}
        />
        <span
          aria-hidden="true"
          className="text-content-muted text-body select-none px-1"
        >
          ≈
        </span>
        <div>
          <label
            htmlFor={`${idPrefix}-budget-dollars`}
            className="sr-only"
          >
            {tHelper("dollarsLabel")}
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-3 flex items-center text-content-muted text-body"
            >
              $
            </span>
            <input
              id={`${idPrefix}-budget-dollars`}
              type="number"
              step={DOLLARS_STEP}
              min="0"
              value={dollars}
              onChange={(e) => handleDollarsChange(e.target.value)}
              placeholder={tHelper("dollarsPlaceholder")}
              className={`${inputClass} pl-7 font-mono tabular-nums`}
            />
          </div>
        </div>
      </div>
      <p
        id={`${idPrefix}-budget-hours-caption`}
        className="mt-1 text-caption text-content-muted"
      >
        {rateCaption}
      </p>
    </div>
  );
}

/** Round hours to a 0.5-step display value so the field can re-accept
 *  the value as `type="number" step="0.5"` without raising browser
 *  step-validation warnings. */
function formatHours(h: number): string {
  if (!Number.isFinite(h) || h < 0) return "";
  // Round to one decimal place, then trim trailing zeros.
  const rounded = Math.round(h * 100) / 100;
  // Snap to the nearest 0.5 increment for cleaner display while
  // keeping accuracy for the underlying math (form submits this
  // string; updateProject's Zod schema parses to a number).
  const snapped = Math.round(rounded * 2) / 2;
  return String(snapped);
}

/** Format a dollar value as a plain decimal string the number input
 *  accepts. No currency symbol — the input is prefixed visually with
 *  `$` separately, and the wire format stays a bare number. */
function formatDollars(d: number): string {
  if (!Number.isFinite(d) || d < 0) return "";
  return (Math.round(d * 100) / 100).toFixed(2);
}
