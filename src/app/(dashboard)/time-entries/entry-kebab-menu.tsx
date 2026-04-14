"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MoreVertical, Pencil, Copy, Trash2 } from "lucide-react";
import {
  deleteTimeEntryAction,
  duplicateTimeEntryAction,
} from "./actions";
import type { TimeEntry } from "./types";

interface Props {
  entry: TimeEntry;
  onEdit: () => void;
}

export function EntryKebabMenu({ entry, onEdit }: Props): React.JSX.Element {
  const t = useTranslations("time.entry");
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
