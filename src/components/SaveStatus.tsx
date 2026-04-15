"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, AlertCircle } from "lucide-react";
import type { SaveStatus as SaveStatusValue } from "@/hooks/useAutosaveStatus";

interface Props {
  status: SaveStatusValue;
  lastSavedAt: number | null;
  lastError?: string | null;
  /** When error, clicking the pill triggers this. Optional. */
  onRetry?: () => void;
  /** Override for the "idle, never saved" state. Default: show nothing. */
  idleVisible?: boolean;
  className?: string;
}

/**
 * Pill showing autosave state — mandatory next to any autosaving form
 * (CLAUDE.md: "Silent saves are a bug"). Color + icon + text redundancy.
 * "Saved just now" ages into "Saved 2m ago" without needing external ticks.
 */
export function SaveStatus({
  status,
  lastSavedAt,
  lastError,
  onRetry,
  idleVisible = false,
  className,
}: Props): React.JSX.Element | null {
  const t = useTranslations("common.saveStatus");
  const relative = useRelativeSavedText(lastSavedAt);

  if (status === "idle" && !idleVisible) return null;

  if (status === "saving") {
    return (
      <span
        className={pill("text-content-muted", className)}
        role="status"
        aria-live="polite"
      >
        <Loader2 size={12} className="animate-spin" />
        <span>{t("saving")}</span>
      </span>
    );
  }

  if (status === "error") {
    const title = lastError ?? t("error");
    return (
      <button
        type="button"
        onClick={onRetry}
        disabled={!onRetry}
        title={title}
        className={pill("text-error", className, "cursor-pointer disabled:cursor-default")}
        aria-live="assertive"
      >
        <AlertCircle size={12} />
        <span>{onRetry ? t("errorRetry") : t("error")}</span>
      </button>
    );
  }

  if (status === "saved" && lastSavedAt !== null) {
    return (
      <span
        className={pill("text-success", className)}
        role="status"
        aria-live="polite"
      >
        <Check size={12} />
        <span>{relative}</span>
      </span>
    );
  }

  // Idle + idleVisible: placeholder "Not saved yet" message
  return (
    <span className={pill("text-content-muted", className)} role="status">
      <span>{t("idle")}</span>
    </span>
  );
}

function pill(tone: string, className: string | undefined, extra?: string): string {
  return [
    "inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs",
    tone,
    extra ?? "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * "Saved just now" → "Saved 1m ago" → "Saved 5m ago" ...
 * Uses useSyncExternalStore with a 20s ticker so re-renders stay off the
 * render path and Date.now() is never called during render (React purity).
 */
function useRelativeSavedText(lastSavedAt: number | null): string {
  const t = useTranslations("common.saveStatus");
  const now = useSyncExternalStore(subscribeNow, getNow, getNowServer);

  if (lastSavedAt === null) return t("idle");
  const deltaSec = Math.max(0, Math.floor((now - lastSavedAt) / 1000));
  if (deltaSec < 10) return t("savedJustNow");
  if (deltaSec < 60) return t("savedSecondsAgo", { seconds: deltaSec });
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return t("savedMinutesAgo", { minutes: deltaMin });
  const deltaHour = Math.floor(deltaMin / 60);
  return t("savedHoursAgo", { hours: deltaHour });
}

function subscribeNow(onChange: () => void): () => void {
  const id = setInterval(onChange, 20_000);
  return () => clearInterval(id);
}
function getNow(): number {
  return Date.now();
}
function getNowServer(): number {
  // Server can't know the client's wall clock — yield a value that forces the
  // relative text to fall back to the "just now" branch for any non-null save.
  return 0;
}
