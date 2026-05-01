"use client";

import { useState, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import {
  PAYMENT_TERMS_PRESETS,
  isPresetTermsDays,
} from "@/lib/payment-terms";
import { inputClass, labelClass } from "@/lib/form-styles";

type ChipState =
  | { kind: "inherit" }
  | { kind: "preset"; days: number }
  | { kind: "custom"; days: number | null };

function initialState(value: number | null | undefined): ChipState {
  if (value == null) return { kind: "inherit" };
  if (isPresetTermsDays(value)) return { kind: "preset", days: value };
  return { kind: "custom", days: value };
}

interface Props {
  /** Form-data key for the hidden input. The number of days (or
   *  empty string when `kind === "inherit"`) is mirrored here. */
  name: string;
  /** Initial value. `null`/`undefined` selects "inherit"; a preset
   *  selects the matching chip; any other integer goes into Custom. */
  defaultValue: number | null | undefined;
  /** Label for the "no override" / "no default" / "no terms" chip.
   *  Drives the meaning of `kind: "inherit"` per call site:
   *   - customer edit: "Use team default"
   *   - team settings: "No default"
   *   - new-invoice (when no cascade hit): "No terms"
   *  Pass `null` to hide the inherit chip entirely (rare — only when
   *  the field is truly required and there's no fallback). */
  inheritLabel: string | null;
  /** Optional `<label>` text. When provided, renders a labeled
   *  fieldset; when omitted, the chip row stands alone. */
  label?: string;
  /** Optional helper rendered after the chip row, e.g. the cascade
   *  source ("Net 30 (default for Acme)"). */
  helperText?: string | null;
  /** Optional callback fired whenever the resolved value changes.
   *  Lets callers (the new-invoice form) react to a chip click by
   *  recomputing the due-date field. */
  onChange?: (days: number | null) => void;
}

/**
 * Payment-terms chip selector. Used on the customer edit form, team
 * settings, and the new-invoice form.
 *
 * Why a single component for three call sites: the wire format
 * (integer days nullable) and the chip vocabulary (0 / 15 / 30 /
 * 45 / 60 / 90 / Custom / Inherit) must stay identical across
 * surfaces — drift between "what the user picked" and "what the
 * server saved" caused two bugs in earlier sessions of related work.
 *
 * Why "Inherit" instead of just "None": at every call site the
 * blank case has a real meaning. On a customer it falls back to the
 * team default; on team settings it means "ask each time." Naming
 * the chip per-context avoids the user staring at a blank-looking
 * "None" pill and wondering whether anything is selected.
 */
export function PaymentTermsField({
  name,
  defaultValue,
  inheritLabel,
  label,
  helperText,
  onChange,
}: Props): React.JSX.Element {
  const t = useTranslations("paymentTerms");
  const [state, setState] = useState<ChipState>(() => initialState(defaultValue));
  const radioName = useId();

  // Re-sync from props when defaultValue changes (e.g. customer
  // selection on the new-invoice form changes the cascade source).
  // We treat the prop as authoritative on change rather than only on
  // mount, since the form's resolved value comes from the cascade.
  useEffect(() => {
    setState(initialState(defaultValue));
  }, [defaultValue]);

  // Mirror to onChange whenever the resolved value changes.
  useEffect(() => {
    if (!onChange) return;
    if (state.kind === "inherit") onChange(null);
    else if (state.kind === "preset") onChange(state.days);
    else onChange(state.days);
  }, [state, onChange]);

  // Hidden value: empty for inherit, the integer otherwise. Server
  // action treats empty as null. Custom with no entered value also
  // serializes as empty so the action doesn't try to save NaN.
  const hiddenValue: string =
    state.kind === "inherit"
      ? ""
      : state.kind === "preset"
        ? String(state.days)
        : state.days != null
          ? String(state.days)
          : "";

  const isActive = (s: ChipState["kind"], days?: number): boolean => {
    if (s !== state.kind) return false;
    if (days === undefined) return true;
    if (state.kind === "preset") return state.days === days;
    return false;
  };

  return (
    <div role="group" aria-label={label ?? t("ariaGroup")}>
      {label && <span className={labelClass}>{label}</span>}
      <input type="hidden" name={name} value={hiddenValue} />
      <div className="flex flex-wrap gap-1.5">
        {inheritLabel && (
          <button
            type="button"
            role="radio"
            aria-checked={isActive("inherit")}
            data-name={radioName}
            onClick={() => setState({ kind: "inherit" })}
            className={chipClass(isActive("inherit"))}
          >
            {inheritLabel}
          </button>
        )}
        {PAYMENT_TERMS_PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            role="radio"
            aria-checked={isActive("preset", days)}
            data-name={radioName}
            onClick={() => setState({ kind: "preset", days })}
            className={chipClass(isActive("preset", days))}
          >
            {days === 0 ? t("dueOnReceipt") : t("netN", { n: days })}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={isActive("custom")}
          data-name={radioName}
          onClick={() =>
            setState((prev) =>
              prev.kind === "custom" ? prev : { kind: "custom", days: null },
            )
          }
          className={chipClass(isActive("custom"))}
        >
          {t("custom")}
        </button>
      </div>
      {state.kind === "custom" && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={365}
            step={1}
            value={state.days ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setState({ kind: "custom", days: null });
                return;
              }
              const n = parseInt(raw, 10);
              setState({
                kind: "custom",
                days: Number.isFinite(n) ? n : null,
              });
            }}
            placeholder={t("customPlaceholder")}
            className={`${inputClass} max-w-[8rem]`}
            aria-label={t("customAriaLabel")}
          />
          <span className="text-caption text-content-muted">
            {t("customSuffix")}
          </span>
        </div>
      )}
      {helperText && (
        <p className="mt-1.5 text-caption text-content-muted">
          {helperText}
        </p>
      )}
    </div>
  );
}

function chipClass(active: boolean): string {
  return `rounded-md border px-3 py-1.5 text-body transition-colors ${
    active
      ? "border-accent bg-accent-soft text-accent-text"
      : "border-edge bg-surface text-content-secondary hover:border-edge-muted"
  }`;
}
