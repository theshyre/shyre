"use client";

import type React from "react";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Clock, CircleCheck, Receipt, RotateCcw, X } from "lucide-react";
import { formatDate } from "@theshyre/ui";
import { useToast } from "@/components/Toast";
import { buttonSecondaryClass, buttonGhostClass } from "@/lib/form-styles";
import {
  closeOutProjectAction,
  reopenProjectAction,
  getProjectUnbilledSummaryAction,
} from "../actions";

/** Cap the inline list of unbilled entries; the rest collapse into a
 *  "+N more" line with the full set behind the "review" link. */
const MAX_UNBILLED_ENTRIES = 6;

interface UnbilledTimeEntry {
  id: string;
  startTime: string | null;
  description: string | null;
  minutes: number;
}

interface UnbilledSummary {
  timeMinutes: number;
  timeCount: number;
  expenseCount: number;
  timeEntries: UnbilledTimeEntry[];
}

/**
 * Owner/admin close-out + reopen control for the project detail header.
 *
 * Close-out is a reversible-light state change (not data loss), so it
 * uses an inline arm-then-confirm — NOT a modal — mirroring the
 * "Apply parent's settings" pattern in the edit form. On arming, it
 * lazily fetches the unbilled-billable summary and surfaces a
 * non-blocking "invoice before closing?" prompt. Both close and reopen
 * pair with an Undo toast. Renders nothing for non-admins (the server
 * gate is authoritative; this just hides the affordance) or for
 * archived projects (managed from the list / trash).
 */
export function ProjectLifecycleActions({
  projectId,
  status,
  isAdmin,
}: {
  projectId: string;
  status: string;
  isAdmin: boolean;
}): React.JSX.Element | null {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<UnbilledSummary | null>(null);

  if (!isAdmin) return null;

  const isLive = status === "active" || status === "paused";
  const isClosed = status === "completed";

  function openConfirm(): void {
    setConfirming(true);
    startTransition(async () => {
      try {
        setSummary(await getProjectUnbilledSummaryAction(projectId));
      } catch {
        // Fail-safe: if the summary can't load, just omit the prompt
        // rather than blocking the close or showing a wrong "0".
        setSummary(null);
      }
    });
  }

  function doClose(): void {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", projectId);
      try {
        await closeOutProjectAction(fd);
        setConfirming(false);
        toast.push({
          kind: "success",
          message: t("closedToast"),
          actionLabel: tc("actions.undo"),
          onAction: async () => {
            const undoFd = new FormData();
            undoFd.append("id", projectId);
            await reopenProjectAction(undoFd);
            toast.push({ kind: "success", message: t("reopenedToast") });
          },
        });
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("closeFailed"),
        });
      }
    });
  }

  function doReopen(): void {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", projectId);
      try {
        await reopenProjectAction(fd);
        toast.push({ kind: "success", message: t("reopenedToast") });
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("reopenFailed"),
        });
      }
    });
  }

  if (isClosed) {
    return (
      <button
        type="button"
        onClick={doReopen}
        disabled={pending}
        className={`${buttonSecondaryClass} inline-flex items-center gap-1.5`}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {t("reopen")}
      </button>
    );
  }

  // Archived (or any non-live, non-closed) project: nothing to do here.
  if (!isLive) return null;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={openConfirm}
        className={`${buttonSecondaryClass} inline-flex items-center gap-1.5`}
      >
        <CircleCheck size={14} aria-hidden="true" />
        {t("closeOut")}
      </button>
    );
  }

  return (
    <div className="rounded-md border border-info/30 bg-info-soft/40 p-3 space-y-2 max-w-sm">
      <p className="text-caption text-content-secondary">
        {t("closeOutConfirm")}
      </p>
      {summary && (summary.timeCount > 0 || summary.expenseCount > 0) && (
        <div className="rounded-md border border-warning/30 bg-warning-soft/50 p-2 text-caption text-warning-text space-y-2">
          {summary.timeCount > 0 && (
            <div className="flex items-start gap-1.5">
              <Clock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <p>
                  {t("closeOutUnbilledTime", {
                    hours: (summary.timeMinutes / 60).toFixed(1),
                    entries: summary.timeCount,
                  })}
                </p>
                <ul className="space-y-0.5">
                  {summary.timeEntries
                    .slice(0, MAX_UNBILLED_ENTRIES)
                    .map((e) => (
                      <li key={e.id} className="flex items-baseline gap-2">
                        <span className="shrink-0 tabular-nums text-content-muted">
                          {formatDate(e.startTime)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-content-secondary">
                          {e.description || t("closeOutUntitledEntry")}
                        </span>
                        <span className="shrink-0 tabular-nums font-medium">
                          {(e.minutes / 60).toFixed(1)}h
                        </span>
                      </li>
                    ))}
                </ul>
                {summary.timeCount > MAX_UNBILLED_ENTRIES && (
                  <p className="text-content-muted">
                    {t("closeOutMoreEntries", {
                      count: summary.timeCount - MAX_UNBILLED_ENTRIES,
                    })}
                  </p>
                )}
                <Link
                  href={`/time-entries?view=table&project=${projectId}&invoiced=uninvoiced`}
                  className="inline-block underline text-accent-text hover:text-accent"
                >
                  {t("closeOutReviewTime")}
                </Link>
              </div>
            </div>
          )}
          {summary.expenseCount > 0 && (
            <div className="flex items-start gap-1.5">
              <Receipt size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p>
                  {t("closeOutUnbilledExpenses", { count: summary.expenseCount })}
                </p>
                <Link
                  href={`/projects/${projectId}/expenses`}
                  className="inline-block underline text-accent-text hover:text-accent"
                >
                  {t("closeOutReviewExpenses")}
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={doClose}
          disabled={pending}
          className={`${buttonSecondaryClass} inline-flex items-center gap-1.5 text-caption`}
        >
          <CircleCheck size={14} aria-hidden="true" />
          {t("closeOutConfirmButton")}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className={buttonGhostClass}
          aria-label={tc("actions.cancel")}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
