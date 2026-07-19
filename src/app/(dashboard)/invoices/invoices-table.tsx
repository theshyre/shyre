"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { CheckCircle, Download, FileText, X } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { CustomerChip } from "@theshyre/ui";
import { formatDisplayDate } from "@/lib/format-date";
import { checkboxClass } from "@/lib/form-styles";
import {
  tableClass,
  tableHeaderRowClass,
  tableHeaderCellClass,
  tableBodyRowClass,
  tableBodyCellClass,
  tableWrapperClass,
  bulkStripButtonClass,
} from "@/lib/table-styles";
import { isTextEditingTarget } from "@/lib/is-text-editing-target";
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
  customers: { id: string; name: string; logo_url: string | null } | null;
}

interface Props {
  invoices: InvoiceRow[];
  totalCount: number;
  /** team_id → display name. */
  teamNameById: Map<string, string>;
  /** Local YYYY-MM-DD — passed in so the page-level + table render
   *  agree on what "overdue" means today. */
  today: string;
  /** Already-localized "imported from harvest" tooltip. Server
   *  passes it through to avoid a duplicate i18n setup here. */
  importedTooltip: string;
  /** True when any Row-3 filter is off its default — switches the
   *  empty state from first-run onboarding copy to "no matches". */
  filtersActive: boolean;
}

/**
 * Multi-select invoices table — Pattern B (sibling strip above).
 *
 * Selection scaffold + a useful month-end bulk action: "Mark paid".
 * The button only enables when EVERY selected invoice is in a state
 * that legally transitions to paid (sent or overdue). Mixed
 * selections show the count but keep the action focusable with an
 * explanatory tooltip (aria-disabled, never `disabled` — the
 * disabled-reason matters, per list-pages.md).
 *
 * Mark-paid is a reversible one-way flip, so it gets a tier-1
 * inline [Confirm][Cancel] before firing. The Undo path for "mark
 * paid" is non-trivial — paid is terminal for some teams'
 * workflows — so we don't auto-restore on the toast. Recovery is
 * manual `paid → draft` per invoice (the audit-correct path:
 * "I marked it paid by mistake" is a deliberate per-invoice action
 * with a user-visible reason).
 */
