"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, RefreshCw, GitBranch } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { refreshTicketTitleAction } from "@/app/(dashboard)/time-entries/actions";

export interface TicketChipProps {
  /** The owning time entry's id — used by the refresh action. When
   *  omitted the refresh button is hidden (e.g. preview chip in a
   *  pre-save context). */
  entryId?: string;
  provider: "jira" | "github";
  ticketKey: string;
  url: string | null;
  /** Resolved title from the source system. NULL means lookup
   *  hasn't run / failed — chip still renders with just the key. */
  title: string | null;
  /** True when the viewer is the entry's author and may refresh
   *  the title. The server action enforces the same gate. */
  canRefresh?: boolean;
  /** Visual size — "sm" for dense rows, "md" for default. */
  size?: "sm" | "md";
}

/** Visual differentiator for the two providers — three channels:
 *  icon, text label (key), and accent color. Plus the chip is
 *  always paired with the title text when one is resolved. */
function providerVisual(provider: "jira" | "github"): {
  icon: React.ReactNode;
  ringClass: string;
  label: string;
} {
  if (provider === "jira") {
    // Use the accent-soft / accent token pair so the Jira variant
    // adapts cleanly across light / dark / high-contrast (raw
    // Tailwind blue would fail AA in HC mode).
    return {
      icon: (
        <span
          aria-hidden="true"
          className="font-mono font-bold text-caption tracking-tight"
        >
          J
        </span>
      ),
      ringClass: "border-accent bg-accent-soft text-accent-text",
      label: "Jira",
    };
  }
  return {
    icon: <GitBranch size={12} aria-hidden="true" />,
    ringClass: "border-edge bg-surface-inset text-content",
    label: "GitHub",
  };
}

export function TicketChip({
  entryId,
  provider,
  ticketKey,
  url,
  title,
  canRefresh = false,
  size = "md",
}: TicketChipProps): React.JSX.Element {
  const t = useTranslations("time.ticket");
  const visual = providerVisual(provider);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const padX = size === "sm" ? "px-1.5" : "px-2";
  const padY = size === "sm" ? "py-0.5" : "py-1";
  const textCls = size === "sm" ? "text-caption" : "text-body";

  function handleRefresh(): void {
    if (!entryId) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", entryId);
      try {
        await refreshTicketTitleAction(fd);
      } catch {
        setError(t("refreshFailed"));
      }
    });
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border ${visual.ringClass} ${padX} ${padY} ${textCls} max-w-full`}
    >
      <Tooltip label={visual.label}>
        <span className="inline-flex items-center">{visual.icon}</span>
      </Tooltip>

      <span className="font-mono font-medium tabular-nums">{ticketKey}</span>

      {title && (
        <Tooltip label={title}>
          <span className="truncate text-content-secondary">· {title}</span>
        </Tooltip>
      )}

      {url && (
        <Tooltip label={t("open")}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("open")}
            className="inline-flex items-center text-content-muted hover:text-content"
          >
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </Tooltip>
      )}

      {canRefresh && entryId && (
        <Tooltip label={error ?? t("refresh")}>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={pending}
            aria-label={t("refresh")}
            className="inline-flex items-center text-content-muted hover:text-content disabled:opacity-50"
          >
            <RefreshCw
              size={12}
              aria-hidden="true"
              className={pending ? "animate-spin" : ""}
            />
          </button>
        </Tooltip>
      )}
    </span>
  );
}
