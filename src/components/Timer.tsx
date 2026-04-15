"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Play, Square } from "lucide-react";
import { kbdClass } from "@/lib/form-styles";

interface RunningEntry {
  id: string;
  project_id: string;
  description: string | null;
  start_time: string;
  project_name: string;
}

export default function Timer(): React.JSX.Element {
  const [running, setRunning] = useState<RunningEntry | null>(null);
  const [elapsed, setElapsed] = useState("00:00:00");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t = useTranslations("time.timer");
  const router = useRouter();
  const supabase = createClient();

  const fetchRunning = useCallback(async (): Promise<void> => {
    const { data } = await supabase
      .from("time_entries")
      .select("id, project_id, description, start_time, projects(name)")
      .is("end_time", null)
      .order("start_time", { ascending: false })
      .limit(1);

    const first = data?.[0];
    if (first) {
      const entry = first;
      const projectName =
        entry.projects &&
        typeof entry.projects === "object" &&
        "name" in entry.projects
          ? (entry.projects as { name: string }).name
          : "";
      setRunning({
        id: entry.id,
        project_id: entry.project_id,
        description: entry.description,
        start_time: entry.start_time,
        project_name: projectName,
      });
    } else {
      setRunning(null);
    }
  }, [supabase]);

  useEffect(() => {
    fetchRunning();
  }, [fetchRunning]);

  useEffect(() => {
    // Only tick while a timer is running. The non-running branch of the
    // component doesn't render `elapsed`, so no need to reset state here —
    // next start will overwrite on the first tick.
    if (!running) return;

    const tick = (): void => {
      const diff = Date.now() - new Date(running.start_time).getTime();
      const totalSec = Math.floor(diff / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setElapsed(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const handleStop = useCallback(async (): Promise<void> => {
    if (!running) return;
    await supabase
      .from("time_entries")
      .update({ end_time: new Date().toISOString() })
      .eq("id", running.id);
    setRunning(null);
    router.refresh();
  }, [running, supabase, router]);

  // Keyboard shortcut: Space to toggle timer (when not in input)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target.isContentEditable) return;

      e.preventDefault();
      if (running) {
        handleStop();
      }
      // Starting requires project selection — handled on Timer page
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [running, handleStop]);

  if (!running) {
    return (
      <div className="px-4 py-3 text-sm text-content-muted">
        <div className="flex items-center gap-2">
          <Square size={14} className="text-content-muted" />
          <span>{t("stopped")}</span>
          <kbd className={kbdClass}>Space</kbd>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
        <span className="text-xs font-medium text-success">{t("running")}</span>
        <kbd className={kbdClass}>Space</kbd>
      </div>
      <p className="mt-1 text-lg font-mono font-semibold text-content">
        {elapsed}
      </p>
      <p className="text-xs text-content-secondary truncate">
        {running.project_name}
        {running.description ? ` — ${running.description}` : ""}
      </p>
      <button
        onClick={handleStop}
        className="mt-2 flex items-center gap-2 rounded-lg bg-error px-3 py-1.5 text-xs font-medium text-content-inverse hover:opacity-90 transition-colors"
      >
        <Square size={12} />
        {t("stop")}
      </button>
    </div>
  );
}
