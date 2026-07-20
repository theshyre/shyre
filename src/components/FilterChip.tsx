"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { CheckCircle, ChevronDown } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";

/**
 * The one chip-dropdown scaffold for list-page filters
 * (docs/reference/list-pages.md rule 1 + a11y invariants). Hand-rolling
 * this dropdown is banned — the scaffold exists precisely because the
 * pasted copies drifted on the accessibility contract:
 *
 * - trigger: `aria-haspopup` + `aria-expanded`, accessible name =
 *   "{dimension}: {current value}" so AT users hear both what the
 *   filter is and where it stands
 * - panel closes on Escape, outside click, and pick; Escape and pick
 *   return focus to the trigger (outside click leaves focus where the
 *   user put it)
 * - selected option = check icon + `aria-selected` — never fill alone
 *
 * Consumers own the URL push in `onPick`; the chip owns open/close
 * state, focus management, and the visual grammar (rounded-full chip,
 * accent-soft when customized).
 */

export interface FilterChipOption<K extends string = string> {
  key: K;
  label: string;
  /** Optional leading visual (lucide icon, CustomerChip, …) rendered
   *  between the check slot and the label. Must be aria-hidden — the
   *  accessible name comes from `label`. */
  icon?: React.ReactNode;
  selected: boolean;
  /** Label span classes. Defaults to "text-content". */
  labelClassName?: string;
  /** Render a divider after this option (option-group boundary). */
  separatorAfter?: boolean;
}

interface FilterChipProps<K extends string> {
  /** Leading icon inside the trigger chip (aria-hidden by the caller). */
  icon: React.ReactNode;
  /** Filter dimension ("Status", "Customer", "Team") — combined with
   *  `valueLabel` into the trigger's accessible name. */
  dimensionLabel: string;
  /** Current value rendered in the chip ("Active", "Acme Corp"). */
  valueLabel: string;
  /** Extra classes on the value span (e.g. "truncate max-w-[160px]"). */
  valueClassName?: string;
  /** aria-label for the listbox panel. Defaults to `dimensionLabel`. */
  listboxLabel?: string;
  options: ReadonlyArray<FilterChipOption<K>>;
  onPick: (key: K) => void;
  /** Accent-soft trigger treatment when the filter differs from its
   *  default value. */
  customized: boolean;
  /** Panel sizing/overflow classes. Defaults to "w-[200px]". */
  panelClassName?: string;
  /** Optional slot rendered below the options, inside the panel. */
  footer?: React.ReactNode;
}

export function FilterChip<K extends string = string>({
  icon,
  dimensionLabel,
  valueLabel,
  valueClassName,
  listboxLabel,
  options,
  onPick,
  customized,
  panelClassName,
  footer,
}: FilterChipProps<K>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  // Outside click closes without stealing focus — the user is already
  // interacting with something else.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Escape closes AND returns focus to the trigger, wherever focus sat
  // inside the panel. Registered in the CAPTURE phase with
  // stopPropagation so the consumed keypress never reaches page-level
  // Escape handlers (e.g. "clear table selection") — an open panel is
  // the more specific overlay per list-pages.md rule 5.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open]);

  function pick(key: K): void {
    onPick(key);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listboxId : undefined}
      aria-label={`${dimensionLabel}: ${valueLabel}`}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-medium border transition-colors ${
        customized
          ? "bg-accent-soft text-accent-text border-accent/30"
          : "bg-surface-inset text-content-secondary border-edge hover:bg-hover"
      }`}
    >
      {icon}
      <span className={valueClassName}>{valueLabel}</span>
      <ChevronDown size={12} aria-hidden="true" />
    </button>
  );

  return (
    <div ref={rootRef} className="relative">
      {/* Tooltip only when the value is customized away from the "Any
          …" default — the default reads fine untruncated in every
          caller today, and wrapping it too would just add hover
          noise. labelMode="describe" supplements the trigger's own
          aria-label ("{dimension}: {value}") rather than replacing it
          — the two strings differ (dimension prefix vs. bare value),
          so screen readers don't double-announce. This is the single
          fix point for every truncated filter-chip value app-wide. */}
      {customized ? (
        <Tooltip label={valueLabel} labelMode="describe">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      {open && (
        <div
          className={`absolute left-0 top-full mt-1 rounded-lg border border-edge bg-surface-raised shadow-lg p-1 z-20 ${
            panelClassName ?? "w-[200px]"
          }`}
        >
          {/* The listbox role sits on an inner wrapper holding ONLY the
              options (+ aria-hidden separators) so AT option counts stay
              honest; the footer slot lives outside it. */}
          <div
            id={listboxId}
            role="listbox"
            aria-label={listboxLabel ?? dimensionLabel}
          >
            {options.map((opt) => (
              <Fragment key={opt.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={opt.selected}
                  onClick={() => pick(opt.key)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
                >
                  <span className="w-3 shrink-0">
                    {opt.selected && (
                      <CheckCircle size={12} aria-hidden="true" />
                    )}
                  </span>
                  {opt.icon}
                  <span className={opt.labelClassName ?? "text-content"}>
                    {opt.label}
                  </span>
                </button>
                {opt.separatorAfter && (
                  <div
                    className="my-1 border-t border-edge-muted"
                    aria-hidden="true"
                  />
                )}
              </Fragment>
            ))}
          </div>
          {footer}
        </div>
      )}
    </div>
  );
}
