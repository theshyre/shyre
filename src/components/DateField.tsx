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
import { inputClass, kbdClass } from "@/lib/form-styles";

// Internal "no edit in progress" sentinel for the editing-text state.
const NOT_EDITING = null;

export interface DateFieldPreset {
  label: string;
  /** ISO YYYY-MM-DD. */
  value: string;
}

/**
 * Display format for the visible text input. The wire format
 * (value/onChange) is always ISO YYYY-MM-DD regardless of this setting.
 *
 * - "us"  — `MM/DD/YYYY` (default; en-US convention)
 * - "dmy" — `DD/MM/YYYY` (en-GB, es-ES, fr, de, …)
 * - "iso" — `YYYY-MM-DD` (sortable, internationally unambiguous)
 *
 * All three parse on input, so a user can type any of them and the
 * value normalizes to the chosen display on blur. Slash-separated
 * input ("1/2/2026") is interpreted per displayFormat — "us" reads it
 * as Jan 2; "dmy" reads it as Feb 1.
 */
export type DateFieldDisplayFormat = "us" | "dmy" | "iso";

/**
 * Map a BCP-47 locale string to the format convention it implies.
 *
 * Callers that have a user's locale (e.g. from `user_settings.locale`
 * mapped to a BCP-47 tag) can pass it through this helper to pick a
 * sensible default rather than hard-coding "us". The wire format and
 * the prop API stay unchanged; this is a convenience for callers, not
 * a magic auto-detection inside the primitive.
 */
