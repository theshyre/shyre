"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TIMER_CHANGED_EVENT } from "@/lib/timer-events";

export interface RunningEntrySummary {
  id: string;
  project_id: string;
  description: string | null;
  start_time: string;
  project_name: string;
  customer_name: string | null;
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
        "id, project_id, description, start_time, projects(name, customers(name))",
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
    setRunning({
      id: first.id,
      project_id: first.project_id,
      description: first.description,
      start_time: first.start_time,
      project_name: projectRow?.name ?? "",
      customer_name: customerRow?.name ?? null,
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
