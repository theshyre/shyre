"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileSignature, Trash2, X, PackageCheck } from "lucide-react";
import { CustomerChip } from "@theshyre/ui";
import { PaginationFooter } from "@/components/PaginationFooter";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { checkboxClass } from "@/lib/form-styles";
import {
  tableClass,
  tableWrapperClass,
  tableHeaderRowClass,
  tableHeaderCellClass,
  tableBodyRowClass,
  tableBodyCellClass,
  bulkStripButtonClass,
  bulkStripDangerButtonClass,
} from "@/lib/table-styles";
import { isTextEditingTarget } from "@/lib/is-text-editing-target";
import { formatDisplayDate } from "@/lib/format-date";
import { formatCurrency } from "@/lib/invoice-utils";
import {
  daysSinceIsoDate,
  displayProposalTotal,
  isProposalExpired,
  type SignoffProgress,
} from "@/lib/proposals/list-view";
import {
  isProposalDeletable,
  isProposalDeliverable,
} from "@/lib/proposals/allow-lists";
import { ProposalStatusBadge } from "./proposal-status-badge";
import {
  bulkDeleteProposalsAction,
  bulkMarkProposalsDeliveredAction,
  bulkReopenProposalsDeliveredAction,
} from "./actions";

export interface ProposalRow {
  id: string;
  proposal_number: string;
  title: string;
  status: string;
  issued_date: string | null;
  valid_until: string | null;
  currency: string;
  customer: { id: string; name: string; logo_url: string | null } | null;
  /** Sum of top-level line-item fixed prices (computed by the page). */
  total: number;
  /** The client-authorized subset total, once accepted. Null until then. */
  accepted_total: number | null;
  /** True when a converted proposal has been marked delivered
   *  (`delivered_at` stamped) — drives the "Delivered" badge projection. */
  delivered: boolean;
  /** Read-time "N of M signed" projection for an in-flight multi-signer
   *  proposal (via `partialSignoffProgress`); null when it doesn't apply. */
  signoff: SignoffProgress | null;
}

interface Props {
  proposals: ProposalRow[];
  /** Rows matching the current filter (server-side count) — drives
   *  the load-more footer. */
  totalCount: number;
  /** Local YYYY-MM-DD — passed in so read-time expiry + aging agree
   *  with the page's outstanding rollup. */
  today: string;
}

/**
 * Proposal list table — Pattern A (overlay strip), per
 * docs/reference/multi-select-tables.md: the six columns here are
 * restate-able ("Number", "Title", "Customer", "Status", "Total",
 * "Issued") so the bulk strip visually replaces the header row rather
 * than sitting as a sibling above it (reference: /time-entries'
 * `entry-table.tsx`).
 *
 * Only draft/superseded proposals are bulk-deletable
 * (`isProposalDeletable`) — sent/viewed/accepted/declined/converted
 * rows are the audit record. Rather than allow selecting an
 * ineligible row and reporting a "skipped" count after the fact, the
 * row checkbox itself is disabled with an explanatory tooltip
 * (`showOnDisabled` keeps it keyboard-discoverable) — the cleaner of
 * the two honest options the spec allows, since it never lets the
 * user arm a delete they can't complete. `bulkDeleteProposalsAction`
 * still re-checks every id server-side (never trusts the client), so
 * a stale selection — a row's status changed between page load and
 * the click — degrades to an honest `{ deleted, skipped }` toast
 * instead of a silent partial success.
 */
