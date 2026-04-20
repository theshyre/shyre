"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Square } from "lucide-react";
import { LinkPendingSpinner } from "@theshyre/ui";
import { kbdClass } from "@/lib/form-styles";
import { EntryAuthor } from "@/components/EntryAuthor";
import { stopTimerAction } from "@/app/(dashboard)/time-entries/actions";
import {
  notifyTimerChanged,
  TIMER_CHANGED_EVENT,
} from "@/lib/timer-events";

interface RunningEntry {
  id: string;
  project_id: string;
  description: string | null;
  start_time: string;
  project_name: string;
  customer_name: string | null;
}

interface Props {
  /** Viewer's display name — passed to the author chip in the running card. */
  displayName: string;
  /** Viewer's avatar_url (stored value; null triggers the preset fallback). */
  avatarUrl: string | null;
  /** Viewer's user_id — used by the author avatar to derive a stable color. */
  userId: string;
}

/**
 * Sole running-timer surface across the dashboard. Lives in the sidebar
 * so it's visible on every page without duplicating controls on the
 * /time-entries surface. Starts happen on /time-entries (via the start
 * form); stops happen from anywhere (here, the entry kebab, the week
 * row). All mutations route through server actions — never a direct
 * Supabase write from the client — so RLS and revalidation stay
 * coherent.
 */
export default function Timer({
  displayName,
  avatarUrl,
  userId,
}: Props): React.JSX.Element {
  const [running, setRunning] = useState<RunningEntry | null>(null);
  const [stopping, setStopping] = useState(false);
  const t = useTranslations("time.timer");
  const router = useRouter();
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
    if (first) {
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
    } else {
      setRunning(null);
    }
  }, [supabase]);

  // Initial fetch + re-fetch on tab focus + cross-surface event.
  // Re-fetching on focus catches stops initiated from a second tab or
  // an admin surface; the custom event catches in-tab stops from the
  // entry kebab / week-row / start form without needing a full page
  // re-render.
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

  const nowMs = useNowMs(running !== null);
  const elapsed = running
    ? formatElapsed(nowMs - new Date(running.start_time).getTime())
    : "00:00:00";

  const handleStop = useCallback(async (): Promise<void> => {
    if (!running || stopping) return;
    setStopping(true);
    const fd = new FormData();
    fd.set("id", running.id);
    await stopTimerAction(fd);
    setRunning(null);
    notifyTimerChanged();
    router.refresh();
    setStopping(false);
  }, [running, stopping, router]);

  // Space binds here only for the stop direction. The /time-entries
  // start form has its own Space handler for the stopped → starting
  // path (expanded form + submit). Both branches guard on their own
  // running-state, so they never double-fire.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.code !== "Space") return;
      if (!running) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target.isContentEditable) return;
      e.preventDefault();
      void handleStop();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [running, handleStop]);

  if (!running) {
    return (
      <Link
        href="/time-entries"
        className="flex items-center gap-2 px-4 py-3 text-caption text-content-muted hover:bg-hover transition-colors"
      >
        <Square size={14} className="text-content-muted" />
        <span>{t("stopped")}</span>
        <kbd className={kbdClass}>Space</kbd>
        <LinkPendingSpinner />
      </Link>
    );
  }

  const author = {
    user_id: userId,
    display_name: displayName,
    avatar_url: avatarUrl,
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
        <span className="text-label font-semibold uppercase text-success">
          {t("running")}
        </span>
        <kbd className={kbdClass}>Space</kbd>
      </div>
      <p className="font-mono text-title font-bold text-content tabular-nums">
        {elapsed}
      </p>
      <div className="text-caption text-content-secondary truncate">
        <span className="text-content">{running.project_name}</span>
        {running.customer_name && (
          <span className="text-content-muted">
            {" · "}
            {running.customer_name}
          </span>
        )}
      </div>
      {running.description && (
        <p className="text-caption text-content-muted truncate italic">
          {running.description}
        </p>
      )}
      <EntryAuthor author={author} size={16} />
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        className="flex items-center gap-2 rounded-lg bg-error px-3 py-1.5 text-body-lg font-medium text-content-inverse hover:opacity-90 transition-colors disabled:opacity-50"
      >
        <Square size={12} />
        {t("stop")}
      </button>
    </div>
  );
}

function useNowMs(active: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function formatElapsed(diffMs: number): string {
  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
