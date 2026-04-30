"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Square, ArrowRight } from "lucide-react";
import { stopTimerAction } from "@/app/(dashboard)/time-entries/actions";
import { useRunningEntry } from "@/hooks/use-running-entry";
import { notifyTimerChanged } from "@/lib/timer-events";
import { Tooltip } from "@/components/Tooltip";
import {
  formatTimerStarted,
  entryDeepLink,
} from "@/lib/time/timer-started";

/**
 * Sticky running-timer strip at the top of the dashboard main column.
 * Mounted once in the dashboard layout. Only renders when a timer is
 * running — when stopped, it's nothing (the sidebar's quiet "Stopped"
 * invitation is enough).
 *
 * Reads from the same `useRunningEntry` hook as the sidebar `<Timer>`,
 * so they stay in sync via the shared `TIMER_CHANGED_EVENT`. Stopping
 * from either one refreshes both.
 */
export function RunningTimerHeaderPill(): React.JSX.Element | null {
  const { running } = useRunningEntry();
  const [stopping, setStopping] = useState(false);
  const t = useTranslations("time.timer");
  const router = useRouter();

  // Live elapsed clock — ticks per second whenever a timer is running.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const handleStop = useCallback(async (): Promise<void> => {
    if (!running || stopping) return;
    setStopping(true);
    const fd = new FormData();
    fd.set("id", running.id);
    await stopTimerAction(fd);
    notifyTimerChanged();
    router.refresh();
    setStopping(false);
  }, [running, stopping, router]);

  if (!running) return null;

  // Show today's row total (already-saved entries on the same
  // project + category + user) plus the current live session, so a
  // resume click on a row that had 0:03 logged reads 0:03:0X instead
  // of jumping back to 00:00:00.
  const elapsed = formatElapsed(
    running.today_baseline_min * 60_000 +
      (nowMs - new Date(running.start_time).getTime()),
  );

  const startedCaption = formatTimerStarted(running.start_time, nowMs);
  const entryHref = entryDeepLink(running.start_time, running.id);

  return (
    <div className="sticky top-0 z-20 border-b border-success/30 bg-success-soft">
      <div className="mx-auto max-w-[1280px] flex items-center gap-3 px-[32px] py-2">
        <span className="h-2 w-2 rounded-full bg-success animate-pulse shrink-0" />
        <span className="text-label font-semibold uppercase tracking-wider text-success shrink-0">
          {t("running")}
        </span>
        <span className="font-mono text-body-lg font-bold text-content tabular-nums shrink-0">
          {elapsed}
        </span>
        <span className="min-w-0 flex-1 truncate text-body text-content">
          {running.project_name}
          {running.customer_name && (
            <span className="text-content-muted">
              {" · "}
              {running.customer_name}
            </span>
          )}
          {running.description && (
            <span className="text-content-muted italic">
              {" · "}
              {running.description}
            </span>
          )}
        </span>
        <Tooltip label={new Date(running.start_time).toLocaleString()}>
          <span className="text-caption text-content-muted shrink-0 hidden sm:inline">
            {startedCaption}
          </span>
        </Tooltip>
        <Link
          href={entryHref}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-caption text-content-secondary hover:bg-success/10 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring shrink-0"
          aria-label="View this time entry"
        >
          View entry
          <ArrowRight size={12} />
        </Link>
        <button
          type="button"
          onClick={handleStop}
          disabled={stopping}
          className="inline-flex items-center gap-1.5 rounded-md bg-error px-3 py-1 text-body-lg font-medium text-content-inverse hover:opacity-90 transition-colors disabled:opacity-50"
          aria-label={t("stop")}
        >
          <Square size={14} />
          {t("stop")}
        </button>
      </div>
    </div>
  );
}

function formatElapsed(diffMs: number): string {
  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
