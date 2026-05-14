"use client";

import { useCallback, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { kbdClass } from "@/lib/form-styles";

export type TimeView = "day" | "week" | "log" | "table";

interface Props {
  view: TimeView;
}

/**
 * Segmented control: Log | Day | Week | Table. Updates `?view=` in URL.
 *
 * Week / Day / Log are the **authoring + scanning** triad (time-horizon
 * lens). Table is the **admin / review** view (task lens) — flat list
 * with rich filters (date range, description search, invoiced status)
 * for bulk operations. The three time-horizon views stay in parity;
 * Table is deliberately the exception (date-range + search only make
 * sense here).
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
      // windowDays is Log-only; clear it when leaving so a Day/Week
      // view doesn't carry stale state, and clear it on entering Log
      // too so we always start at the default 14-day window.
      if (next !== "log") {
        params.delete("windowDays");
      }
      // Table-only params don't survive leaving the Table view —
      // they'd silently scope an unrelated view if left in the URL
      // (e.g. an invoiced filter on Week would over-fetch).
      if (next !== "table") {
        params.delete("from");
        params.delete("to");
        params.delete("q");
        params.delete("invoiced");
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  // `D` / `W` shortcuts — the kbd badges rendered next to each button were
  // purely decorative until now. Matches the global shortcut convention
  // (bare key, no modifiers, bail when an input has focus) used elsewhere
  // on /time-entries (N for add row, Shift+E/C for group expand/collapse).
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "d") {
        e.preventDefault();
        setView("day");
      } else if (k === "w") {
        e.preventDefault();
        setView("week");
      } else if (k === "l") {
        e.preventDefault();
        setView("log");
      } else if (k === "t") {
        e.preventDefault();
        setView("table");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [setView]);

  const btnClass = (active: boolean): string =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 text-body-lg font-medium transition-colors ${
      active
        ? "bg-accent text-content-inverse"
        : "bg-surface-raised text-content-secondary hover:bg-hover"
    }`;

  return (
    <div className="inline-flex rounded-md border border-edge overflow-hidden">
      <button
        type="button"
        onClick={() => setView("log")}
        className={btnClass(view === "log")}
        aria-pressed={view === "log"}
      >
        {t("log")}
        <kbd className={kbdClass}>L</kbd>
      </button>
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
      <button
        type="button"
        onClick={() => setView("table")}
        className={btnClass(view === "table")}
        aria-pressed={view === "table"}
      >
        {t("table")}
        <kbd className={kbdClass}>T</kbd>
      </button>
    </div>
  );
}
