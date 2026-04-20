"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MoreVertical, Pencil, Play, Square, Copy, Trash2 } from "lucide-react";
import { useToast } from "@/components/Toast";
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  async function handleDuplicate(): Promise<void> {
    setPending(true);
    const fd = new FormData();
    fd.set("id", entry.id);
    await duplicateTimeEntryAction(fd);
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
    await startTimerAction(fd);
    toast.push({ kind: "success", message: tToast("timerStarted") });
    setPending(false);
    setOpen(false);
  }

  // Stop this specific running entry. Used when the entry is already
  // running — the "Start timer" menu item is swapped for "Stop timer".
  async function handleStopTimer(): Promise<void> {
    setPending(true);
    const fd = new FormData();
    fd.set("id", entry.id);
    await stopTimerAction(fd);
    toast.push({ kind: "success", message: tToast("timerStopped") });
    setPending(false);
    setOpen(false);
  }

  async function handleDelete(): Promise<void> {
    setPending(true);
    const fd = new FormData();
    fd.set("id", entry.id);
    await deleteTimeEntryAction(fd);
    setPending(false);
    setOpen(false);
    setConfirmDelete(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={t("actionsLabel")}
        className="rounded p-1 text-content-muted hover:bg-hover hover:text-content"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden">
          {isRunning ? (
            <button
              type="button"
              disabled={pending}
              onClick={handleStopTimer}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-success hover:bg-success-soft disabled:opacity-50"
            >
              <Square size={14} />
              {t("stopTimer")}
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={handleStartTimer}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-content-secondary hover:bg-hover disabled:opacity-50"
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
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-content-secondary hover:bg-hover"
          >
            <Pencil size={14} />
            {t("edit")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleDuplicate}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-content-secondary hover:bg-hover disabled:opacity-50"
          >
            <Copy size={14} />
            {t("duplicate")}
          </button>
          {confirmDelete ? (
            <button
              type="button"
              disabled={pending}
              onClick={handleDelete}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-error hover:bg-error-soft disabled:opacity-50"
            >
              <Trash2 size={14} />
              {t("confirmDelete")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-error hover:bg-error-soft"
            >
              <Trash2 size={14} />
              {t("delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
