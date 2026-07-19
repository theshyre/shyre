"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Archive,
  Users,
  MailWarning,
  Share2,
  ShieldAlert, Moon, RotateCcw } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { CustomerChip } from "@theshyre/ui";
import { PaginationFooter } from "@/components/PaginationFooter";
import { formatDisplayDateTime } from "@/lib/format-date";
import { formatCurrency } from "@/lib/invoice-utils";
import {
  bulkStripButtonClass,
  bulkStripDangerButtonClass,
  tableBodyCellClass,
  tableClass,
  tableHeaderCellClass,
  tableHeaderRowClass,
  tableWrapperClass,
} from "@/lib/table-styles";
import { checkboxClass } from "@/lib/form-styles";
import { ArchiveButton } from "./archive-button";
import { RestoreCustomerButton } from "./restore-customer-button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  bulkArchiveCustomersAction,
  bulkRestoreCustomersAction,
  deactivateCustomerAction,
  reactivateCustomerAction,
} from "./actions";

export interface CustomerRow {
  id: string;
  team_id: string;
  name: string;
  email: string | null;
  default_rate: number | null;
  bounced_at: string | null;
  complained_at: string | null;
  logo_url: string | null;
  /** Dormant-relationship marker (NULL = active). Lifecycle feature 2026-07-18. */
  inactive_at: string | null;
}

/**
 * Escape-clears-selection guard (list-pages.md rule 5): only
 * text-editing controls swallow Escape. Checkboxes are `<input>`s
 * too — Escape from a focused row checkbox must still clear the
 * selection, so a bare tagName check is not enough.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "file",
  "color",
  "image",
]);

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
}

interface Props {
  customers: CustomerRow[];
  /** "archived" renders the restore surface: archived badge on every row,
   *  row + bulk actions become Restore. Default view shows active+inactive
   *  with the Inactive badge on dormant rows. */
  view?: "default" | "archived";
  /** Rows matching the current filter (pre-pagination count) —
   *  drives the load-more footer. */
  totalCount: number;
  /** customer.id → number of additional teams that share visibility. */
  shareCounts: Map<string, number>;
  /** team_id → display name, used in the Org column. Empty when the
   *  caller renders only one team's customers. */
  teamNameById: Map<string, string>;
}

/**
 * Multi-select customers table — Pattern B per
 * `docs/reference/multi-select-tables.md`.
 *
 * Wide-ish list page (5+ semantic columns) with a sibling bulk
 * strip that renders ABOVE the <table> in the same bordered
 * container when at least one row is selected. The thead stays
 * fully interactive; both master checkboxes (strip + thead) toggle
 * the same selection state.
 *
 * Bulk actions: archive (with Undo toast that calls
 * bulkRestoreCustomersAction). Future bulk edits (assign rate,
 * change team, etc.) plug into the same shell — add a button
 * inside the strip and a server action that takes `id[]`.
 */
