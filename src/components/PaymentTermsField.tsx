"use client";

import { useState, useId } from "react";
import { useTranslations } from "next-intl";
import {
  PAYMENT_TERMS_PRESETS,
  isPresetTermsDays,
} from "@/lib/payment-terms";
import { inputClass, labelClass } from "@/lib/form-styles";

interface Props {
  /** Form-data key for the hidden input. The number of days (or
   *  empty string when the inherit chip is active) is mirrored
   *  here so server actions can read the value out of FormData. */
  name: string;
  /** Current value (controlled). `null`/`undefined` selects the
   *  inherit chip; a preset selects the matching chip; any other
   *  integer puts the field into Custom mode. */
  value?: number | null;
  /** Backwards-compat alias for `value`. */
  defaultValue?: number | null;
  /** Label for the "no override" / "no default" chip. Pass `null`
   *  to hide the inherit chip entirely. */
  inheritLabel: string | null;
  label?: string;
  helperText?: string | null;
  /** Fired when the user clicks a chip or types a custom value. */
  onChange?: (days: number | null) => void;
}

/**
 * Payment-terms chip selector. Used on the customer edit form, team
 * settings, and the new-invoice form.
 *
 * Design: fully controlled. Parent owns `value`; this component
 * derives chip state from `value` every render. Internal state is
 * limited to:
 *   - `customMode`: the user has clicked the Custom chip so the
 *     number input should show even before they type
 *   - `customDraft`: the typing buffer for the number input
 * No useEffect-driven state sync. An earlier revision used a
 * useEffect that fired `onChange` based on internal state changes;
 * because callers pass inline arrow functions for `onChange`, the
 * deps array changed every render, the effect fired on every
 * parent re-render, and it raced with the parent's own state
 * updates — symptom: "selecting a customer doesn't take the first
 * time" on the new-invoice form. Fully controlled here removes
 * the entire class.
 */
export function PaymentTermsField({
  name,
  value,
  defaultValue,
  inheritLabel,
  label,
  helperText,
  onChange,
}: Props): React.JSX.Element {
  const t = useTranslations("paymentTerms");
  const radioName = useId();

  const resolvedValue = value !== undefined ? value : (defaultValue ?? null);

  const startsInCustom =
    resolvedValue != null && !isPresetTermsDays(resolvedValue);

  // customMode: the user has actively chosen Custom. Lets the
  // number input render even when value is null (they clicked
  // Custom but haven't typed yet) or when value is a preset that
  // they've since switched away from. customDraft holds the typing
  // buffer; we don't echo the live value into it because that
  // would clobber a partially-typed number on every keystroke.
  const [customMode, setCustomMode] = useState(startsInCustom);
  const [customDraft, setCustomDraft] = useState<string>(
    startsInCustom ? String(resolvedValue) : "",
  );

  const isInheritActive = resolvedValue == null && !customMode;
  const isCustomActive =
    customMode || (resolvedValue != null && !isPresetTermsDays(resolvedValue));

  const hiddenValue: string =
    resolvedValue != null ? String(resolvedValue) : "";

  function emit(next: number | null): void {
    if (onChange) onChange(next);
  }

  function pickPreset(days: number): void {
    setCustomMode(false);
    setCustomDraft("");
    emit(days);
  }

  function pickInherit(): void {
    setCustomMode(false);
    setCustomDraft("");
    emit(null);
  }

  function pickCustom(): void {
    setCustomMode(true);
    // If we already have a non-preset value, keep it; otherwise
    // clear so the input renders empty until they type. Don't
    // touch the parent value yet — the number input emits on
    // typing.
    const parsed = customDraft.trim() === "" ? null : parseInt(customDraft, 10);
    if (parsed != null && Number.isFinite(parsed)) {
      emit(parsed);
    } else {
      // Was on a preset → switch to custom-empty. Clear the
      // parent value so the hidden input doesn't carry the old
      // preset over into the form submission.
      emit(null);
    }
  }

  return (
    <div role="group" aria-label={label ?? t("ariaGroup")}>
      {label && <span className={labelClass}>{label}</span>}
      <input type="hidden" name={name} value={hiddenValue} />
      <div className="flex flex-wrap gap-1.5">
        {inheritLabel && (
          <button
            type="button"
            role="radio"
            aria-checked={isInheritActive}
            data-name={radioName}
            onClick={pickInherit}
            className={chipClass(isInheritActive)}
          >
            {inheritLabel}
          </button>
        )}
        {PAYMENT_TERMS_PRESETS.map((days) => {
          const active = !customMode && resolvedValue === days;
          return (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={active}
              data-name={radioName}
              onClick={() => pickPreset(days)}
              className={chipClass(active)}
            >
              {days === 0 ? t("dueOnReceipt") : t("netN", { n: days })}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={isCustomActive}
          data-name={radioName}
          onClick={pickCustom}
          className={chipClass(isCustomActive)}
        >
          {t("custom")}
        </button>
      </div>
      {isCustomActive && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={365}
            step={1}
            value={customDraft}
            onChange={(e) => {
              const raw = e.target.value;
              setCustomDraft(raw);
              if (raw === "") {
                emit(null);
                return;
              }
              const n = parseInt(raw, 10);
              emit(Number.isFinite(n) ? n : null);
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
