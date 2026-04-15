"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import {
  permanentlyDeleteTimeEntryAction,
  restoreTimeEntryAction,
} from "../actions";
import { InlineDeleteButton } from "@/components/InlineDeleteButton";
import { useToast } from "@/components/Toast";

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

  function restore(id: string): void {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      try {
        await restoreTimeEntryAction(fd);
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
      await permanentlyDeleteTimeEntryAction(fd);
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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge bg-surface-inset">
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("columns.deletedAt")}
            </th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("columns.category")}
            </th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("columns.project")}
            </th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("columns.entryDate")}
            </th>
            <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("columns.duration")}
            </th>
            <th className="px-4 py-2" aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-edge last:border-0 hover:bg-hover">
              <td className="px-4 py-2 text-xs text-content-muted whitespace-nowrap">
                {e.deleted_at ? new Date(e.deleted_at).toLocaleString() : "—"}
              </td>
              <td className="px-4 py-2">
                {e.category ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: e.category.color }}
                    />
                    <span className="text-sm text-content">{e.category.name}</span>
                  </span>
                ) : (
                  <span className="text-sm text-content-muted italic">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-sm text-content">
                {e.project_name}
                {e.customer_name && (
                  <span className="text-content-muted"> · {e.customer_name}</span>
                )}
                {e.description && (
                  <div className="text-xs text-content-muted truncate max-w-xs">
                    {e.description}
                  </div>
                )}
              </td>
              <td className="px-4 py-2 text-xs text-content-secondary whitespace-nowrap">
                {new Date(e.start_time).toLocaleDateString()}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-content">
                {formatDuration(e.duration_min)}
              </td>
              <td className="px-4 py-2 text-right">
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => restore(e.id)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded bg-accent-soft px-2 py-1 text-xs font-medium text-accent-text hover:opacity-90 disabled:opacity-50 transition-opacity"
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