export function ProposalsTable({
  proposals,
  totalCount,
  today,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals");
  const tb = useTranslations("proposals.bulk");
  const tCommon = useTranslations("common.actions");
  const toast = useToast();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // A row is selectable if EITHER bulk action can touch it: delete
  // (draft/superseded) OR mark-delivered (converted + not yet delivered).
  // The two eligibility sets are disjoint, so the strip offers whichever
  // action(s) the current selection actually contains. The master checkbox
  // and select-all operate over this union, not every visible row.
  const selectableIds = useMemo(
    () =>
      proposals
        .filter(
          (p) =>
            isProposalDeletable(p.status) ||
            isProposalDeliverable(p.status, p.delivered),
        )
        .map((p) => p.id),
    [proposals],
  );

  const proposalById = useMemo(
    () => new Map(proposals.map((p) => [p.id, p])),
    [proposals],
  );
  // The eligible subset of the current selection, per action. Each bulk
  // button acts on (and counts) only its own subset; the server re-checks.
  const selectedDeletableIds = useMemo(
    () =>
      Array.from(selectedIds).filter((id) =>
        isProposalDeletable(proposalById.get(id)?.status),
      ),
    [selectedIds, proposalById],
  );
  const selectedDeliverableIds = useMemo(
    () =>
      Array.from(selectedIds).filter((id) => {
        const p = proposalById.get(id);
        return p != null && isProposalDeliverable(p.status, p.delivered);
      }),
    [selectedIds, proposalById],
  );

  const someSelected = selectedIds.size > 0;
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  // Measure the header row's rendered height so the bulk-action strip can
  // overlay it pixel-perfectly across Compact / Regular / Large text-size
  // preferences (docs/reference/multi-select-tables.md Pattern A).
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [theadHeight, setTheadHeight] = useState<number>(0);
  useEffect(() => {
    const el = theadRef.current;
    if (!el) return;
    const update = (): void => setTheadHeight(el.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size > 0 ? new Set() : new Set(selectableIds)));
  }, [selectableIds]);

  // sr-only polite live region — "N selected" (debounced), per the
  // list-pages.md a11y invariant.
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      setAnnounced(someSelected ? tb("liveSelected", { count: selectedIds.size }) : "");
    }, 400);
    return () => clearTimeout(id);
  }, [selectedIds, someSelected, tb]);

  // Pattern-A focus handoff (list-pages.md rule 4), both directions —
  // mirrors entry-table.tsx exactly. Start (0→N): the thead goes
  // aria-hidden and its master checkbox drops to tabIndex -1 — if focus
  // is sitting on that master, it moves to the surviving strip master.
  // End (N→0): the strip unmounts; if it held focus (already fallen to
  // <body> by the time this effect runs), hand it back to the thead
  // master so Tab doesn't restart from the top of the document.
  const theadMasterRef = useRef<HTMLInputElement | null>(null);
  const stripMasterRef = useRef<HTMLInputElement | null>(null);
  const prevSomeSelectedRef = useRef(false);
  useEffect(() => {
    const was = prevSomeSelectedRef.current;
    prevSomeSelectedRef.current = someSelected;
    const active = document.activeElement;
    if (someSelected && !was) {
      if (active && theadRef.current?.contains(active)) {
        stripMasterRef.current?.focus();
      }
    } else if (!someSelected && was) {
      if (!active || active === document.body) {
        theadMasterRef.current?.focus();
      }
    }
  }, [someSelected]);

  // Escape clears an active selection — skipped while focus sits in a
  // text-editing control (list-pages.md rule 5); the armed typed-delete
  // input intercepts + stops propagation itself as the more specific
  // overlay.
  useEffect(() => {
    if (!someSelected) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      if (isTextEditingTarget(e.target)) return;
      setSelectedIds(new Set());
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [someSelected]);

  const bulkDelete = useCallback(async () => {
    const ids = selectedDeletableIds;
    if (ids.length === 0) return;
    const fd = new FormData();
    for (const id of ids) fd.append("id", id);
    const result = await bulkDeleteProposalsAction(fd);
    if (!result.success) {
      const message =
        result.error.message ?? result.error.userMessageKey ?? tb("deleteFailed");
      toast.push({ kind: "error", message });
      throw new Error(message);
    }
    setSelectedIds(new Set());
    toast.push({
      kind: "success",
      message:
        result.skipped > 0
          ? tb("deleteResultWithSkipped", {
              deleted: result.deleted,
              skipped: result.skipped,
            })
          : tb("deleteResult", { count: result.deleted }),
    });
  }, [selectedDeletableIds, toast, tb]);

  const bulkMarkDelivered = useCallback(async () => {
    const ids = selectedDeliverableIds;
    if (ids.length === 0) return;
    const fd = new FormData();
    for (const id of ids) fd.append("id", id);
    const result = await bulkMarkProposalsDeliveredAction(fd);
    if (!result.success) {
      const message = result.error.message ?? tb("markDeliveredFailed");
      toast.push({ kind: "error", message });
      throw new Error(message);
    }
    setSelectedIds(new Set());
    toast.push({
      kind: "success",
      message: tb("markDeliveredResult", { count: ids.length }),
      actionLabel: tCommon("undo"),
      onAction: async () => {
        const undoFd = new FormData();
        for (const id of ids) undoFd.append("id", id);
        const undo = await bulkReopenProposalsDeliveredAction(undoFd);
        toast.push(
          undo.success
            ? { kind: "success", message: tb("reopenedResult", { count: ids.length }) }
            : {
                kind: "error",
                message: undo.error.message ?? tb("reopenFailed"),
              },
        );
      },
    });
  }, [selectedDeliverableIds, toast, tb, tCommon]);

  const liveRegion = (
    <div role="status" aria-live="polite" className="sr-only">
      {announced}
    </div>
  );

  if (proposals.length === 0) {
    // Bordered-card + icon-circle empty state — the one list-page
    // treatment (docs/reference/list-pages.md rule 6; reference:
    // invoices-table.tsx).
    return (
      <div className="mt-[16px] rounded-lg border border-edge bg-surface-raised p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
          <FileSignature size={20} className="text-accent" aria-hidden="true" />
        </div>
        <h3 className="text-body-lg font-medium text-content">
          {t("empty.heading")}
        </h3>
        <p className="mt-1 text-caption text-content-muted max-w-md mx-auto">
          {t("empty.body")}
        </p>
      </div>
    );
  }

  return (
    <div className={`relative mt-[16px] ${tableWrapperClass}`}>
      {liveRegion}
      <div className="overflow-x-auto">
        <table className={`${tableClass} table-fixed`}>
          {/* Column-width lock (docs/reference/multi-select-tables.md,
              common rule 1): table-fixed + an explicit <colgroup> so
              selecting rows never reflows column widths. Title has no
              declared width — it absorbs the remaining space and its
              cell content truncates instead of wrapping. */}
          <colgroup>
            <col style={{ width: 40 }} />
            <col style={{ width: 148 }} />
            <col />
            <col style={{ width: 200 }} />
            <col style={{ width: 176 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 148 }} />
          </colgroup>
          {/* Column headers stay mounted at all times. When a selection
              is active the bulk strip overlays this row visually, but
              the <th> cells remain the authoritative source of column
              widths so toggling selection never shifts layout. AT
              hears the toolbar instead of stale headers via
              aria-hidden. */}
          <thead
            ref={theadRef}
            className={tableHeaderRowClass}
            aria-hidden={someSelected || undefined}
          >
            <tr>
              <th scope="col" className={`${tableHeaderCellClass} text-left`}>
                {/* ≥24px hit area (list-pages.md rule 4). */}
                <label className="-m-1 flex h-6 w-6 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={selectableIds.length === 0}
                    ref={(el) => {
                      theadMasterRef.current = el;
                      if (el) el.indeterminate = !allSelected && someSelected;
                    }}
                    onChange={toggleAll}
                    aria-label={allSelected ? tb("deselectAll") : tb("selectAll")}
                    tabIndex={someSelected ? -1 : 0}
                    className={checkboxClass}
                  />
                </label>
              </th>
              <th scope="col" className={tableHeaderCellClass}>
                {t("table.number")}
              </th>
              <th scope="col" className={tableHeaderCellClass}>
                {t("table.title")}
              </th>
              <th scope="col" className={tableHeaderCellClass}>
                {t("table.customer")}
              </th>
              <th scope="col" className={tableHeaderCellClass}>
                {t("table.status")}
              </th>
              <th scope="col" className={`${tableHeaderCellClass} text-right`}>
                {t("table.total")}
              </th>
              <th scope="col" className={tableHeaderCellClass}>
                {t("table.issued")}
              </th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => {
              const expired = isProposalExpired(p.status, p.valid_until, today);
              const inFlight = p.status === "sent" || p.status === "viewed";
              const sentDays = inFlight
                ? daysSinceIsoDate(p.issued_date, today)
                : null;
              const selectable =
                isProposalDeletable(p.status) ||
                isProposalDeliverable(p.status, p.delivered);
              const isSelected = selectable && selectedIds.has(p.id);
              return (
                <tr key={p.id} className={tableBodyRowClass}>
                  <td className="px-4 py-3">
                    <ProposalRowCheckbox
                      proposal={p}
                      selectable={selectable}
                      checked={isSelected}
                      onToggle={toggleOne}
                    />
                  </td>
                  <td className={`${tableBodyCellClass} font-mono text-caption`}>
                    <Link
                      href={`/proposals/${p.id}`}
                      className="text-accent hover:underline"
                    >
                      {p.proposal_number}
                    </Link>
                  </td>
                  <td className={`${tableBodyCellClass} text-content`}>
                    <Tooltip label={p.title}>
                      <Link
                        href={`/proposals/${p.id}`}
                        className="block truncate hover:underline"
                      >
                        {p.title}
                      </Link>
                    </Tooltip>
                  </td>
                  <td className={tableBodyCellClass}>
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <CustomerChip
                        customerId={p.customer?.id}
                        customerName={p.customer?.name}
                        logoUrl={p.customer?.logo_url ?? null}
                        size={24}
                      />
                      {p.customer ? (
                        <Tooltip label={p.customer.name}>
                          <span className="truncate">{p.customer.name}</span>
                        </Tooltip>
                      ) : (
                        <span>—</span>
                      )}
                    </span>
                  </td>
                  <td className={tableBodyCellClass}>
                    <ProposalStatusBadge
                      status={p.status}
                      expired={expired}
                      delivered={p.delivered}
                      signoff={p.signoff}
                    />
                  </td>
                  <td className={`${tableBodyCellClass} text-right font-mono`}>
                    {formatCurrency(
                      displayProposalTotal(p.status, p.total, p.accepted_total),
                      p.currency,
                    )}
                  </td>
                  <td className={tableBodyCellClass}>
                    {formatDisplayDate(p.issued_date)}
                    {/* Aging caption on in-flight rows — how long the
                        offer has been sitting unanswered. Skipped for
                        same-day sends (0d reads as noise). */}
                    {sentDays !== null && sentDays >= 1 && (
                      <span className="mt-0.5 block text-caption text-content-muted">
                        {t("list.sentDaysAgo", { days: sentDays })}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Bulk-action strip. Absolute-positioned over the header row so
          column widths stay owned by the <colgroup>; height is
          measured from the thead ref so Compact / Regular / Large
          text-size preferences all align. Same background as the
          thead, so the replacement reads as a mode change rather than
          a layout shift. */}
      {someSelected && (
        <div
          role="toolbar"
          aria-label={tb("toolbarLabel")}
          className="absolute left-0 right-0 top-0 z-10 flex items-center gap-4 bg-surface-inset border-b border-edge px-4"
          style={theadHeight > 0 ? { height: theadHeight } : undefined}
        >
          <label className="-m-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={selectableIds.length === 0}
              ref={(el) => {
                stripMasterRef.current = el;
                if (el) el.indeterminate = !allSelected && someSelected;
              }}
              onChange={toggleAll}
              aria-label={allSelected ? tb("deselectAll") : tb("selectAll")}
              className={checkboxClass}
            />
          </label>
          <span className="text-body font-medium text-accent-text">
            {tb("selectedCount", { count: selectedIds.size })}
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-caption text-content-secondary hover:text-content hover:underline"
          >
            {tb("clear")}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {selectedDeliverableIds.length > 0 && (
              <InlineBulkMarkDeliveredButton
                count={selectedDeliverableIds.length}
                onConfirm={bulkMarkDelivered}
              />
            )}
            {selectedDeletableIds.length > 0 && (
              <InlineBulkDeleteButton
                count={selectedDeletableIds.length}
                onConfirm={bulkDelete}
              />
            )}
          </div>
        </div>
      )}
      <PaginationFooter loaded={proposals.length} total={totalCount} />
    </div>
  );
}

/**
 * A single row's selection checkbox. A row is selectable when a bulk action
 * can touch it — deletable (draft/superseded) or deliverable (converted, not
 * yet delivered). Non-actionable rows (sent/viewed/accepted, or an already-
 * delivered converted deal) render a disabled checkbox wrapped in a
 * `showOnDisabled` Tooltip so the reason stays keyboard-discoverable even
 * though the control itself can't receive focus natively.
 */
function ProposalRowCheckbox({
  proposal,
  selectable,
  checked,
  onToggle,
}: {
  proposal: ProposalRow;
  selectable: boolean;
  checked: boolean;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const tb = useTranslations("proposals.bulk");

  if (selectable) {
    return (
      <label className="-m-1 flex h-6 w-6 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(proposal.id)}
          aria-label={tb("rowAria", { number: proposal.proposal_number })}
          className={checkboxClass}
        />
      </label>
    );
  }

  return (
    <Tooltip
      label={tb("rowLockedTooltip", { number: proposal.proposal_number })}
      labelMode="label"
      showOnDisabled
    >
      <label className="-m-1 flex h-6 w-6 cursor-not-allowed items-center justify-center">
        <input
          type="checkbox"
          checked={false}
          disabled
          className={`${checkboxClass} cursor-not-allowed opacity-50`}
        />
      </label>
    </Tooltip>
  );
}

/**
 * Non-destructive bulk "Mark delivered" — inline arm-then-confirm (NOT a
 * typed-delete; delivery is reversible via the Undo toast). Mirrors the
 * projects bulk close-out button. Two-state UI: idle → [Mark delivered];
 * armed → "Mark N delivered [Mark delivered][X]". Escape collapses the armed
 * cluster (capture + stopPropagation so it doesn't also clear the table
 * selection — an open confirm is the more specific overlay).
 */
function InlineBulkMarkDeliveredButton({
  count,
  onConfirm,
}: {
  count: number;
  onConfirm: () => void | Promise<void>;
}): React.JSX.Element {
  const tb = useTranslations("proposals.bulk");
  const tCommon = useTranslations("common.actions");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  async function fire(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // onConfirm already pushed the error toast; keep the confirm armed.
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={bulkStripButtonClass}
      >
        <PackageCheck size={14} aria-hidden="true" />
        <span>{tb("markDelivered")}</span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={tb("markDelivered")}
      className="inline-flex items-center gap-2 rounded-md border border-success/40 bg-success-soft px-2 py-1"
    >
      <span className="text-caption text-content whitespace-nowrap">
        {tb("markDeliveredPrompt", { count })}
      </span>
      <button
        type="button"
        onClick={() => void fire()}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded bg-success px-2.5 py-0.5 text-caption font-semibold text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        <PackageCheck size={12} aria-hidden="true" />
        {tb("markDeliveredConfirm")}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={pending}
        aria-label={tCommon("cancel")}
        className="rounded p-0.5 text-content-muted hover:bg-hover transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/**
 * Labeled typed-delete confirm for the bulk strip — the bulk-strip-
 * destructive flavor from docs/reference/multi-select-tables.md rule
 * 3 (canonical pattern: `InlineBulkDeleteButton` in
 * `time-entries/entry-table.tsx`). Proposals have no soft-delete or
 * Undo (the confirm word IS the safety gate, per the task spec), so
 * unlike the time-entries version this does NOT collapse back to idle
 * on failure — the typed word stays armed and pending resets so the
 * user can just click Delete again after reading the error toast,
 * instead of re-typing "delete" from scratch.
 *
 * Two-state UI: idle → [Trash] Delete (bulkStripDangerButtonClass);
 * armed → "Type delete to delete N proposals [input] [Delete] [X]".
 */
function InlineBulkDeleteButton({
  count,
  onConfirm,
}: {
  count: number;
  onConfirm: () => void | Promise<void>;
}): React.JSX.Element {
  const tb = useTranslations("proposals.bulk");
  const tCommon = useTranslations("common.actions");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // Escape collapses the armed cluster. Capture + stopPropagation so the
  // same keypress doesn't also clear the table selection — an open
  // confirm is the more specific overlay (list-pages.md rule 5).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setTyped("");
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  const canConfirm = typed.trim().toLowerCase() === "delete";

  async function fire(): Promise<void> {
    if (!canConfirm || pending) return;
    setPending(true);
    try {
      await onConfirm();
      // Collapse back to idle only on success — a failed bulk delete
      // keeps the typed confirm armed (the error toast already
      // explains why) so the user isn't forced to re-type "delete".
      setOpen(false);
      setTyped("");
    } catch {
      // onConfirm already pushed the error toast.
    } finally {
      setPending(false);
    }
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" && canConfirm && !pending) {
      e.preventDefault();
      void fire();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tb("delete")}
        className={bulkStripDangerButtonClass}
      >
        <Trash2 size={14} aria-hidden="true" />
        <span>{tCommon("delete")}</span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={tb("delete")}
      className="inline-flex items-center gap-2 rounded-md border border-error/40 bg-error-soft px-2 py-1"
    >
      <span className="text-caption text-content whitespace-nowrap">
        {tb("deletePrompt", { count })}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={handleInputKey}
        aria-label={tb("deleteInputLabel")}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={pending}
        className="w-20 rounded border border-edge bg-surface-raised px-1.5 py-0.5 text-caption font-mono outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30 disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => void fire()}
        disabled={!canConfirm || pending}
        aria-label={tCommon("confirmDelete")}
        className="inline-flex items-center gap-1 rounded bg-error px-2.5 py-0.5 text-caption font-semibold text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        <Trash2 size={12} aria-hidden="true" />
        {tCommon("delete")}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTyped("");
        }}
        disabled={pending}
        aria-label={tCommon("cancel")}
        className="rounded p-0.5 text-content-muted hover:bg-hover transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}
