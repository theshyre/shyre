"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  inputClass,
  buttonSecondaryClass,
  kbdClass,
} from "@/lib/form-styles";
import { Tooltip } from "@/components/Tooltip";
import {
  parseJumpInput,
  resolveChip,
  type JumpParseResult,
} from "@/lib/time/jump-parse";
import { addLocalDays, getLocalWeekStart } from "@/lib/time/tz";

type ViewKind = "log" | "day" | "week";

interface Props {
  /** The view this trigger lives on. Drives label semantics + per-
   *  view drop-target snapping. */
  view: ViewKind;
  /** The current anchor / day / week-start date as a YYYY-MM-DD
   *  local string. The trigger renders this. */
  anchorStr: string;
  /** Today in the user's TZ. Drives the Today-pill enabled state +
   *  the chip resolver. */
  todayStr: string;
  /** User's TZ offset for calling tz utilities; passed through but
   *  not strictly needed by this component. */
  tzOffsetMin: number;
  /** Optional prev/next handlers — when present, render the
   *  ←/→ arrows alongside the trigger. The Log view passes nothing
   *  (it uses a different paging mechanism); Day and Week pass
   *  their existing handlers. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Optional label (Day/Week) for the prev/next tooltips. */
  prevLabel?: string;
  nextLabel?: string;
}

/**
 * Shared jump-to-date control across the three Time views.
 *
 * UX synthesized from the 2026-05-04 three-persona review:
 *
 *   - Trigger is the date label itself ("This week: May 4 – 10 ▾"),
 *     not a separate Jump-to-date button. The label IS the current
 *     state; clicking it to change state matches every range
 *     picker in the industry.
 *
 *   - Free-text input is autofocused on open. Solo persona ranked
 *     this above the chips: typing "2022-03" beats hunting for a
 *     chip every time. Native <input type="date"> sits next to it
 *     for users who prefer the calendar widget.
 *
 *   - Five chips: Today, Yesterday, Last week, Last month, Last
 *     quarter. Trim of the design doc's eight per the persona
 *     review (this week / this quarter / YTD all dropped).
 *
 *   - Non-modal popover (role="dialog" aria-modal="false"). The
 *     log behind it stays scrollable. Escape + click-outside both
 *     close; focus returns to the trigger.
 *
 *   - `T` jumps to today without opening (fast escape hatch). `G`
 *     opens the popover and focuses the date input. Both gated on
 *     no-input-focused so they don't interfere with editing
 *     entries.
 *
 *   - View-aware drop-target:
 *       Week → snap parsed date to its ISO-week Monday.
 *       Day  → land on the parsed date exactly.
 *       Log  → re-anchor the rendered window to the parsed date.
 *
 *   - Live region announces every successful jump via the page-
 *     level toolbar status node — same source of truth used by
 *     the prev/next arrow handlers.
 */