export function InvoicesTable({
  invoices,
  totalCount,
  teamNameById,
  today,
  importedTooltip,
  filtersActive,
}: Props): React.JSX.Element {
  const t = useTranslations("invoices");
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The one polite live region for this list (list-pages.md a11y
  // invariants): result count after a filter commit, "N selected"
  // (debounced) while a selection is active.
  const [announced, setAnnounced] = useState("");

  const selectedCount = selected.size;
  const allSelected = invoices.length > 0 && selectedCount === invoices.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    const id = setTimeout(() => {
      setAnnounced(
        selectedCount > 0
          ? t("liveSelected", { count: selectedCount })
          : totalCount === 0
            ? // Mirror the visible empty-state title so sighted +
              // SR users get the same story.
              t(filtersActive ? "emptyFilteredTitle" : "emptyTitle")
            : t("liveResultCount", { count: totalCount }),
      );
    }, 400);
    return () => clearTimeout(id);
  }, [selectedCount, totalCount, filtersActive, t]);

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

  // Escape clears the selection — but not when focus sits in a
  // text-editing control (there Escape means "cancel my editing").
  // Checkboxes are inputs too, so the guard is semantic, not
  // tagName === "INPUT" (list-pages.md rule 5).
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

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  // The strip master input stays mounted across selection changes, so
  // it's a stable focus target after the confirm cluster unmounts.
  const stripMasterNodeRef = useRef<HTMLInputElement | null>(null);

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
        // Clearing the selection unmounts the Mark-paid controls —
        // park keyboard focus on the surviving strip master instead
        // of letting it fall to <body>.
        stripMasterNodeRef.current?.focus();
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
      stripMasterNodeRef.current = node;
      if (node) node.indeterminate = someSelected;
    },
    [someSelected],
  );

  const liveRegion = (
    <div role="status" aria-live="polite" className="sr-only">
      {announced}
    </div>
  );

  if (invoices.length === 0) {
    // Filtered-empty ≠ first-run empty: with active filters the
    // onboarding copy would contradict reality — show a no-matches
    // state instead (the page renders the Clear-all hint below).
    return (
      <>
        {liveRegion}
        <div className="mt-6 rounded-lg border border-edge bg-surface-raised p-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
            <FileText size={20} className="text-accent" aria-hidden="true" />
          </div>
          <h3 className="text-body-lg font-medium text-content">
            {t(filtersActive ? "emptyFilteredTitle" : "emptyTitle")}
          </h3>
          <p className="mt-1 text-caption text-content-muted max-w-md mx-auto">
            {t(filtersActive ? "emptyFilteredDescription" : "emptyDescription")}
          </p>
        </div>
      </>
    );
  }

  return (
    <div className={`mt-4 ${tableWrapperClass}`}>
      {liveRegion}
      <div
        role="toolbar"
        aria-label={t("bulkToolbarAriaLabel")}
        className="flex items-center gap-3 px-4 py-2 bg-surface-inset border-b border-edge"
      >
        {/* p-1/-m-1 label pads the 16px box to a ≥24px hit area with
            zero layout shift (list-pages.md rule 4). */}
        <label className="inline-flex items-center justify-center p-1 -m-1 cursor-pointer">
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
        </label>
        {selectedCount > 0 ? (
          <>
            <span className="text-caption text-content-secondary">
              {t("bulkSelectedLabel", {
                count: selectedCount,
                total: invoices.length,
              })}
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-caption text-content-secondary hover:text-content hover:underline"
            >
              {t("bulkClear")}
            </button>
            <div className="ml-auto">
              <InlineMarkPaidButton
                count={selectedCount}
                enabled={canMarkPaid}
                onConfirm={onMarkPaid}
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
          <col style={{ width: "120px" }} />
          <col style={{ width: "120px" }} />
          <col style={{ width: "120px" }} />
        </colgroup>
        <thead>
          <tr className={tableHeaderRowClass}>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              <label className="inline-flex items-center justify-center p-1 -m-1 cursor-pointer">
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
              </label>
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("table.invoiceNumber")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("table.team")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("table.customer")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("table.issuedDate")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-right`}>
              {t("table.total")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
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
                className={
                  isSelected
                    ? "border-b border-edge last:border-0 transition-colors bg-accent-soft/30"
                    : tableBodyRowClass
                }
              >
                <td className="px-4 py-3">
                  <label className="inline-flex items-center justify-center p-1 -m-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(inv.id)}
                      className={checkboxClass}
                      aria-label={t("bulkRowAria", {
                        number: inv.invoice_number,
                      })}
                    />
                  </label>
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
                      // labelMode="label" puts the tooltip text on the
                      // trigger as its accessible name (icon-only
                      // trigger); tabIndex makes it keyboard-reachable
                      // so the tooltip opens on focus, not hover-only.
                      <Tooltip label={importedTooltip} labelMode="label">
                        <span
                          role="img"
                          tabIndex={0}
                          className="inline-flex items-center text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
                        >
                          <Download size={12} aria-hidden="true" />
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </td>
                <td className={`${tableBodyCellClass} text-caption`}>
                  {teamNameById.get(inv.team_id) ?? "—"}
                </td>
                <td className={tableBodyCellClass}>
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    {inv.customers?.id ? (
                      <CustomerChip
                        customerId={inv.customers.id}
                        customerName={inv.customers.name}
                        logoUrl={inv.customers.logo_url}
                        size={24}
                      />
                    ) : null}
                    <span className="truncate">{customerName}</span>
                  </span>
                </td>
                <td className={`${tableBodyCellClass} text-caption`}>
                  {formatDisplayDate(inv.issued_date)}
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

/**
 * Tier-1 inline confirm for the bulk "Mark paid" flip (reversible
 * one-way transition → inline [Confirm][Cancel], per list-pages.md
 * rule 5 and the destructive-flow tiers). Two-state UI:
 *
 *   idle  → [CheckCircle] Mark N paid   (bulkStripButtonClass —
 *           neutral chrome, intent via the colored icon)
 *   armed → "Mark N paid? [Confirm][X]"
 *
 * When the selection is ineligible the idle button stays focusable
 * with `aria-disabled` + an explanatory tooltip; the click handler
 * guards instead of `disabled` so keyboard + AT users can reach the
 * reason.
 */
function InlineMarkPaidButton({
  count,
  enabled,
  onConfirm,
}: {
  count: number;
  enabled: boolean;
  onConfirm: () => void;
}): React.JSX.Element {
  const t = useTranslations("invoices");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Focus intent for the NEXT render — arming/collapsing swaps the
  // focused element out of the DOM, so focus must be re-parked after
  // React commits ("confirm" on arm, "trigger" on cancel/Escape).
  // A ref, not state: focus() is a side effect, not render data.
  const pendingFocus = useRef<"confirm" | "trigger" | null>(null);

  useEffect(() => {
    if (pendingFocus.current === "confirm" && open) {
      pendingFocus.current = null;
      confirmRef.current?.focus();
    } else if (pendingFocus.current === "trigger" && !open) {
      pendingFocus.current = null;
      triggerRef.current?.focus();
    }
  });

  // Collapse when the selection changes size or becomes ineligible —
  // the confirm question ("Mark N paid?") must never go stale.
  // Render-time adjustment per React's "adjusting state when props
  // change" guidance (an effect would lint as set-state-in-effect).
  const [prevSelection, setPrevSelection] = useState({ count, enabled });
  if (prevSelection.count !== count || prevSelection.enabled !== enabled) {
    setPrevSelection({ count, enabled });
    if (open) setOpen(false);
  }

  const cancel = useCallback((): void => {
    pendingFocus.current = "trigger";
    setOpen(false);
  }, []);

  // Escape collapses the armed cluster. Capture + stopPropagation so
  // the same keypress doesn't also clear the table selection — an
  // open confirm is the more specific overlay (list-pages.md rule 5).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, cancel]);

  if (!open) {
    const idleButton = (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!enabled) return;
          pendingFocus.current = "confirm";
          setOpen(true);
        }}
        aria-disabled={!enabled}
        className={`${bulkStripButtonClass} ${
          enabled ? "" : "opacity-50"
        }`}
      >
        <CheckCircle
          size={14}
          className="text-success"
          aria-hidden="true"
        />
        {t("bulkMarkPaid", { count })}
      </button>
    );
    // Tooltip only when ineligible — when enabled it would just
    // repeat the button's visible label (double-announce for SRs).
    if (enabled) return idleButton;
    return (
      <Tooltip label={t("bulkMarkPaidIneligibleHint")}>{idleButton}</Tooltip>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("bulkMarkPaid", { count })}
      className="inline-flex items-center gap-2 rounded-md border border-edge bg-surface-raised px-2 py-1"
    >
      <span className="text-caption text-content whitespace-nowrap">
        {t("bulkMarkPaidConfirm", { count })}
      </span>
      <button
        ref={confirmRef}
        type="button"
        onClick={() => {
          // On error the idle button re-mounts and should get focus
          // back; on success the parent parks focus on the strip
          // master (this whole cluster unmounts with the selection).
          pendingFocus.current = "trigger";
          setOpen(false);
          onConfirm();
        }}
        className="inline-flex items-center gap-1 rounded bg-accent px-2.5 py-0.5 text-caption font-semibold text-content-inverse hover:opacity-90 transition-opacity"
      >
        <CheckCircle size={12} aria-hidden="true" />
        {t("bulkMarkPaidConfirmCta")}
      </button>
      <button
        type="button"
        onClick={cancel}
        aria-label={t("bulkMarkPaidCancel")}
        className="rounded p-0.5 text-content-muted hover:bg-hover transition-colors"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
