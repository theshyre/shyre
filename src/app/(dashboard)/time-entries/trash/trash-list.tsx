"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import {
  permanentlyDeleteTimeEntriesAction,
  permanentlyDeleteTimeEntryAction,
  restoreTimeEntriesAction,
  restoreTimeEntryAction,
} from "../actions";
import { InlineDeleteButton } from "@/components/InlineDeleteButton";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { useToast } from "@/components/Toast";
import { assertActionResult } from "@/lib/action-result";
import { tableClass } from "@/lib/table-styles";

interface TrashEntry {
  id: string;
  start_time: string;
  end_time: string | null;
  duration_min: number | null;
  description: string | null;
  billable: boolean;
  deleted_at: string | null;
  project_name: string;
  customer_name: string | null;
  category: { name: string; color: string } | null;
}

interface Props {
  entries: TrashEntry[];
  formatDuration: (min: number | null) => string;
}

export function TrashList({ entries, formatDuration }: Props): React.JSX.Element {
  const t = useTranslations("time.trash");
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedCount = selected.size;
  const allSelected = entries.length > 0 && selectedCount === entries.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (selectedCount === 0) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCount]);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === entries.length && entries.length > 0
        ? new Set()
        : new Set(entries.map((e) => e.id)),
    );
  }, [entries]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const masterRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (node) node.indeterminate = someSelected;
    },
    [someSelected],
  );
  const stripMasterRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (node) node.indeterminate = someSelected;
    },
    [someSelected],
  );

  const onBulkRestore = useCallback((): void => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      try {
        await restoreTimeEntriesAction(fd);
        setSelected(new Set());
        toast.push({
          kind: "success",
          message: t("bulkRestoredToast", { count: ids.length }),
        });
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("restoreFailed"),
        });
      }
    });
  }, [selected, startTransition, toast, t]);

  const onBulkPermanentlyDelete = useCallback((): void => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      try {
        await permanentlyDeleteTimeEntriesAction(fd);
        setSelected(new Set());
        toast.push({
          kind: "success",
          message: t("bulkPermanentlyDeletedToast", { count: ids.length }),
        });
      } catch (err) {
        toast.push({
          kind: "error",
          message:
            err instanceof Error ? err.message : t("permanentlyDeleteFailed"),
        });
      }
    });
  }, [selected, startTransition, toast, t]);

  function restore(id: string): void {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      try {
        await assertActionResult(restoreTimeEntryAction(fd));
        toast.push({ kind: "success", message: t("restoredToast") });
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("restoreFailed"),
        });
      }
    });
  }

  async function permanentlyDelete(id: string): Promise<void> {
    const fd = new FormData();
    fd.set("id", id);
    try {
      await assertActionResult(permanentlyDeleteTimeEntryAction(fd));
      toast.push({ kind: "success", message: t("permanentlyDeletedToast") });
    } catch (err) {
      toast.push({
        kind: "error",
        message: err instanceof Error ? err.message : t("permanentlyDeleteFailed"),
      });
    }
  }

  return (
    <div className="rounded-lg border border-edge bg-surface-raised overflow-hidden">
      <div
        role="toolbar"
        aria-label={t("bulkToolbarAriaLabel")}
        className="flex items-center gap-3 px-4 py-2 bg-surface-inset border-b border-edge"
      >
        <input
          type="checkbox"
          checked={allSelected}
          ref={stripMasterRef}
          onChange={toggleAll}
          aria-label={
            allSelected
              ? t("bulkDeselectAllAria")
              : t("bulkSelectAllAria")
          }
        />
        {selectedCount > 0 ? (
          <>
            <span className="text-caption text-content-secondary">
              {t("bulkSelectedLabel", {
                count: selectedCount,
                total: entries.length,
              })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onBulkRestore}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-soft px-3 py-1.5 text-caption font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
              >
                <RotateCcw size={14} />
                {t("bulkRestore", { count: selectedCount })}
              </button>
              <InlineDeleteRowConfirm
                ariaLabel={t("bulkPermanentlyDelete", {
                  count: selectedCount,
                })}
                onConfirm={onBulkPermanentlyDelete}
                summary={t("bulkPermanentlyDeleteSummary", {
                  count: selectedCount,
                })}
              />
            </div>
          </>
        ) : (
          <span className="text-caption text-content-muted">
            {t("bulkSelectHint")}
          </span>
        )}
      </div>
      <table className={tableClass}>
        <colgroup>
          <col style={{ width: "40px" }} />
          <col />
          <col />
          <col />
          <col />
          <col style={{ width: "90px" }} />
          <col style={{ width: "180px" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-edge bg-surface-inset">
            <th
              scope="col"
              className="px-4 py-2 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={masterRef}
                onChange={toggleAll}
                aria-label={
                  allSelected
                    ? t("bulkDeselectAllAria")
                    : t("bulkSelectAllAria")
                }
              />
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("columns.deletedAt")}
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("columns.category")}
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("columns.project")}
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("columns.entryDate")}
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-right text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("columns.duration")}
            </th>
            <th scope="col" className="px-4 py-2">
              <span className="sr-only">{t("columns.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const isSelected = selected.has(e.id);
            return (
            <tr
              key={e.id}
              className={
                isSelected
                  ? "border-b border-edge last:border-0 bg-accent-soft/30"
                  : "border-b border-edge last:border-0 hover:bg-hover"
              }
            >
              <td className="px-4 py-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleOne(e.id)}
                  aria-label={t("bulkRowAria", {
                    project: e.project_name,
                  })}
                />
              </td>
              <td className="px-4 py-2 text-caption text-content-muted whitespace-nowrap">
                {e.deleted_at ? new Date(e.deleted_at).toLocaleString() : "—"}
              </td>
              <td className="px-4 py-2">
                {e.category ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: e.category.color }}
                    />
                    <span className="text-body-lg text-content">{e.category.name}</span>
                  </span>
                ) : (
                  <span className="text-body-lg text-content-muted italic">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-body-lg text-content">
                {e.project_name}
                {e.customer_name && (
                  <span className="text-content-muted"> · {e.customer_name}</span>
                )}
                {e.description && (
                  <div className="text-caption text-content-muted truncate max-w-xs">
                    {e.description}
                  </div>
                )}
              </td>
              <td className="px-4 py-2 text-caption text-content-secondary whitespace-nowrap">
                {new Date(e.start_time).toLocaleDateString()}
              </td>
              <td className="px-4 py-2 text-right font-mono text-caption tabular-nums text-content">
                {formatDuration(e.duration_min)}
              </td>
              <td className="px-4 py-2 text-right">
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => restore(e.id)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded bg-accent-soft px-2 py-1 text-caption font-medium text-accent-text hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <RotateCcw size={12} />
                    {t("restore")}
                  </button>
                  <InlineDeleteButton
                    ariaLabel={t("permanentlyDelete")}
                    onConfirm={() => permanentlyDelete(e.id)}
                    confirmDescription={t("irreversible")}
                  />
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
