"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarDays,
  CalendarRange,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  ChevronDown,
} from "lucide-react";
import {
  buttonSecondaryClass,
  inputClass,
  kbdClass,
} from "@/lib/form-styles";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import {
  ALL_INTERVALS,
  formatIntervalLabel,
  intervalFromToday,
  intervalToSearchParams,
  shiftInterval,
  type IntervalKind,
  type ResolvedInterval,
} from "@/lib/time/intervals";

interface Props {
  interval: ResolvedInterval;
}

const KIND_ICONS: Record<IntervalKind, React.ComponentType<{ size?: number }>> = {
  day: Clock,
  week: CalendarDays,
  month: Calendar,
  custom: CalendarRange,
};

export function IntervalNav({ interval }: Props): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("time.interval");
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const kindMenuRef = useRef<HTMLDivElement>(null);
  const customFromRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback(
    (next: ResolvedInterval) => {
      const params = intervalToSearchParams(searchParams, next);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const goPrev = useCallback(() => {
    navigate(shiftInterval(interval, -1));
  }, [interval, navigate]);

  const goNext = useCallback(() => {
    navigate(shiftInterval(interval, 1));
  }, [interval, navigate]);

  const goToday = useCallback(() => {
    navigate(intervalFromToday(interval.kind));
  }, [interval.kind, navigate]);

  const changeKind = useCallback(
    (kind: IntervalKind) => {
      navigate(intervalFromToday(kind));
      setKindMenuOpen(false);
    },
    [navigate],
  );

  useKeyboardShortcut({ key: "ArrowLeft", onTrigger: goPrev });
  useKeyboardShortcut({ key: "ArrowRight", onTrigger: goNext });
  useKeyboardShortcut({ key: "t", onTrigger: goToday });

  // Close kind menu on outside click / Escape
  useEffect(() => {
    if (!kindMenuOpen) return;
    function onClick(e: MouseEvent): void {
      if (kindMenuRef.current && !kindMenuRef.current.contains(e.target as Node)) {
        setKindMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setKindMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [kindMenuOpen]);

  const Icon = KIND_ICONS[interval.kind];
  const label = formatIntervalLabel(interval);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={goPrev}
        className={buttonSecondaryClass}
        aria-label={t("prev")}
      >
        <ChevronLeft size={16} />
        <kbd className={kbdClass}>←</kbd>
      </button>

      <button type="button" onClick={goToday} className={buttonSecondaryClass}>
        <Icon size={14} />
        {label}
        <kbd className={kbdClass}>T</kbd>
      </button>

      <button
        type="button"
        onClick={goNext}
        className={buttonSecondaryClass}
        aria-label={t("next")}
      >
        <kbd className={kbdClass}>→</kbd>
        <ChevronRight size={16} />
      </button>

      {/* Interval kind switcher */}
      <div ref={kindMenuRef} className="relative">
        <button
          type="button"
          onClick={() => setKindMenuOpen((o) => !o)}
          className={buttonSecondaryClass}
          aria-haspopup="menu"
          aria-expanded={kindMenuOpen}
          aria-label={t("chooseInterval")}
        >
          {t(`kind.${interval.kind}`)}
          <ChevronDown size={12} />
        </button>
        {kindMenuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden"
          >
            {ALL_INTERVALS.map((k) => {
              const KIcon = KIND_ICONS[k];
              const active = k === interval.kind;
              return (
                <button
                  key={k}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => changeKind(k)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
                    active
                      ? "bg-accent-soft text-accent-text"
                      : "text-content-secondary hover:bg-hover"
                  }`}
                >
                  <KIcon size={14} />
                  {t(`kind.${k}`)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Custom range inputs */}
      {interval.kind === "custom" && (
        <div className="flex items-center gap-1">
          <input
            ref={customFromRef}
            type="date"
            aria-label={t("customFrom")}
            className={`${inputClass} w-auto`}
            defaultValue={toIsoDate(interval.start)}
            onChange={(e) => {
              const from = new Date(e.target.value);
              if (!isNaN(from.getTime())) {
                navigate({ ...interval, start: from });
              }
            }}
          />
          <span className="text-xs text-content-muted">→</span>
          <input
            type="date"
            aria-label={t("customTo")}
            className={`${inputClass} w-auto`}
            defaultValue={toIsoDate(addDays(interval.end, -1))}
            onChange={(e) => {
              const to = new Date(e.target.value);
              if (!isNaN(to.getTime())) {
                const end = addDays(to, 1);
                navigate({ ...interval, end });
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}
