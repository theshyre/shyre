"use client";

/**
 * Single-date input with a popover calendar.
 *
 * Replaces native `<input type="date">` because the OS pickers are (a)
 * inconsistent across browsers, (b) painful to type into on macOS Safari
 * (segment auto-advance halts mid-year, can't paste an ISO string),
 * and (c) visually jarring against the rest of the UI.
 *
 * Contract:
 *   value:    ISO string `YYYY-MM-DD` or `""` (empty = no date)
 *   onChange: receives the same shape; `""` for clear
 *
 * Authored in Shyre with the intent of being promoted to `@theshyre/ui`
 * once Liv adopts it. Keep the API surface small and locale-honest:
 *   - value/onChange are ISO; the visible format derives from `displayLocale`
 *   - no time component; date-only by design
 *   - no controlled `open` state (popover manages itself)
 *   - presets are caller-supplied so the component stays generic
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { inputClass } from "@/lib/form-styles";

// Internal "no edit in progress" sentinel for the editing-text state.
const NOT_EDITING = null;

export interface DateFieldPreset {
  label: string;
  /** ISO YYYY-MM-DD. */
  value: string;
}

export interface DateFieldProps {
  /** ISO YYYY-MM-DD or "". */
  value: string;
  onChange: (next: string) => void;
  id?: string;
  name?: string;
  /** Inclusive lower bound, ISO. */
  min?: string;
  /** Inclusive upper bound, ISO. */
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Optional preset chips rendered above the calendar grid (Today, etc.). */
  presets?: DateFieldPreset[];
  /** Hooked up by callers for autofocus on form open. */
  autoFocus?: boolean;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date as YYYY-MM-DD using local fields (no UTC shift). */
function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse an ISO YYYY-MM-DD into a local-midnight Date. Returns null when invalid. */
export function parseIsoDate(iso: string): Date | null {
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null; // overflow (e.g. 2026-02-31 -> Mar 3)
  }
  return d;
}

/** Loose parse: accepts the same set of human-typed shapes the form might see. */
export function looseParse(input: string): string | null {
  const t = input.trim();
  if (t === "") return "";
  // ISO already
  const iso = ISO_RE.exec(t);
  if (iso) {
    return parseIsoDate(t) ? t : null;
  }
  // M/D/YYYY or MM/DD/YYYY (US)
  const us = /^(\d{1,2})[/](\d{1,2})[/](\d{4})$/.exec(t);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
    return parseIsoDate(candidate) ? candidate : null;
  }
  // YYYY/MM/DD
  const ymd = /^(\d{4})[/](\d{1,2})[/](\d{1,2})$/.exec(t);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
    return parseIsoDate(candidate) ? candidate : null;
  }
  return null;
}

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
  /** 0..6 day-of-week, 0 = Sunday for grid layout. */
  dow: number;
  isToday: boolean;
}

