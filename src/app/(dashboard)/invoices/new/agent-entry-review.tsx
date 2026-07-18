"use client";

import { AlertTriangle, Ban, Bot, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, resolveAvatarUrl } from "@theshyre/ui";
import { Tooltip } from "@/components/Tooltip";
import { formatDurationShort } from "@/lib/time/week";

/** Keep interpolated entry names inside the tooltip length guidance
 *  (docs/reference/tooltips.md) — long descriptions get an ellipsis. */
function truncateForTooltip(s: string): string {
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

/**
 * Per-row payload for the agent-tracked-time review section on the
 * invoice builder (SAL-051 P3). The invoice flow is the ONLY human
 * gate for agent-tracked time — no approval queue exists by design
 * (docs/reference/multi-stream-timers.md): warn, never auto-merge or
 * block. "Exclude" only removes the entry from the current selection;
 * the time entry itself is never mutated.
 */
export interface AgentReviewRow {
  id: string;
  /** `time_entries.agent_label` — display-only attribution. */
  agentLabel: string | null;
  /** Whose account the agent ran under — the time-entry authorship
   *  mandate applies to this surface like any other (avatar + name). */
  userId: string;
  personName: string;
  description: string | null;
  projectName: string;
  /** YYYY-MM-DD the entry was logged. */
  date: string;
  durationMin: number;
  /** True when the user has excluded this entry from the invoice. */
  excluded: boolean;
  /** Present when the entry wall-clock-overlaps a human entry of the
   *  same user on the same project (see detectAgentOverlaps). */
  conflict: {
    description: string | null;
    date: string;
    /** Display name of the conflicting entry's author — named in the
     *  tooltip so an admin invoicing team-wide sees WHOSE time the
     *  agent collided with. */
    personName: string;
  } | null;
}

export function AgentEntryReview({
  rows,
  onToggleExclude,
}: {
  rows: AgentReviewRow[];
  onToggleExclude: (id: string, excluded: boolean) => void;
}): React.JSX.Element | null {
  const t = useTranslations("invoices.new.agentReview");

  if (rows.length === 0) return null;

  const excludedCount = rows.filter((r) => r.excluded).length;

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-accent" aria-hidden />
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("heading")}
        </h2>
        <span className="text-caption text-content-muted">
          {t("count", { count: rows.length })}
        </span>
      </div>
      <p className="text-caption text-content-muted">{t("help")}</p>
      {/* Announce exclusion changes for screen-reader users — the
          toggle's accessible-name flip alone isn't reliably read, and
          the totals it changes live far away in the preview rail. */}
      <p className="sr-only" role="status" aria-live="polite">
        {t("excludedStatus", { count: excludedCount })}
      </p>
      <ul className="space-y-2">
        {rows.map((row) => {
          const agentName = row.agentLabel ?? t("unlabeled");
          const entryName =
            row.description ?? `${row.projectName} (${row.date})`;
          const conflictEntryName = row.conflict
            ? (row.conflict.description ??
              t("overlapUntitledEntry", { date: row.conflict.date }))
            : null;
          const conflictSentence = row.conflict
            ? t("overlapDetail", {
                entry: truncateForTooltip(conflictEntryName ?? ""),
                name: row.conflict.personName,
              })
            : null;
          return (
            <li
              key={row.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-edge px-3 py-2 ${
                row.excluded ? "bg-surface-inset" : "bg-surface"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-body font-medium text-content">
                    <Bot
                      size={14}
                      className="shrink-0 text-accent"
                      aria-hidden
                    />
                    {agentName}
                  </span>
                  {/* Authorship mandate: whose account the agent ran
                      under — avatar + display name on every surfaced
                      entry, no exceptions. */}
                  <span className="inline-flex items-center gap-1.5 text-caption text-content-secondary">
                    <Avatar
                      avatarUrl={resolveAvatarUrl(null, row.userId)}
                      displayName={row.personName}
                      size={16}
                    />
                    {row.personName}
                  </span>
                  {row.conflict && conflictSentence && (
                    <Tooltip label={conflictSentence}>
                      <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-soft/30 px-2 py-0.5 text-caption text-warning-text">
                        <AlertTriangle size={12} aria-hidden />
                        {t("overlapBadge")}
                      </span>
                    </Tooltip>
                  )}
                  {row.excluded && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-caption text-content-muted">
                      <Ban size={12} aria-hidden />
                      {t("excludedChip")}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-caption text-content-secondary">
                  {row.description ? `${row.description} · ` : ""}
                  {row.projectName} · {row.date} ·{" "}
                  <span className="font-mono tabular-nums">
                    {formatDurationShort(row.durationMin)}
                  </span>
                </p>
                {/* Conflict detail rendered as visible text — the
                    tooltip above is a redundant affordance only.
                    Keyboard, screen-reader, and touch users must be
                    able to learn WHICH entry overlaps without hover. */}
                {conflictSentence && (
                  <p className="mt-0.5 text-caption text-warning-text">
                    {conflictSentence}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onToggleExclude(row.id, !row.excluded)}
                aria-label={
                  row.excluded
                    ? t("includeAria", { entry: entryName })
                    : t("excludeAria", { entry: entryName })
                }
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-edge bg-surface px-2 py-1 text-caption text-content-secondary transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
              >
                {row.excluded ? (
                  <>
                    <Undo2 size={12} aria-hidden />
                    {t("include")}
                  </>
                ) : (
                  <>
                    <X size={12} aria-hidden />
                    {t("exclude")}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