export function localeToFormat(locale: string | null | undefined): DateFieldDisplayFormat {
  if (!locale) return "us";
  const tag = locale.toLowerCase();
  if (tag === "en-us" || tag === "en") return "us";
  // ISO is the safe sortable default for non-en-US callers that haven't
  // explicitly opted into a localized slash format.
  if (tag.startsWith("en-gb") || tag.startsWith("es") || tag.startsWith("fr") || tag.startsWith("de") || tag.startsWith("pt") || tag.startsWith("it")) {
    return "dmy";
  }
  return "iso";
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
  /** Override the placeholder. Defaults to the format hint matching displayFormat. */
  placeholder?: string;
  /** Visible format for the text input. Wire format is ISO regardless. */
  displayFormat?: DateFieldDisplayFormat;
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

/** Format an ISO YYYY-MM-DD value for display in the chosen format. */
export function formatForDisplay(
  iso: string,
  format: DateFieldDisplayFormat,
): string {
  if (iso === "") return "";
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  if (format === "iso") return iso;
  if (format === "dmy") return `${m[3]}/${m[2]}/${m[1]}`;
  // "us": MM/DD/YYYY
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * Loose parse: accepts the same set of human-typed shapes the form might see.
 * The optional `format` hint disambiguates `MM/DD/YYYY` vs `DD/MM/YYYY` for
 * slash-separated input — both forms are valid on different sides of the
 * Atlantic.
 */
export function looseParse(
  input: string,
  format: DateFieldDisplayFormat = "us",
): string | null {
  const t = input.trim();
  if (t === "") return "";
  // ISO already
  const iso = ISO_RE.exec(t);
  if (iso) {
    return parseIsoDate(t) ? t : null;
  }
  // Slashed input — disambiguate by format hint
  const slashed = /^(\d{1,2})[/](\d{1,2})[/](\d{4})$/.exec(t);
  if (slashed) {
    const a = Number(slashed[1]);
    const b = Number(slashed[2]);
    const year = Number(slashed[3]);
    const month = format === "dmy" ? b : a;
    const day = format === "dmy" ? a : b;
    const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
    return parseIsoDate(candidate) ? candidate : null;
  }
  // YYYY/MM/DD — unambiguous
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
    displayFormat = "us",
    placeholder,
    disabled,
    ariaLabel,
    className,
    presets,
    autoFocus,
  } = props;

  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const popoverId = `${fieldId}-popover`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Map of ISO → button element, populated as cells render. Used for
  // focus-on-open and (future) roving-tabindex arrow nav.
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // editingText holds whatever the user is mid-typing. While it's NOT_EDITING
  // (the default), the input displays the formatted `value` — so external
  // changes reflow in immediately. On focus we capture the formatted value
  // into editingText; on blur we commit (parsing through looseParse) and
  // reset to NOT_EDITING. This avoids a "sync prop into state via useEffect"
  // anti-pattern.
  const [editingText, setEditingText] = useState<string | null>(NOT_EDITING);
  const formattedValue = formatForDisplay(value, displayFormat);
  const text = editingText ?? formattedValue;
  const effectivePlaceholder =
    placeholder ??
    (displayFormat === "us"
      ? "MM/DD/YYYY"
      : displayFormat === "dmy"
        ? "DD/MM/YYYY"
        : "YYYY-MM-DD");

  // Popover state. `view` = which month the calendar is showing.
  const [open, setOpen] = useState(false);
  const initialAnchor = useMemo(() => {
    const parsed = parseIsoDate(value);
    if (parsed) return { year: parsed.getFullYear(), month: parsed.getMonth() };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [value]);
  const [view, setView] = useState(initialAnchor);
  // Roving tabindex anchor — only the cell with this iso has tabIndex=0.
  // Updated by arrow-key navigation, set on popover open.
  const [focusedIso, setFocusedIso] = useState<string>("");

  /**
   * Close the popover and return focus to the trigger button. This is the
   * standard "non-modal popover" return-focus contract — Escape, click-outside,
   * and focus-leaves-root all converge here so keyboard users land back at
   * the affordance they activated.
   */
  const close = useCallback(() => {
    setOpen(false);
    // Defer the focus call until after React has flushed state — focusing
    // synchronously fights the focusout handler we're running inside.
    requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  // Close on Escape and on click-outside. Two earlier iterations also
  // listened for `focusin` to catch keyboard Tab-out, but every variant
  // we tried (full body filter, html filter, target-equality checks)
  // also fired on the brief focus-fell-to-body window that follows any
  // re-render which unmounts the focused cell — clicking Prev month or
  // a day cell or a preset all park focus on body for a few ms before
  // we re-focus the new cell. That brief gap closed the popover
  // mid-click and the user's intent never landed. The cost of dropping
  // the listener is "popover stays open if you tab through the page
  // without clicking anything" — a less common path than every-click,
  // and Escape still works. Re-add via a smarter Tab-key heuristic if
  // it becomes a real complaint.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") close();
    }
    function onClick(e: MouseEvent): void {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        // Click-outside: close without grabbing focus back (the user
        // is moving on to whatever they clicked).
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);

  // After focusedIso changes (on-open seed OR arrow-key nav), focus that
  // cell. Defer a frame so a view change has rendered new cell refs.
  useEffect(() => {
    if (!open || !focusedIso) return;
    requestAnimationFrame(() => {
      cellRefs.current.get(focusedIso)?.focus();
    });
  }, [open, focusedIso, view]);

  const handleFocus = useCallback(() => {
    setEditingText(formattedValue);
  }, [formattedValue]);

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
    const parsed = looseParse(current, displayFormat);
    if (parsed !== null && parsed !== value) {
      onChange(parsed);
    }
    // Invalid → editingText was cleared above, so the visible text falls
    // back to `value` (the last committed). No further work needed.
  }, [editingText, value, onChange, displayFormat]);

  const handleSelect = useCallback(
    (iso: string) => {
      if (min && iso < min) return;
      if (max && iso > max) return;
      onChange(iso);
      setEditingText(NOT_EDITING);
      setOpen(false);
      // Don't auto-refocus the input after a calendar click. Doing so
      // fires onFocus synchronously, which captures the STALE value
      // (the parent's setState hasn't flushed yet) and writes that into
      // editingText — so the visible field stays empty even though
      // onChange ran. Let focus stay where the user clicked; they can
      // tab back into the field if they want to keep typing.
    },
    [min, max, onChange],
  );

  const openPopover = useCallback(() => {
    setView(initialAnchor);
    // Seed the roving-tabindex anchor: prefer the current value, then
    // today, then January 1 of the visible month as a last resort.
    const todayIso = toIso(new Date());
    setFocusedIso(value || todayIso);
    setOpen(true);
  }, [initialAnchor, value]);
  const togglePopover = useCallback(() => {
    if (open) {
      setOpen(false);
    } else {
      openPopover();
    }
  }, [open, openPopover]);

  const cells = useMemo(
    () => buildMonthGrid(view.year, view.month),
    [view],
  );

  const navMonth = useCallback((delta: number) => {
    setView((v) => {
      const total = v.year * 12 + v.month + delta;
      return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
    });
    // Keep the focused cell in the new view so it doesn't unmount
    // mid-click. Shift focusedIso by the same number of months;
    // clamp to the last day if the day-of-month doesn't exist in
    // the destination (Mar 31 + 1 month → Apr 30).
    setFocusedIso((current) => {
      if (!current) return current;
      const d = parseIsoDate(current);
      if (!d) return current;
      const target = new Date(d);
      target.setMonth(d.getMonth() + delta);
      const expectedMonth = ((d.getMonth() + delta) % 12 + 12) % 12;
      if (target.getMonth() !== expectedMonth) {
        // Overflow — pick last day of the intended month instead.
        target.setDate(0);
      }
      return toIso(target);
    });
  }, []);

  /**
   * Move focus N days from the currently-focused cell. Bringing the new
   * day into view (changing months/years as needed) is part of nav so the
   * focused cell keeps its in-month styling.
   */
  const navDays = useCallback(
    (deltaDays: number) => {
      const current = parseIsoDate(focusedIso);
      if (!current) return;
      const next = new Date(current);
      next.setDate(current.getDate() + deltaDays);
      const nextIso = toIso(next);
      if (min && nextIso < min) return;
      if (max && nextIso > max) return;
      const targetMonth = next.getMonth();
      const targetYear = next.getFullYear();
      if (targetMonth !== view.month || targetYear !== view.year) {
        setView({ year: targetYear, month: targetMonth });
      }
      setFocusedIso(nextIso);
    },
    [focusedIso, min, max, view.month, view.year],
  );

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          navDays(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          navDays(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          navDays(-7);
          break;
        case "ArrowDown":
          e.preventDefault();
          navDays(7);
          break;
        case "Home":
          // Move to start (Sunday) of the focused week.
          e.preventDefault();
          {
            const d = parseIsoDate(focusedIso);
            if (d) navDays(-d.getDay());
          }
          break;
        case "End":
          // Move to end (Saturday) of the focused week.
          e.preventDefault();
          {
            const d = parseIsoDate(focusedIso);
            if (d) navDays(6 - d.getDay());
          }
          break;
        case "PageUp":
          e.preventDefault();
          navDays(e.shiftKey ? -365 : -30);
          break;
        case "PageDown":
          e.preventDefault();
          navDays(e.shiftKey ? 365 : 30);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          handleSelect(focusedIso);
          break;
        default:
          break;
      }
    },
    [focusedIso, navDays, handleSelect],
  );

  /**
   * Input keyboard shortcuts:
   * - Alt+ArrowDown opens the popover (WAI-ARIA combobox convention)
   * - bare ArrowDown opens it ONLY when the input is empty (no caret to
   *   move; matches the "input IS the date selector" mental model)
   * Both are safe — they don't fight typing or caret navigation.
   */
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "ArrowDown") return;
      const isEmpty = (editingText ?? formattedValue) === "";
      if (e.altKey || isEmpty) {
        e.preventDefault();
        if (!open) openPopover();
      }
    },
    [editingText, formattedValue, open, openPopover],
  );

  const handleInputDoubleClick = useCallback(() => {
    if (!open) openPopover();
  }, [open, openPopover]);

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
          onKeyDown={handleInputKeyDown}
          onDoubleClick={handleInputDoubleClick}
          placeholder={effectivePlaceholder}
          disabled={disabled}
          // role="combobox" is what allows aria-expanded + aria-haspopup
          // on a text input. Per WAI-ARIA 1.2 combobox pattern: a text
          // input that opens a popup picker is a combobox.
          role="combobox"
          aria-label={ariaLabel}
          aria-controls={popoverId}
          aria-haspopup="dialog"
          aria-expanded={open}
          autoComplete="off"
          autoFocus={autoFocus}
          className={`${inputClass} pr-[36px]`}
        />
        <button
          ref={triggerRef}
          type="button"
          aria-label="Open calendar"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          onClick={togglePopover}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex items-center px-[10px] text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-r-md"
        >
          <Calendar size={14} />
        </button>
      </div>

      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Calendar"
          className="absolute right-0 top-full z-50 mt-[4px] w-[260px] max-w-[calc(100vw-16px)] rounded-md border border-edge bg-surface-raised p-[8px] shadow-lg"
        >
          {/* Header — month label + prev/next month. Per-button accessible
              names include the target month so each press re-announces. */}
          <div className="flex items-center justify-between mb-[6px]">
            <button
              type="button"
              aria-label={`Previous month, ${prevMonthLabel(view)}`}
              onClick={() => navMonth(-1)}
              className="rounded p-[4px] text-content-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ChevronLeft size={14} />
            </button>
            <div
              aria-live="polite"
              className="text-body font-semibold text-content tabular-nums"
            >
              {MONTH_NAMES[view.month]} {view.year}
            </div>
            <button
              type="button"
              aria-label={`Next month, ${nextMonthLabel(view)}`}
              onClick={() => navMonth(1)}
              className="rounded p-[4px] text-content-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Presets — chip row above the grid; matches caption rhythm */}
          {presets && presets.length > 0 ? (
            <div className="flex flex-wrap gap-[4px] mb-[6px]">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => handleSelect(p.value)}
                  className="h-[22px] rounded border border-edge bg-surface px-[8px] text-caption font-medium text-content-secondary hover:bg-hover hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-[2px] mb-[2px]">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-center text-caption font-medium text-content-muted"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid — APG roving tabindex: only the focused cell has
              tabIndex=0, arrow keys move focus, Enter/Space selects. */}
          <div
            role="grid"
            aria-label={`${MONTH_NAMES[view.month]} ${view.year}`}
            onKeyDown={handleGridKeyDown}
            className="grid grid-cols-7 gap-[2px]"
          >
            {cells.map((cell) => {
              const selected = cell.iso === value;
              const outOfBounds = Boolean(
                (min && cell.iso < min) || (max && cell.iso > max),
              );
              const isFocusTarget = cell.iso === focusedIso;
              const baseClass =
                "h-[28px] w-full inline-flex items-center justify-center rounded text-caption tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";
              let stateClass: string;
              if (selected) {
                stateClass = "bg-accent text-content-inverse font-medium";
              } else if (outOfBounds) {
                // Token-based muted color (verified contrast across themes).
                // Combined with cursor-not-allowed and the disabled DOM
                // state, this is two channels (color + interactivity) — no
                // opacity hack that would dip below 3:1 in high-contrast.
                stateClass =
                  "text-content-muted cursor-not-allowed";
              } else if (cell.isToday) {
                // Soft fill for today — same channel as selected, quieter
                // variant. A 1px ring on bg-accent reads as a render glitch
                // next to a solid bg-accent selection.
                stateClass =
                  "bg-accent-soft text-accent-text font-medium hover:bg-accent-soft/80";
              } else if (!cell.inMonth) {
                stateClass = "text-content-muted hover:bg-hover";
              } else {
                stateClass = "text-content hover:bg-hover";
              }
              const refSetter = (el: HTMLButtonElement | null): void => {
                if (el) cellRefs.current.set(cell.iso, el);
                else cellRefs.current.delete(cell.iso);
              };
              return (
                <button
                  key={cell.iso}
                  ref={refSetter}
                  type="button"
                  role="gridcell"
                  // Roving tabindex: only the focused cell is in the tab
                  // sequence. Arrow keys move focus across cells.
                  tabIndex={isFocusTarget ? 0 : -1}
                  onClick={() => handleSelect(cell.iso)}
                  disabled={outOfBounds}
                  aria-label={
                    cell.isToday ? `${cell.iso}, today` : cell.iso
                  }
                  // gridcell role uses aria-selected (single-select grid),
                  // not aria-pressed (which is a button-only attribute).
                  aria-selected={selected}
                  aria-current={cell.isToday ? "date" : undefined}
                  data-in-month={cell.inMonth ? "true" : "false"}
                  className={`${baseClass} ${stateClass}`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Footer — clear + today shortcut + keyboard hint */}
          <div className="mt-[6px] flex items-center justify-between text-caption">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setEditingText(NOT_EDITING);
                close();
              }}
              className="rounded px-[6px] py-[2px] text-content-muted hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Clear
            </button>
            <div className="flex items-center gap-[8px]">
              <span
                className="text-content-muted hidden sm:inline-flex items-center gap-[4px]"
                aria-hidden="true"
              >
                <kbd className={kbdClass}>⌥</kbd>
                <kbd className={kbdClass}>↓</kbd>
                <span className="text-caption">to open</span>
              </span>
              <button
                type="button"
                onClick={() => handleSelect(toIso(new Date()))}
                className="rounded px-[6px] py-[2px] text-accent font-medium hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Today
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function prevMonthLabel(v: { year: number; month: number }): string {
  const m = (v.month + 11) % 12;
  const y = v.month === 0 ? v.year - 1 : v.year;
  return `${MONTH_NAMES[m]} ${y}`;
}
function nextMonthLabel(v: { year: number; month: number }): string {
  const m = (v.month + 1) % 12;
  const y = v.month === 11 ? v.year + 1 : v.year;
  return `${MONTH_NAMES[m]} ${y}`;
}
