"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { CheckCircle, Download } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { CustomerChip } from "@/components/CustomerChip";
import { PaginationFooter } from "@/components/PaginationFooter";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { effectiveInvoiceStatus } from "@/lib/invoice-status";
import { formatCurrency } from "@/lib/invoice-utils";
import { bulkUpdateInvoiceStatusAction } from "./actions";

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  team_id: string;
  status: string | null;
  issued_date: string | null;
  due_date: string | null;
  total: number | string | null;
  currency: string | null;
  imported_from: string | null;
  customers: { id: string; name: string } | null;
}

interface Props {
  invoices: InvoiceRow[];
  totalCount: number;
  /** team_id → display name. */
  teamNameById: Map<string, string>;
  /** UTC YYYY-MM-DD — passed in so the page-level + table render
   *  agree on what "overdue" means today. */
  today: string;
  /** Already-localized "imported from harvest" tooltip. Server
   *  passes it through to avoid a duplicate i18n setup here. */
  importedTooltip: string;
}

/**
 * Multi-select invoices table — Pattern B.
 *
 * Selection scaffold + a useful month-end bulk action: "Mark paid".
 * The button only enables when EVERY selected invoice is in a state
 * that legally transitions to paid (sent or overdue). Mixed
 * selections show the count but hide the action until the user
 * narrows it.
 *
 * The Undo path for "mark paid" is non-trivial — paid is terminal
 * for some teams' workflows — so we don't auto-restore on the
 * Undo toast. Instead, the toast just acknowledges and leaves the
 * recovery to manual `paid → draft` per invoice (which is the
 * audit-correct path anyway: "I marked it paid by mistake" is a
 * deliberate per-invoice action with a user-visible reason).
 */
export function InvoicesTable({
  invoices,
  totalCount,
  teamNameById,
  today,
  importedTooltip,
}: Props): React.JSX.Element {
  const t = useTranslations("invoices");
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedCount = selected.size;
  const allSelected = invoices.length > 0 && selectedCount === invoices.length;
  const someSelected = selectedCount > 0 && !allSelected;

  // Effective status per row — drives both the badge AND the
  // "can mark paid" gate.
  const effectiveById = useMemo(() => {
    const m = new Map<string, string>();
    for (const inv of invoices) {
      m.set(
        inv.id,
        effectiveInvoiceStatus(inv.status ?? "draft", inv.due_date, today),
      );
    }
    return m;
  }, [invoices, today]);

  // Mark-paid is enabled only when every selected row's effective
  // status is `sent` or `overdue` (the only states that legally
  // transition to paid via isValidInvoiceStatusTransition).
  const canMarkPaid = useMemo(() => {
    if (selectedCount === 0) return false;
    for (const id of selected) {
      const status = effectiveById.get(id);
      if (status !== "sent" && status !== "overdue") return false;
    }
    return true;
  }, [selected, selectedCount, effectiveById]);

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
      prev.size === invoices.length && invoices.length > 0
        ? new Set()
        : new Set(invoices.map((i) => i.id)),
    );
  }, [invoices]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onMarkPaid = useCallback((): void => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      fd.set("status", "paid");
      try {
        await bulkUpdateInvoiceStatusAction(fd);
        setSelected(new Set());
        toast.push({
          kind: "success",
          message: t("bulkPaidToast", { count: ids.length }),
        });
      } catch (err) {
        toast.push({
          kind: "error",
          message:
            err instanceof Error ? err.message : t("bulkPaidFailed"),
        });
      }
    });
  }, [selected, startTransition, toast, t]);

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

  if (invoices.length === 0) {
    return (
      <p className="mt-4 text-body text-content-muted">{t("noInvoices")}</p>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-edge bg-surface-raised">
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
                total: invoices.length,
              })}
            </span>
            <Tooltip
              label={
                canMarkPaid
                  ? t("bulkMarkPaid", { count: selectedCount })
                  : t("bulkMarkPaidIneligibleHint")
              }
            >
              <button
                type="button"
                onClick={onMarkPaid}
                disabled={!canMarkPaid}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success-soft px-3 py-1.5 text-caption font-semibold text-success-text hover:bg-success/10 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-disabled={!canMarkPaid}
              >
                <CheckCircle size={14} />
                {t("bulkMarkPaid", { count: selectedCount })}
              </button>
            </Tooltip>
          </>
        ) : (
          <span className="text-caption text-content-muted">
            {t("bulkSelectHint")}
          </span>
        )}
      </div>

      <table className="w-full text-body">
        <colgroup>
          <col style={{ width: "40px" }} />
          <col />
          <col />
          <col />
          <col style={{ width: "120px" }} />
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
            <th
              scope="col"
              className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("table.invoiceNumber")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("table.team")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("table.customer")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("table.issuedDate")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("table.total")}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted"
            >
              {t("table.status")}
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const customerName = inv.customers?.name ?? "—";
            const isImported = inv.imported_from === "harvest";
            const displayStatus =
              effectiveById.get(inv.id) ?? inv.status ?? "draft";
            const isSelected = selected.has(inv.id);
            return (
              <tr
                key={inv.id}
                className={`border-b border-edge last:border-0 transition-colors ${
                  isSelected ? "bg-accent-soft/30" : "hover:bg-hover"
                }`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(inv.id)}
                    aria-label={t("bulkRowAria", {
                      number: inv.invoice_number,
                    })}
                  />
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="text-accent hover:underline font-medium font-mono"
                    >
                      {inv.invoice_number}
                    </Link>
                    {isImported && (
                      <Tooltip label={importedTooltip}>
                        <span
                          aria-label={importedTooltip}
                          className="inline-flex items-center text-content-muted"
                        >
                          <Download size={12} aria-hidden="true" />
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-content-secondary text-caption">
                  {teamNameById.get(inv.team_id) ?? "—"}
                </td>
                <td className="px-4 py-3 text-content-secondary">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    {inv.customers?.id ? (
                      <CustomerChip
                        customerId={inv.customers.id}
                        customerName={inv.customers.name}
                        size={14}
                      />
                    ) : null}
                    <span className="truncate">{customerName}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-content-secondary text-caption">
                  {inv.issued_date ?? "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-content">
                  {inv.total
                    ? formatCurrency(
                        Number(inv.total),
                        (inv.currency as string | null) ?? undefined,
                      )
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <InvoiceStatusBadge status={displayStatus} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PaginationFooter loaded={invoices.length} total={totalCount} />
    </div>
  );
}