export function CustomersTable({
  customers,
  view = "default",
  totalCount,
  shareCounts,
  teamNameById,
}: Props): React.JSX.Element {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedCount = selected.size;
  const loadedCount = customers.length;
  const allSelected = loadedCount > 0 && selectedCount === loadedCount;
  const someSelected = selectedCount > 0 && !allSelected;

  // Escape clears the selection (Pattern A/B contract). Text-editing
  // controls keep Escape for themselves; more specific overlays (e.g.
  // an open FilterChip panel) consume it in the capture phase before
  // this listener sees it.
  useEffect(() => {
    if (selectedCount === 0) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (isTextEditingTarget(e.target)) return;
      setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCount]);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === loadedCount && loadedCount > 0
        ? new Set()
        : new Set(customers.map((c) => c.id)),
    );
  }, [customers, loadedCount]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const showOrgColumn = teamNameById.size > 1;

  const onBulkDeactivate = useCallback((): void => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      try {
        await deactivateCustomerAction(fd);
        setSelected(new Set());
        toast.push({
          kind: "success",
          message: t("bulkDeactivatedToast", { count: ids.length }),
          actionLabel: tc("actions.undo"),
          onAction: async () => {
            const undoFd = new FormData();
            for (const id of ids) undoFd.append("id", id);
            await reactivateCustomerAction(undoFd);
            toast.push({
              kind: "success",
              message: t("bulkReactivatedToast", { count: ids.length }),
            });
          },
        });
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("deactivateFailed"),
        });
      }
    });
  }, [selected, startTransition, toast, t, tc]);

  const onBulkRestore = useCallback((): void => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      try {
        await bulkRestoreCustomersAction(fd);
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

  const onBulkArchive = useCallback((): void => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    startTransition(async () => {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      try {
        await bulkArchiveCustomersAction(fd);
        setSelected(new Set());
        toast.push({
          kind: "success",
          message: t("bulkArchivedToast", { count: ids.length }),
          actionLabel: tc("actions.undo"),
          onAction: async () => {
            const undoFd = new FormData();
            for (const id of ids) undoFd.append("id", id);
            await bulkRestoreCustomersAction(undoFd);
            toast.push({
              kind: "success",
              message: t("bulkRestoredToast", { count: ids.length }),
            });
          },
        });
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("archiveFailed"),
        });
      }
    });
  }, [selected, startTransition, toast, t, tc]);

  // Keep the master checkbox's `indeterminate` DOM property in sync
  // with the someSelected state — React doesn't reflect it from
  // attributes alone.
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

  const colSpan = useMemo(
    () => 5 + (showOrgColumn ? 1 : 0),
    [showOrgColumn],
  );

  // The page's ONE polite live region (list-pages.md a11y invariants):
  // announces the result count after a filter commit and "N selected"
  // on selection change. Debounced so shift-click runs and rapid
  // toggling don't spam AT with intermediate counts.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      setAnnouncement(
        selectedCount > 0
          ? t("liveSelected", { count: selectedCount })
          : t("liveResults", { count: totalCount }),
      );
    }, 300);
    return () => clearTimeout(id);
  }, [selectedCount, totalCount, t]);

  const liveRegion = (
    <span className="sr-only" role="status" aria-live="polite">
      {announcement}
    </span>
  );

  if (customers.length === 0) {
    return (
      <div className={`mt-6 ${tableWrapperClass} p-8 text-center`}>
        {liveRegion}
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
          <Users size={20} className="text-accent" aria-hidden="true" />
        </div>
        <h3 className="text-body-lg font-medium text-content">
          {t(view === "archived" ? "archivedEmptyTitle" : "emptyTitle")}
        </h3>
        <p className="mt-1 text-caption text-content-muted max-w-md mx-auto">
          {t(
            view === "archived" ? "archivedEmptyDescription" : "emptyDescription",
          )}
        </p>
      </div>
    );
  }

  return (
    <div className={`mt-6 ${tableWrapperClass}`}>
      {liveRegion}
      {/* Bulk action strip — sibling above the <table>, same
          bg-surface-inset + border-b tokens as the thead so it
          reads as a continuation. Always rendered (no layout
          shift); the action row swaps content based on whether
          a selection exists. Buttons use the shared bulk-strip
          classes — neutral chrome, intent via colored text/icon
          (list-pages.md rule 5). */}
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
          className={checkboxClass}
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
                total: loadedCount,
              })}
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-caption text-content-secondary hover:text-content hover:underline"
            >
              {t("bulkClear")}
            </button>
            <div className="ml-auto flex items-center gap-2">
              {view === "archived" ? (
                <button
                  type="button"
                  onClick={onBulkRestore}
                  className={bulkStripButtonClass}
                >
                  <RotateCcw size={14} />
                  {t("bulkRestore", { count: selectedCount })}
                </button>
              ) : (
                <>
                  {/* Mark-inactive is neutral, Archive is the danger
                      variant (red TEXT on neutral chrome — soft-fill
                      backgrounds are banned in strips); the contrast
                      teaches the Inactive-vs-Archive distinction. */}
                  <button
                    type="button"
                    onClick={onBulkDeactivate}
                    className={bulkStripButtonClass}
                  >
                    <Moon size={14} />
                    {t("bulkDeactivate", { count: selectedCount })}
                  </button>
                  <button
                    type="button"
                    onClick={onBulkArchive}
                    className={bulkStripDangerButtonClass}
                  >
                    <Archive size={14} />
                    {t("bulkArchive", { count: selectedCount })}
                  </button>
                </>
              )}
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
          {showOrgColumn && <col style={{ width: "160px" }} />}
          <col />
          <col />
          <col style={{ width: "120px" }} />
          <col style={{ width: "120px" }} />
        </colgroup>
        <thead>
          <tr className={tableHeaderRowClass}>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={masterRef}
                onChange={toggleAll}
                className={checkboxClass}
                aria-label={
                  allSelected
                    ? t("bulkDeselectAllAria")
                    : t("bulkSelectAllAria")
                }
              />
            </th>
            {showOrgColumn && (
              <th scope="col" className={`${tableHeaderCellClass} text-left`}>
                {t("table.org")}
              </th>
            )}
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {tc("table.name")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {tc("table.email")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-right`}>
              {t("table.defaultRate")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-right`}>
              {tc("table.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {customers.map((client) => {
            const shareCount = shareCounts.get(client.id) ?? 0;
            const isSelected = selected.has(client.id);
            return (
              <tr
                key={client.id}
                className={`border-b border-edge last:border-0 transition-colors ${
                  isSelected ? "bg-accent-soft/30" : "hover:bg-hover"
                }`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(client.id)}
                    className={checkboxClass}
                    aria-label={t("bulkRowAria", { name: client.name })}
                  />
                </td>
                {showOrgColumn && (
                  <td className={tableBodyCellClass}>
                    {teamNameById.get(client.team_id) ?? "—"}
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CustomerChip
                      customerId={client.id}
                      customerName={client.name}
                      logoUrl={client.logo_url}
                      size={24}
                    />
                    <Link
                      href={`/customers/${client.id}`}
                      className="text-accent hover:underline font-medium"
                    >
                      {client.name}
                    </Link>
                    {view === "archived" ? (
                      <StatusBadge
                        status="archived"
                        label={t("status.archived")}
                      />
                    ) : client.inactive_at ? (
                      <StatusBadge
                        status="inactive"
                        label={t("status.inactive")}
                      />
                    ) : null}
                    {shareCount > 0 && (
                      <Tooltip
                        label={t("sharedWith", { count: shareCount })}
                      >
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-label font-medium text-accent">
                          <Share2 size={10} />
                          {shareCount}
                        </span>
                      </Tooltip>
                    )}
                    {client.bounced_at && (
                      <Tooltip
                        label={t("bouncedRowTooltip", {
                          when: formatDisplayDateTime(client.bounced_at),
                        })}
                      >
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-label font-medium text-warning-text">
                          <MailWarning size={10} />
                          {t("bouncedChip")}
                        </span>
                      </Tooltip>
                    )}
                    {client.complained_at && (
                      <Tooltip
                        label={t("complainedRowTooltip", {
                          when: formatDisplayDateTime(client.complained_at),
                        })}
                      >
                        <span className="inline-flex items-center gap-1 rounded-full bg-error-soft px-2 py-0.5 text-label font-medium text-error-text">
                          <ShieldAlert size={10} />
                          {t("complainedChip")}
                        </span>
                      </Tooltip>
                    )}
                  </div>
                </td>
                <td className={tableBodyCellClass}>
                  {client.email ?? "—"}
                </td>
                <td className={`${tableBodyCellClass} text-right font-mono`}>
                  {client.default_rate
                    ? `${formatCurrency(Number(client.default_rate))}/hr`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {view === "archived" ? (
                    <RestoreCustomerButton customerId={client.id} />
                  ) : (
                    <ArchiveButton
                      customerId={client.id}
                      customerName={client.name}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        {/* Hidden colspan-only row to keep the rendered colSpan
            referenced by the linter — keeps `colSpan` in scope so
            future "no rows match" surfacing doesn't drift on
            column-count changes. */}
        <tfoot className="hidden">
          <tr>
            <td colSpan={colSpan} />
          </tr>
        </tfoot>
      </table>
      <PaginationFooter loaded={customers.length} total={totalCount} />
    </div>
  );
}
