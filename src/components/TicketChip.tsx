"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, RefreshCw, GitBranch, FileDown } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import {
  refreshTicketTitleAction,
  applyTicketTitleAsDescriptionAction,
} from "@/app/(dashboard)/time-entries/actions";

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
  /** Visual size:
   *  - "sm": key only, title moves to a tooltip (dense row layout)
   *  - "md": key + inline title (form / detail layout) */
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
  const [refreshing, startRefresh] = useTransition();
  const [applying, startApply] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const padX = size === "sm" ? "px-1.5" : "px-2";
  const padY = size === "sm" ? "py-0.5" : "py-1";
  const textCls = size === "sm" ? "text-caption" : "text-body";
  const showInlineTitle = size === "md" && Boolean(title);

  function handleRefresh(): void {
    if (!entryId) return;
    setError(null);
    startRefresh(async () => {
      const fd = new FormData();
      fd.set("id", entryId);
      try {
        await refreshTicketTitleAction(fd);
      } catch {
        setError(t("refreshFailed"));
      }
    });
  }

  function handleApplyAsTitle(): void {
    if (!entryId) return;
    setError(null);
    startApply(async () => {
      const fd = new FormData();
      fd.set("id", entryId);
      try {
        await applyTicketTitleAsDescriptionAction(fd);
      } catch {
        setError(t("applyTitleFailed"));
      }
    });
  }

  // The link-out target is the canonical key + title block. We render
  // it as a single anchor so a click anywhere on the key area opens
  // the issue, with the inline-title tooltip on hover. The action
  // buttons (refresh / use-as-title) sit OUTSIDE the anchor so they
  // don't accidentally navigate.
  //
  // Tooltip wraps the whole anchor in size="sm" mode (key-only) so
  // the title is reachable; in size="md" the title shows inline so
  // the tooltip is redundant.
  const keyBlock = (
    <>
      <span aria-hidden="true" className="inline-flex items-center">
        {visual.icon}
      </span>
      <span className="font-mono font-medium tabular-nums">{ticketKey}</span>
      {showInlineTitle && (
        <span className="truncate text-content-secondary">· {title}</span>
      )}
    </>
  );

  const linkClasses = `inline-flex items-center gap-1.5 max-w-full rounded-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1`;
  const staticBlock = (
    <span className="inline-flex items-center gap-1.5 max-w-full">
      {keyBlock}
    </span>
  );

  // Tooltip target priority:
  //   - sm + has title: tooltip the whole anchor with the resolved title
  //   - sm without title: tooltip just the provider label so screen
  //     readers and hover users still get context
  //   - md: title shows inline, no tooltip needed
  const tooltipLabel =
    size === "sm" && title ? title : !title ? visual.label : null;

  let linkArea: React.ReactNode;
  if (url) {
    const anchor = (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClasses}
      >
        {keyBlock}
        <ExternalLink
          size={12}
          aria-hidden="true"
          className="text-content-muted shrink-0"
        />
      </a>
    );
    linkArea = tooltipLabel ? (
      <Tooltip label={tooltipLabel}>{anchor}</Tooltip>
    ) : (
      anchor
    );
  } else {
    linkArea = tooltipLabel ? (
      <Tooltip label={tooltipLabel}>{staticBlock}</Tooltip>
    ) : (
      staticBlock
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border ${visual.ringClass} ${padX} ${padY} ${textCls} max-w-full`}
    >
      {linkArea}

      {canRefresh && entryId && title && (
        // The "Use as title" action is conditional on having a
        // resolved title — without one we'd be replacing the
        // description with nothing meaningful. canRefresh gates
        // both this and the refresh button on author identity.
        <Tooltip label={error && applying ? error : t("applyTitle")}>
          <button
            type="button"
            onClick={handleApplyAsTitle}
            disabled={applying}
            aria-label={t("applyTitle")}
            className="inline-flex items-center text-content-muted hover:text-content disabled:opacity-50"
          >
            <FileDown
              size={12}
              aria-hidden="true"
              className={applying ? "animate-pulse" : ""}
            />
          </button>
        </Tooltip>
      )}

      {canRefresh && entryId && (
        <Tooltip label={error && refreshing ? error : t("refresh")}>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label={t("refresh")}
            className="inline-flex items-center text-content-muted hover:text-content disabled:opacity-50"
          >
            <RefreshCw
              size={12}
              aria-hidden="true"
              className={refreshing ? "animate-spin" : ""}
            />
          </button>
        </Tooltip>
      )}
    </span>
  );
}
