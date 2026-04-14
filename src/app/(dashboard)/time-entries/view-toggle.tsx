"use client";

import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { kbdClass } from "@/lib/form-styles";

export type TimeView = "day" | "week";

interface Props {
  view: TimeView;
}

/**
 * Segmented control: Day | Week. Updates `?view=` in URL.
 */
export function ViewToggle({ view }: Props): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("time.viewToggle");

  const setView = useCallback(
    (next: TimeView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "week") {
        params.delete("view");
      } else {
        params.set("view", next);
      }
      // Also clear interval-related params that wouldn't make sense after switch
      params.delete("interval");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const btnClass = (active: boolean): string =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "bg-accent text-content-inverse"
        : "bg-surface-raised text-content-secondary hover:bg-hover"
    }`;

  return (
    <div className="inline-flex rounded-md border border-edge overflow-hidden">
      <button
        type="button"
        onClick={() => setView("day")}
        className={btnClass(view === "day")}
        aria-pressed={view === "day"}
      >
        {t("day")}
        <kbd className={kbdClass}>D</kbd>
      </button>
      <button
        type="button"
        onClick={() => setView("week")}
        className={btnClass(view === "week")}
        aria-pressed={view === "week"}
      >
        {t("week")}
        <kbd className={kbdClass}>W</kbd>
      </button>
    </div>
  );
}
