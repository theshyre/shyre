"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TIMER_CHANGED_EVENT } from "@/lib/timer-events";

export interface RunningEntrySummary {
  id: string;
  project_id: string;
  category_id: string | null;
  user_id: string;
  description: string | null;
  start_time: string;
  project_name: string;
  customer_name: string | null;
  /**
   * Sum of duration_min for this (project, category, user) on the same
   * local day as the running entry's start_time, excluding the running
   * entry itself. When the viewer clicks Play on a row that already
   * had time logged today, the banner / sidebar render `baseline +
   * live elapsed` so the running clock picks up from where the row
   * left off — not from 00:00:00.
   */
  today_baseline_min: number;
}

/**
 * Shared fetch for "is there a running entry right now?". Used by both
 * surfaces that need to know — the sidebar `<Timer>` (full widget) and
 * the `<RunningTimerHeaderPill>` (sticky top-of-page amplifier).
 *
 * Re-fetches on:
 *   - mount
 *   - window focus — covers stops initiated in another tab or from an
 *     admin surface
 *   - `TIMER_CHANGED_EVENT` — in-tab signal dispatched by every
 *     start/stop callsite (entry-row kebab, week-row Play/Stop,
 *     /time-entries start form)
 */
export function useRunningEntry(): {
  running: RunningEntrySummary | null;
  refetch: () => Promise<void>;
} {
  const [running, setRunning] = useState<RunningEntrySummary | null>(null);
  const supabase = createClient();

  const fetchRunning = useCallback(async (): Promise<void> => {
    const { data } = await supabase
      .from("time_entries")
      .select(
        "id, project_id, category_id, user_id, description, start_time, projects(name, customers(name))",
      )
      .is("end_time", null)
      .is("deleted_at", null)
      .order("start_time", { ascending: false })
      .limit(1);

    const first = data?.[0];
    if (!first) {
      setRunning(null);
      return;
    }
    const projectRow = (
      first.projects && typeof first.projects === "object"
        ? first.projects
        : null
    ) as { name?: string; customers?: { name?: string } | null } | null;
    const customerRow = (projectRow?.customers ?? null) as
      | { name?: string }
      | null;

    // Baseline = sum of already-saved entries on the same
    // (project, category, user) for the running entry's local day.
    // Bounds are the viewer's local midnight on either side, derived
    // from the running entry's own start_time so DST / tz don't skew.
    const startDate = new Date(first.start_time);
    const dayStart = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate(),
    );
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    let baselineQuery = supabase
      .from("time_entries")
      .select("duration_min")
      .eq("project_id", first.project_id)
      .eq("user_id", first.user_id)
      .not("end_time", "is", null)
      .is("deleted_at", null)
      .gte("start_time", dayStart.toISOString())
      .lt("start_time", dayEnd.toISOString());
    if (first.category_id) {
      baselineQuery = baselineQuery.eq("category_id", first.category_id);
    } else {
      baselineQuery = baselineQuery.is("category_id", null);
    }
    const { data: baselineRows } = await baselineQuery;
    const today_baseline_min = (baselineRows ?? []).reduce<number>(
      (sum, r) => sum + ((r.duration_min as number | null) ?? 0),
      0,
    );

    setRunning({
      id: first.id,
      project_id: first.project_id,
      category_id: first.category_id,
      user_id: first.user_id,
      description: first.description,
      start_time: first.start_time,
      project_name: projectRow?.name ?? "",
      customer_name: customerRow?.name ?? null,
      today_baseline_min,
    });
  }, [supabase]);

  useEffect(() => {
    const id = setTimeout(() => {
      void fetchRunning();
    }, 0);
    return () => clearTimeout(id);
  }, [fetchRunning]);

  useEffect(() => {
    function refetch(): void {
      void fetchRunning();
    }
    window.addEventListener(TIMER_CHANGED_EVENT, refetch);
    window.addEventListener("focus", refetch);
    return () => {
      window.removeEventListener(TIMER_CHANGED_EVENT, refetch);
      window.removeEventListener("focus", refetch);
    };
  }, [fetchRunning]);

  return { running, refetch: fetchRunning };
}