function buildMonthGrid(year: number, month0: number): DayCell[] {
  const first = new Date(year, month0, 1);
  const todayIso = toIso(new Date());
  const startDow = first.getDay(); // 0=Sun
  // Start at the Sunday on/before the 1st.
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - startDow);
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = toIso(d);
    cells.push({
      iso,
      day: d.getDate(),
      inMonth: d.getMonth() === month0,
      dow: d.getDay(),
      isToday: iso === todayIso,
    });
  }
  return cells;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function DateField(props: DateFieldProps): React.JSX.Element {
  const {
    value,
    onChange,
    id,
    name,
    min,
    max,
    placeholder = "YYYY-MM-DD",
    disabled,
    ariaLabel,
    className,
    presets,
    autoFocus,
  } = props;

  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // editingText holds whatever the user is mid-typing. While it's NOT_EDITING
  // (the default), the input displays `value` directly — so external changes
  // reflow in immediately. On focus we capture the current value into
  // editingText; on blur we commit and reset to NOT_EDITING. This avoids a
  // "sync prop into state via useEffect" anti-pattern.
  const [editingText, setEditingText] = useState<string | null>(NOT_EDITING);
  const text = editingText ?? value;

  // Popover state. `view` = which month the calendar is showing.
  const [open, setOpen] = useState(false);
  const initialAnchor = useMemo(() => {
    const parsed = parseIsoDate(value);
    if (parsed) return { year: parsed.getFullYear(), month: parsed.getMonth() };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [value]);
  const [view, setView] = useState(initialAnchor);

  const close = useCallback(() => setOpen(false), []);

  // Click-outside + Escape, mirrors ThemePickerPopover.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") close();
    }
    function onClick(e: MouseEvent): void {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) close();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);

  const handleFocus = useCallback(() => {
    setEditingText(value);
  }, [value]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      // Permit only digits, dashes, and slashes during typing — anything else
      // is a paste accident or a stray keypress.
      if (next !== "" && !/^[0-9/\-]*$/.test(next)) return;
      setEditingText(next);
    },
    [],
  );

  const handleBlur = useCallback(() => {
    const current = editingText ?? value;
    setEditingText(NOT_EDITING);
    if (current.trim() === "") {
      if (value !== "") onChange("");
      return;
    }
    const parsed = looseParse(current);
    if (parsed !== null && parsed !== value) {
      onChange(parsed);
    }
    // Invalid → editingText was cleared above, so the visible text falls
    // back to `value` (the last committed). No further work needed.
  }, [editingText, value, onChange]);

  const handleSelect = useCallback(
    (iso: string) => {
      if (min && iso < min) return;
      if (max && iso > max) return;
      onChange(iso);
      setEditingText(NOT_EDITING);
      setOpen(false);
      // Return focus to the input so keyboard users continue naturally.
      inputRef.current?.focus();
    },
    [min, max, onChange],
  );

  const togglePopover = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      // On open, re-anchor the calendar view to the current value. Avoids
      // stranding the user three months away because they navigated, then
      // closed, then reopened.
      if (next) setView(initialAnchor);
      return next;
    });
  }, [initialAnchor]);

  const cells = useMemo(
    () => buildMonthGrid(view.year, view.month),
    [view],
  );

  const navMonth = useCallback((delta: number) => {
    setView((v) => {
      const total = v.year * 12 + v.month + delta;
      return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
    });
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <div className="relative">
        <input
          ref={inputRef}
          id={fieldId}
          name={name}
          type="text"
          inputMode="numeric"
          value={text}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          autoComplete="off"
          autoFocus={autoFocus}
          className={`${inputClass} pr-10`}
          // Permit pattern hint for browsers that surface it.
          pattern="\d{4}-\d{2}-\d{2}"
        />
        <button
          type="button"
          aria-label="Open calendar"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={togglePopover}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-r-md"
        >
          <Calendar size={16} />
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label="Calendar"
          className="absolute left-0 top-full z-50 mt-1 w-[18rem] rounded-md border border-edge bg-surface-raised p-3 shadow-lg"
        >
          {/* Header — month label + prev/next month */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => navMonth(-1)}
              className="rounded p-1 text-content-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="text-body font-semibold text-content">
              {MONTH_NAMES[view.month]} {view.year}
            </div>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => navMonth(1)}
              className="rounded p-1 text-content-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Presets */}
          {presets && presets.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => handleSelect(p.value)}
                  className="rounded border border-edge bg-surface px-2 py-0.5 text-caption text-content-secondary hover:bg-hover hover:text-content transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-center text-caption font-medium text-content-muted"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => {
              const selected = cell.iso === value;
              const outOfBounds =
                (min && cell.iso < min) || (max && cell.iso > max);
              const baseClass =
                "aspect-square inline-flex items-center justify-center rounded text-body tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";
              let stateClass: string;
              if (selected) {
                stateClass = "bg-accent text-content-inverse font-semibold";
              } else if (outOfBounds) {
                stateClass = "text-content-muted opacity-40 cursor-not-allowed";
              } else if (!cell.inMonth) {
                stateClass = "text-content-muted hover:bg-hover";
              } else if (cell.isToday) {
                stateClass =
                  "ring-1 ring-accent text-content hover:bg-hover";
              } else {
                stateClass = "text-content hover:bg-hover";
              }
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => handleSelect(cell.iso)}
                  disabled={Boolean(outOfBounds)}
                  aria-label={cell.iso}
                  aria-pressed={selected}
                  aria-current={cell.isToday ? "date" : undefined}
                  className={`${baseClass} ${stateClass}`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Footer — clear + today shortcut */}
          <div className="mt-2 flex items-center justify-between text-caption">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setEditingText(NOT_EDITING);
                setOpen(false);
              }}
              className="text-content-muted hover:text-content focus-visible:outline-none focus-visible:underline"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => handleSelect(toIso(new Date()))}
              className="text-accent hover:underline focus-visible:outline-none focus-visible:underline"
            >
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
