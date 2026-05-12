"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Archive,
  MailWarning,
  Share2,
  ShieldAlert,
} from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { CustomerChip } from "@/components/CustomerChip";
import { tableClass } from "@/lib/table-styles";
import { ArchiveButton } from "./archive-button";
import {
  bulkArchiveCustomersAction,
  bulkRestoreCustomersAction,
} from "./actions";

export interface CustomerRow {
  id: string;
  team_id: string;
  name: string;
  email: string | null;
  default_rate: number | null;
  bounced_at: string | null;
  complained_at: string | null;
}

interface Props {
  customers: CustomerRow[];
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
  shareCounts,
  teamNameById,
}: Props): React.JSX.Element {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedCount = selected.size;
  const totalCount = customers.length;
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const someSelected = selectedCount > 0 && !allSelected;

  // Escape clears the selection (Pattern A/B contract). Only fires
  // when no other handler intercepts — text inputs etc. handle
  // Escape themselves.
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
      prev.size === totalCount && totalCount > 0
        ? new Set()
        : new Set(customers.map((c) => c.id)),
    );
  }, [customers, totalCount]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const showOrgColumn = teamNameById.size > 1;

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

  if (customers.length === 0) {
    return (
      <p className="mt-6 text-body text-content-muted">
        {t("noCustomers")}
      </p>
    );
  }

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised">
      {/* Bulk action strip — sibling above the <table>, same
          bg-surface-inset + border-b tokens as the thead so it
          reads as a continuation. Always rendered (no layout
          shift); the action row swaps content based on whether
          a selection exists. */}
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
                total: totalCount,
              })}
            </span>
            <button
              type="button"
              onClick={onBulkArchive}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-error/40 bg-error-soft px-3 py-1.5 text-caption font-semibold text-error-text hover:bg-error/10"
            >
              <Archive size={14} />
              {t("bulkArchive", { count: selectedCount })}
            </button>
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
          <tr className="border-b border-edge bg-surface-inset">
            <th
              scope="col"
              className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
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
            {showOrgColumn && (
              <th
                scope="col"
                className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
              >
                {t("table.org")}
              </th>
            )}
            <th
              scope="col"
              className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {tc("table.name")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {tc("table.email")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("table.defaultRate")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted"
            >
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
                    aria-label={t("bulkRowAria", { name: client.name })}
                  />
                </td>
                {showOrgColumn && (
                  <td className="px-4 py-3 text-body text-content-secondary">
                    {teamNameById.get(client.team_id) ?? "—"}
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CustomerChip
                      customerId={client.id}
                      customerName={client.name}
                    />
                    <Link
                      href={`/customers/${client.id}`}
                      className="text-accent hover:underline font-medium"
                    >
                      {client.name}
                    </Link>
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
                          when: client.bounced_at,
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
                          when: client.complained_at,
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
                <td className="px-4 py-3 text-body text-content-secondary">
                  {client.email ?? "—"}
                </td>
                <td className="px-4 py-3 text-body text-content-secondary font-mono">
                  {client.default_rate
                    ? `$${Number(client.default_rate).toFixed(2)}/hr`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <ArchiveButton
                    customerId={client.id}
                    customerName={client.name}
                  />
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
    </div>
  );
}