export function JumpToDate({
  view,
  anchorStr,
  todayStr,
  tzOffsetMin,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
}: Props): React.JSX.Element {
  const t = useTranslations("time.jumpToDate");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const popoverId = useId();
  const errorId = useId();

  void tzOffsetMin; // currently unused; kept in props for symmetry

  const navigateToDate = useCallback(
    (date: string) => {
      // Per-view drop-target: Week snaps to the Monday containing
      // the date so the grid renders that week. Day + Log accept
      // the date as-is — Day shows that exact day, Log re-anchors
      // its window's newest visible day.
      const snapped =
        view === "week" ? getLocalWeekStart(date) : date;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("anchor", snapped);
      // windowDays is Log-specific. A jump that takes you out of
      // the default 14-day window should reset; otherwise the new
      // anchor + an old (e.g. 60-day) windowDays could surface
      // months of unrelated rendered bands.
      params.delete("windowDays");
      router.push(`${pathname ?? "/time-entries"}?${params.toString()}`);
    },
    [view, router, pathname, searchParams],
  );

  const close = useCallback(() => {
    setOpen(false);
    setText("");
    setError(null);
    // Restore focus to the trigger so keyboard users don't end up
    // on document body.
    triggerRef.current?.focus();
  }, []);

  const onSubmit = useCallback(
    (raw: string) => {
      const result: JumpParseResult = parseJumpInput(raw, todayStr);
      if (!result.ok) {
        setError(result.error);
        // Stay in the input so the user can correct.
        inputRef.current?.focus();
        return;
      }
      setError(null);
      navigateToDate(result.date);
      close();
    },
    [todayStr, navigateToDate, close],
  );

  const onChip = useCallback(
    (chip: "today" | "yesterday" | "lastWeek" | "lastMonth" | "lastQuarter") => {
      const { date } = resolveChip(chip, {
        todayLocal: todayStr,
        getLocalWeekStart,
      });
      navigateToDate(date);
      close();
    },
    [todayStr, navigateToDate, close],
  );

  // Native <input type="date"> commits via onChange, not onSubmit —
  // listen separately and skip the parser (the value is already
  // YYYY-MM-DD).
  const onNativePick = useCallback(
    (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
      navigateToDate(value);
      close();
    },
    [navigateToDate, close],
  );

  // Escape closes; click-outside closes. Trigger receives focus on
  // both paths.
  useEffect(() => {
    if (!open) return;
    function onDocKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        close();
      }
    }
    function onDocClick(e: MouseEvent): void {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("keydown", onDocKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onDocKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open, close]);

  // Page-level shortcuts: G opens the popover; T jumps to today
  // without opening. Both gated on no-input-focused so they don't
  // collide with users typing in entry rows / forms elsewhere on
  // the page.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "t") {
        e.preventDefault();
        navigateToDate(todayStr);
      } else if (k === "g") {
        e.preventDefault();
        setOpen(true);
        // Focus the input on next paint.
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [todayStr, navigateToDate]);

  const triggerLabel = formatTriggerLabel(view, anchorStr, todayStr, t);
  const isToday = anchorStr === todayStr;

  return (
    <div className="relative inline-flex items-center gap-1">
      {onPrev && (
        <Tooltip label={prevLabel ?? t("prev")} shortcut="←">
          <button
            type="button"
            onClick={onPrev}
            className={buttonSecondaryClass}
            aria-label={prevLabel ?? t("prev")}
          >
            <ChevronLeft size={16} />
          </button>
        </Tooltip>
      )}
      <Tooltip label={t("triggerTooltip")} shortcut="G">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            if (!open) {
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface px-3 py-1 text-body font-semibold text-content hover:bg-hover transition-colors"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
        >
          <Calendar size={14} className="text-accent" aria-hidden />
          <span className="font-mono tabular-nums">{triggerLabel}</span>
          <ChevronDown size={12} className="text-content-muted" aria-hidden />
          <kbd className={kbdClass} aria-hidden>
            G
          </kbd>
        </button>
      </Tooltip>
      {onNext && (
        <Tooltip label={nextLabel ?? t("next")} shortcut="→">
          <button
            type="button"
            onClick={onNext}
            className={buttonSecondaryClass}
            aria-label={nextLabel ?? t("next")}
          >
            <ChevronRight size={16} />
          </button>
        </Tooltip>
      )}
      {!isToday && (
        <Tooltip label={t("today")} shortcut="T">
          <button
            type="button"
            onClick={() => navigateToDate(todayStr)}
            className="ml-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-caption font-medium text-accent hover:bg-accent/20 transition-colors"
            aria-label={t("today")}
          >
            {t("today")}
            <kbd className={kbdClass} aria-hidden>
              T
            </kbd>
          </button>
        </Tooltip>
      )}
      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-modal="false"
          aria-label={t("popoverTitle")}
          className="absolute z-30 mt-2 w-80 rounded-lg border border-edge bg-surface-raised shadow-lg p-4 space-y-3"
          // Position below the trigger; the offset comes from the
          // parent toolbar's flex flow + the absolute mt-2 step.
          style={{ top: "100%", left: 0 }}
        >
          <div className="space-y-1">
            <label
              htmlFor={`${popoverId}-text`}
              className="text-caption font-medium text-content-muted uppercase tracking-wider"
            >
              {t("textLabel")}
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit(text);
              }}
            >
              <input
                ref={inputRef}
                id={`${popoverId}-text`}
                type="text"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError(null);
                }}
                className={inputClass}
                placeholder={t("textPlaceholder")}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error !== null}
                autoComplete="off"
              />
            </form>
            {error && (
              <p
                id={errorId}
                role="alert"
                className="text-caption text-error mt-1"
              >
                {error}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label
              htmlFor={`${popoverId}-native`}
              className="text-caption font-medium text-content-muted uppercase tracking-wider"
            >
              {t("calendarLabel")}
            </label>
            <input
              id={`${popoverId}-native`}
              type="date"
              defaultValue={anchorStr}
              onChange={(e) => onNativePick(e.target.value)}
              className={inputClass}
              min="2000-01-01"
              max="2099-12-31"
            />
          </div>

          <div
            role="group"
            aria-label={t("chipsLabel")}
            className="flex flex-wrap gap-1.5"
          >
            <ChipButton onClick={() => onChip("today")}>
              {t("chips.today")}
            </ChipButton>
            <ChipButton onClick={() => onChip("yesterday")}>
              {t("chips.yesterday")}
            </ChipButton>
            <ChipButton onClick={() => onChip("lastWeek")}>
              {t("chips.lastWeek")}
            </ChipButton>
            <ChipButton onClick={() => onChip("lastMonth")}>
              {t("chips.lastMonth")}
            </ChipButton>
            <ChipButton onClick={() => onChip("lastQuarter")}>
              {t("chips.lastQuarter")}
            </ChipButton>
          </div>

          <p className="text-caption text-content-muted italic">
            {t("today")}: {formatLong(todayStr)}
          </p>
        </div>
      )}
    </div>
  );
}

function ChipButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded-full border border-edge bg-surface px-2.5 py-1 text-caption font-medium text-content hover:bg-hover hover:border-accent/40 transition-colors"
    >
      {children}
    </button>
  );
}

function formatTriggerLabel(
  view: ViewKind,
  anchorStr: string,
  todayStr: string,
  t: (key: string) => string,
): string {
  if (view === "week") {
    const monday = anchorStr;
    const sunday = addLocalDays(monday, 6);
    const isThisWeek = monday === getLocalWeekStart(todayStr);
    const range = `${formatShort(monday)} – ${formatShort(sunday)}`;
    return isThisWeek ? `${t("thisWeek")}: ${range}` : range;
  }
  if (view === "day") {
    return formatLong(anchorStr);
  }
  // Log
  if (anchorStr === todayStr) return t("today");
  return formatLong(anchorStr);
}

function formatShort(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatLong(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
