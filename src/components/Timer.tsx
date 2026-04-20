"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Square } from "lucide-react";
import { LinkPendingSpinner } from "@theshyre/ui";
import { buttonDangerClass, kbdClass } from "@/lib/form-styles";
import { EntryAuthor } from "@/components/EntryAuthor";
import { stopTimerAction } from "@/app/(dashboard)/time-entries/actions";
import { useRunningEntry } from "@/hooks/use-running-entry";
import { notifyTimerChanged } from "@/lib/timer-events";

interface Props {
  /** Viewer's display name — passed to the author chip in the running card. */
  displayName: string;
  /** Viewer's avatar_url (stored value; null triggers the preset fallback). */
  avatarUrl: string | null;
  /** Viewer's user_id — used by the author avatar to derive a stable color. */
  userId: string;
}

/**
 * Sidebar running-timer widget. Source of truth for running state
 * (paired with `<RunningTimerHeaderPill>` at the top of the page for
 * amplification when running). Starts happen on /time-entries; stops
 * can happen from here, from the header pill, the entry kebab, or a
 * week-row. All mutations route through server actions.
 */
export default function Timer({
  displayName,
  avatarUrl,
  userId,
}: Props): React.JSX.Element {
  const { running } = useRunningEntry();
  const [stopping, setStopping] = useState(false);
  const t = useTranslations("time.timer");
  const router = useRouter();

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
    notifyTimerChanged();
    router.refresh();
    setStopping(false);
  }, [running, stopping, router]);

  // Space binds here only for the stop direction. The /time-entries
  // start form has its own Space handler for the stopped → starting
  // path; both branches guard on running-state so they never collide.
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
    // Stopped: quiet invitation at the bottom of the sidebar. Don't
    // reward idleness with hero real estate — the amplified signal is
    // reserved for the running state's header pill.
    return (
      <div className="border-t border-edge">
        <Link
          href="/time-entries"
          className="flex items-center gap-2 px-4 py-3 text-body text-content-muted hover:bg-hover transition-colors"
        >
          <Square size={14} className="text-content-muted" />
          <span>{t("stopped")}</span>
          <kbd className={kbdClass}>Space</kbd>
          <LinkPendingSpinner />
        </Link>
      </div>
    );
  }

  const author = {
    user_id: userId,
    display_name: displayName,
    avatar_url: avatarUrl,
  };

  return (
    <div className="border-t border-success/30">
      <div className="px-4 py-2 border-b border-success/30 bg-success-soft">
        <span className="text-label font-semibold uppercase tracking-wider text-success">
          {t("title")}
        </span>
      </div>
      <div className="px-4 py-3 space-y-2 bg-success-soft">
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
          className={`${buttonDangerClass} w-full justify-center`}
        >
          <Square size={14} />
          {t("stop")}
        </button>
      </div>
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
