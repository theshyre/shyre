"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { MoreVertical, Pencil, Play, Square, Copy, Trash2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { assertActionResult } from "@/lib/action-result";
import { notifyTimerChanged } from "@/lib/timer-events";
import { localDayBoundsIso } from "@/lib/local-day-bounds";
import {
  deleteTimeEntryAction,
  duplicateTimeEntryAction,
  startTimerAction,
  stopTimerAction,
} from "./actions";
import type { TimeEntry } from "./types";

interface Props {
  entry: TimeEntry;
  onEdit: () => void;
}

export function EntryKebabMenu({ entry, onEdit }: Props): React.JSX.Element {
  const t = useTranslations("time.entry");
  const tToast = useTranslations("time.toast");
  const toast = useToast();
  const isRunning = !entry.end_time;
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  // The menu is rendered through a portal to `document.body` so the
  // parent table card's `overflow-hidden` never clips it. Viewport
  // coordinates are measured once at open-time; scroll / resize
  // closes the menu so the trigger and panel can't drift apart.
  //
  // When there's room below the trigger we anchor by `top`; when we
  // have to flip up, we anchor by `bottom` so the panel's bottom
  // edge sits against the trigger's top — that way the menu's
  // actual rendered height doesn't matter, no height guessing.
  const [panelPos, setPanelPos] = useState<
    | { kind: "below"; top: number; right: number }
    | { kind: "above"; bottom: number; right: number }
    | null
  >(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      const target = e.target as Node;
      // Outside-click covers both the trigger's original location and
      // the portaled panel — each keeps its own ref because they
      // render in different trees.
      const insideTrigger = triggerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) {
        setOpen(false);
        setConfirmDelete(false);
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirmDelete(false);
      }
    }
    function handleScrollOrResize(): void {
      // Fixed-positioned panel drifts from the trigger as the table
      // scrolls — close rather than reposition, which matches user
      // expectation ("I scrolled, the menu should go away").
      setOpen(false);
      setConfirmDelete(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  // Wrap the action call so a server-side failure surfaces as a
  // visible toast instead of a silent no-op. runSafeAction returns
  // { success, error } rather than throwing, so a bare await
  // resolves on failure too — the user wouldn't know nothing
  // happened. assertActionResult reads the result and throws.
  async function runWithToast(
    promise: Promise<unknown>,
    successMessage: string | null,
    failureMessage: string,
    onSuccess?: () => void,
  ): Promise<void> {
    try {
      await assertActionResult(promise);
      if (successMessage) {
        toast.push({ kind: "success", message: successMessage });
      }
      onSuccess?.();
    } catch (err) {
      toast.push({
        kind: "error",
        message: err instanceof Error ? err.message : failureMessage,
      });
    }
  }

  async function handleDuplicate(): Promise<void> {
    setPending(true);
    const fd = new FormData();
    fd.set("id", entry.id);
    await runWithToast(
      duplicateTimeEntryAction(fd),
      null,
      tToast("duplicateFailed"),
    );
    setPending(false);
    setOpen(false);
  }

  // Seed a new running timer from this entry — same project, category,
  // and description, starts now. Any currently-running timer is stopped
  // server-side by startTimerAction so the user can't accidentally run
  // two at once.
  async function handleStartTimer(): Promise<void> {
    setPending(true);
    const fd = new FormData();
    fd.set("project_id", entry.project_id);
    if (entry.category_id) fd.set("category_id", entry.category_id);
    if (entry.description) fd.set("description", entry.description);
    const [dayStart, dayEnd] = localDayBoundsIso();
    fd.set("day_start_iso", dayStart);
    fd.set("day_end_iso", dayEnd);
    await runWithToast(
      startTimerAction(fd),
      tToast("timerStarted"),
      tToast("timerStartFailed"),
      notifyTimerChanged,
    );
    setPending(false);
    setOpen(false);
  }

  // Stop this specific running entry. Used when the entry is already
  // running — the "Start timer" menu item is swapped for "Stop timer".
  async function handleStopTimer(): Promise<void> {
    setPending(true);
    const fd = new FormData();
    fd.set("id", entry.id);
    await runWithToast(
      stopTimerAction(fd),
      tToast("timerStopped"),
      tToast("timerStopFailed"),
      notifyTimerChanged,
    );
    setPending(false);
    setOpen(false);
  }

  async function handleDelete(): Promise<void> {
    setPending(true);
    const fd = new FormData();
    fd.set("id", entry.id);
    await runWithToast(
      deleteTimeEntryAction(fd),
      null,
      tToast("deleteFailed"),
    );
    setPending(false);
    setOpen(false);
    setConfirmDelete(false);
  }

  const panel = open && panelPos && (
    <div
      ref={panelRef}
      className="fixed z-50 w-[160px] rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden"
      style={
        panelPos.kind === "below"
          ? { top: panelPos.top, right: panelPos.right }
          : { bottom: panelPos.bottom, right: panelPos.right }
      }
    >
      {isRunning ? (
        <button
          type="button"
          disabled={pending}
          onClick={handleStopTimer}
          className="flex items-center gap-2 w-full px-3 py-2 text-body-lg text-left text-success hover:bg-success-soft disabled:opacity-50"
        >
          <Square size={14} />
          {t("stopTimer")}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={handleStartTimer}
          className="flex items-center gap-2 w-full px-3 py-2 text-body-lg text-left text-content-secondary hover:bg-hover disabled:opacity-50"
        >
          <Play size={14} />
          {t("startTimer")}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          onEdit();
          setOpen(false);
        }}
        className="flex items-center gap-2 w-full px-3 py-2 text-body-lg text-left text-content-secondary hover:bg-hover"
      >
        <Pencil size={14} />
        {t("edit")}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={handleDuplicate}
        className="flex items-center gap-2 w-full px-3 py-2 text-body-lg text-left text-content-secondary hover:bg-hover disabled:opacity-50"
      >
        <Copy size={14} />
        {t("duplicate")}
      </button>
      {confirmDelete ? (
        <button
          type="button"
          disabled={pending}
          onClick={handleDelete}
          className="flex items-center gap-2 w-full px-3 py-2 text-body-lg text-left text-error hover:bg-error-soft disabled:opacity-50"
        >
          <Trash2 size={14} />
          {t("confirmDelete")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="flex items-center gap-2 w-full px-3 py-2 text-body-lg text-left text-error hover:bg-error-soft"
        >
          <Trash2 size={14} />
          {t("delete")}
        </button>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open && triggerRef.current) {
            // Measure once at open-time so the portaled panel lands
            // exactly next to the trigger. Estimate is only used to
            // decide the flip direction — actual placement anchors
            // to either top or bottom, so menu-height variance can't
            // leave a gap or overlap.
            const rect = triggerRef.current.getBoundingClientRect();
            const menuH = 180;
            const spaceBelow = window.innerHeight - rect.bottom;
            const right = window.innerWidth - rect.right;
            if (spaceBelow >= menuH) {
              setPanelPos({ kind: "below", top: rect.bottom + 4, right });
            } else {
              setPanelPos({
                kind: "above",
                bottom: window.innerHeight - rect.top + 4,
                right,
              });
            }
          }
          setOpen((o) => !o);
        }}
        aria-label={t("actionsLabel")}
        className="rounded p-1 text-content-muted hover:bg-hover hover:text-content"
      >
        <MoreVertical size={14} />
      </button>
      {/* Portal the panel to document.body so table card's
          overflow-hidden can't clip it. SSR-safe: createPortal is
          called only when `open` is true (client-side). */}
      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : null}
    </>
  );
}
