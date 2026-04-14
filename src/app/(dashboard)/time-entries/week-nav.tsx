"use client";

import { useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import {
  buttonSecondaryClass,
  inputClass,
  kbdClass,
} from "@/lib/form-styles";
import {
  isoWeekParam,
  getWeekStart,
  parseWeekParam,
} from "@/lib/time/week";

interface Props {
  weekStart: Date;
}

export function WeekNav({ weekStart }: Props): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("time.week");
  const dateInputRef = useRef<HTMLInputElement>(null);

  const navigateTo = useCallback(
    (target: Date) => {
      const params = new URLSearchParams(searchParams.toString());
      const monday = getWeekStart(target);
      params.set("week", isoWeekParam(monday));
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const goPrev = useCallback(() => {
    const prev = new Date(weekStart);
    prev.setDate(prev.getDate() - 7);
    navigateTo(prev);
  }, [weekStart, navigateTo]);

  const goNext = useCallback(() => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + 7);
    navigateTo(next);
  }, [weekStart, navigateTo]);

  const goToday = useCallback(() => {
    navigateTo(new Date());
  }, [navigateTo]);

  const focusDatePicker = useCallback(() => {
    dateInputRef.current?.focus();
    dateInputRef.current?.showPicker?.();
  }, []);

  useKeyboardShortcut({ key: "ArrowLeft", onTrigger: goPrev });
  useKeyboardShortcut({ key: "ArrowRight", onTrigger: goNext });
  useKeyboardShortcut({ key: "t", onTrigger: goToday });
  useKeyboardShortcut({ key: "w", onTrigger: focusDatePicker });

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
        {t("thisWeek")}
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
      <input
        ref={dateInputRef}
        type="date"
        aria-label="Week date picker"
        className={`${inputClass} w-auto`}
        value={isoWeekParam(weekStart)}
        onChange={(e) => {
          const parsed = parseWeekParam(e.target.value);
          if (parsed) navigateTo(parsed);
        }}
      />
    </div>
  );
}
