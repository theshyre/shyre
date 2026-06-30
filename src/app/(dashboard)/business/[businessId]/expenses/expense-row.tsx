"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Trash2,
  Check,
  X,
  Split,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import { Spinner, Avatar, resolveAvatarUrl } from "@theshyre/ui";
import { Tooltip } from "@/components/Tooltip";
import { useFormAction } from "@/hooks/use-form-action";
import { useToast } from "@/components/Toast";
import {
  EditableCell,
  type EditableCellSelectOption,
} from "@/components/EditableCell";
import {
  updateExpenseFieldAction,
  deleteExpenseAction,
  restoreExpenseAction,
} from "./actions";
import { INVOICED_EDITABLE_EXPENSE_FIELDS } from "./expense-lock-helpers";
import { EXPENSE_CATEGORIES } from "./categories";
import {
  formatExpenseAmount,
  formatExpenseDateDisplay,
} from "./format-helpers";
import { SplitExpenseModal } from "./split-expense-modal";
import { ExpenseExpandedRow } from "./expense-expanded-row";
import type { ProjectOption } from "./page";

interface ExpenseRecord {
  id: string;
  team_id: string;
  user_id: string;
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
  external_reference: string | null;
  category: string;
  description: string | null;
  notes: string | null;
  project_id: string | null;
  billable: boolean;
  is_sample: boolean;
  projects: { id: string; name: string } | null;
  /** Phase-2 invoiced state — present when the row has landed on
   *  an invoice. When set, the actions column renders an "Invoiced
   *  #INV-…" chip (link to /invoices/<id>) in addition to / in
   *  place of the per-row buttons. Optional so older call sites
   *  that don't fetch these columns keep working unchanged. */
  invoiced?: boolean;
  invoice_id?: string | null;
  invoice_number?: string | null;
}

export interface ExpenseAuthor {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// formatDateDisplay + formatCurrency live in ./format-helpers as
// pure functions so they can be unit-tested without rendering React.

export function ExpenseRow({
  expense: expenseProp,
  author,
  projects,
  vendorOptions = [],
  teamName,
  columnCount,
  canEdit,
  selected,
  onToggleSelect,
  isExpanded,
  onToggleExpand,
  hideSelection = false,
}: {
  expense: ExpenseRecord;
  /** The submitter (avatar + name). Per CLAUDE.md "time-entry
   *  authorship" rule — extends to any user-authored entity. In
   *  the spreadsheet view we render avatar-only with the name in
   *  a tooltip to keep rows single-line. */
  author: ExpenseAuthor | null;
  projects: ProjectOption[];
  /** Distinct prior vendors → native <datalist> suggestions on the
   *  inline vendor cell and the expanded-row vendor field. Optional
   *  (defaults to []) so callers that don't source it still render a
   *  plain free-text cell. */
  vendorOptions?: string[];
  /** Set when the parent table is showing a team column (multi-team
   *  business). Null when there's only one team in scope and the
   *  column is hidden — the row drops the cell entirely so column
   *  count matches the header. */
  teamName: string | null;
  /** Number of columns in the parent table; the inline expansion
   *  uses it for `colSpan` so the panel stretches the full row. */
  columnCount: number;
  /** When true, the bulk-select checkbox cell is skipped. Project-
   *  page expense surface uses this — there's no bulk strip there,
   *  so the always-empty checkbox would be misleading. The parent's
   *  thead must omit the matching selection column header AND the
   *  caller should subtract 1 from columnCount so the expanded row's
   *  colSpan still matches. */
  hideSelection?: boolean;
  /** True when the viewer authored this expense OR is owner|admin
   *  on its team. Hides the Trash icon for non-authors and disables
   *  every editable cell so the UI matches the action-layer role
   *  gate (server still enforces the same — defense in depth). */
  canEdit: boolean;
  /** Whether this row is in the current bulk-select set. */
  selected: boolean;
  /** Toggle this row's id in/out of the bulk-select set. */
  onToggleSelect: (id: string) => void;
  /** Whether the inline detail panel is currently expanded. Owned
   *  by the parent table (purely client state — toggling is instant,
   *  no server roundtrip; the URL is shadowed via `replaceState`). */
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
}): React.JSX.Element {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const tToast = useTranslations("expenses.toast");
  const toast = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);

  // Optimistic overrides for inline-cell edits. updateExpenseFieldAction
  // deliberately skips revalidatePath (which re-renders the route and
  // yanks scroll to the top mid-list), so a committed value won't arrive
  // via a fresh `expense` prop — apply it locally so the cell updates in
  // place. Reset whenever a genuinely-new prop arrives (a server refetch
  // from a create / delete / bulk action that DOES revalidate), via
  // React's "adjust state during render" pattern, not a syncing effect.
  const [overrides, setOverrides] = useState<Partial<ExpenseRecord>>({});
  const [lastExpenseProp, setLastExpenseProp] = useState(expenseProp);
  if (expenseProp !== lastExpenseProp) {
    setLastExpenseProp(expenseProp);
    setOverrides({});
  }
  const expense: ExpenseRecord = { ...expenseProp, ...overrides };

  function applyOverride(field: string, value: string): void {
    setOverrides((prev) => {
      const next: Partial<ExpenseRecord> = { ...prev };
      switch (field) {
        case "amount":
          next.amount = Number(value);
          break;
        case "billable":
          next.billable = value === "true" || value === "on";
          break;
        case "incurred_on":
          next.incurred_on = value;
          break;
        case "vendor":
          next.vendor = value.trim() || null;
          break;
        case "external_reference":
          next.external_reference = value.trim() || null;
          break;
        case "category":
          next.category = value;
          break;
        case "description":
          next.description = value.trim() || null;
          break;
        case "notes":
          next.notes = value.trim() || null;
          break;
        case "project_id": {
          const pid = value || null;
          next.project_id = pid;
          const proj = pid ? projects.find((p) => p.id === pid) : null;
          next.projects = proj ? { id: proj.id, name: proj.name } : null;
          break;
        }
      }
      return next;
    });
  }

  // Field-level invoice lock: an invoiced expense keeps its metadata
  // (external_reference / description / notes / vendor / category)
  // editable — the invoice snapshots the expense, so these can't
  // mutate it — but the financial fields it depends on (amount,
  // currency, incurred_on, project_id, billable) are read-only. A
  // locked cell renders read-only with a Lock icon + "on invoice #X"
  // reason (via EditableCell's disabledReason) instead of silently
  // erroring on edit. Mirrors the action + DB-trigger boundary.
  const isInvoiced = expense.invoiced === true;
  const lockedReason = t("lockedFieldReason", {
    number: expense.invoice_number ?? "—",
  });
  const fieldEditable = (field: string): boolean =>
    canEdit && (!isInvoiced || INVOICED_EDITABLE_EXPENSE_FIELDS.has(field));
  const fieldLockReason = (field: string): string | undefined =>
    isInvoiced && !INVOICED_EDITABLE_EXPENSE_FIELDS.has(field)
      ? lockedReason
      : undefined;

  function toggleExpand(): void {
    onToggleExpand(expense.id);
  }

  const del = useFormAction({
    action: deleteExpenseAction,
    onSuccess: () => {
      setConfirmingDelete(false);
      toast.push({
        kind: "info",
        message: tToast("deleted"),
        actionLabel: tToast("undo"),
        durationMs: 10_000,
        onAction: async () => {
          const fd = new FormData();
          fd.set("id", expense.id);
          await restoreExpenseAction(fd);
        },
      });
    },
  });

  /** Single-field commit — wraps the partial action and surfaces
   *  the rejection up to the EditableCell so the cell renders the
   *  inline error border + tooltip. Returning a rejected promise is
   *  how the cell knows the save failed. */
  const commitField = async (
    field: string,
    value: string,
  ): Promise<void> => {
    const fd = new FormData();
    fd.set("id", expense.id);
    fd.set("field", field);
    fd.set("value", value);
    const result = await updateExpenseFieldAction(fd);
    if (result && "success" in result && !result.success) {
      throw new Error(result.error.userMessageKey);
    }
    // Reflect the saved value locally (no route revalidation) so the
    // cell stays on the new value instead of reverting to the stale prop.
    applyOverride(field, value);
  };

  const categoryOptions: EditableCellSelectOption[] = EXPENSE_CATEGORIES.map(
    (c) => ({ value: c, label: t(`categories.${c}`) }),
  );

  const projectOptions: EditableCellSelectOption[] = [
    { value: "", label: t("noProject") },
    ...projects
      .filter((p) => p.team_id === expense.team_id)
      .map((p) => ({ value: p.id, label: p.name })),
  ];

  const vendorLabel = expense.vendor ?? "";
  const ariaIdent = vendorLabel || t(`categories.${expense.category}`);

  const expandLabel = isExpanded
    ? t("ariaActions.collapseDetail", { vendor: ariaIdent })
    : t("ariaActions.expandDetail", { vendor: ariaIdent });

  // Shared expand/collapse control — rendered for normal rows AND
  // invoiced rows (an invoiced row is now partially editable, so the
  // user must be able to open its editor to change metadata).
  const expandButton = (
    <Tooltip label={expandLabel} labelMode="label">
      <button
        type="button"
        onClick={toggleExpand}
        aria-expanded={isExpanded}
        className="inline-flex items-center rounded-md p-1 text-content-secondary hover:bg-hover hover:text-content"
        aria-label={expandLabel}
      >
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </Tooltip>
  );

  // Double-click anywhere on the row (except an interactive control or
  // an editable cell) opens the inline editor — a more discoverable
  // path than hunting for the chevron. The guard keeps a double-click
  // on a cell/checkbox/button doing its own thing.
  function handleRowDoubleClick(e: React.MouseEvent<HTMLTableRowElement>): void {
    if (
      (e.target as HTMLElement).closest(
        'button, a, input, textarea, select, label, [role="button"]',
      )
    ) {
      return;
    }
    toggleExpand();
  }

  return (
    <>
    <tr
      onDoubleClick={handleRowDoubleClick}
      className={`border-b border-edge last:border-0 hover:bg-hover transition-colors ${
        selected ? "bg-accent-soft/30" : ""
      } ${isExpanded ? "bg-accent-soft/40 hover:bg-accent-soft/40" : ""}`}
    >
      {/* Selection checkbox — wrapped in a min-h-[1.75rem]
          flex container so the checkbox shares the same line-box
          as the EditableCell button next to it (which has the
          same min-h). Without this the checkbox hugs the td's
          padding-top while the cell text sits ~6px lower inside
          its button's line-box, leaving a visible vertical gap.
          Skipped entirely when hideSelection is set (project page
          surface — no bulk strip there). */}
      {!hideSelection && (
        <td className="w-10">
          <span className="flex min-h-[1.75rem] items-center">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(expense.id)}
              aria-label={t("bulk.selectRow", { vendor: ariaIdent })}
              className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
            />
          </span>
        </td>
      )}

      {/* Date */}
      <td className="text-content-secondary tabular-nums">
        <EditableCell
          variant="date"
          value={expense.incurred_on}
          displayNode={formatExpenseDateDisplay(expense.incurred_on)}
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.incurredOn"),
          })}
          onCommit={(v) => commitField("incurred_on", v)}
          disabled={!fieldEditable("incurred_on")}
          disabledReason={fieldLockReason("incurred_on")}
        />
      </td>

      {/* Amount — placed early so the most-scanned value sits in
          the same saccade as the date (per ux-designer review). */}
      <td className="text-left tabular-nums text-content">
        <EditableCell
          variant="number"
          value={expense.amount.toFixed(2)}
          displayNode={formatExpenseAmount(expense.amount, expense.currency)}
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.amount"),
          })}
          onCommit={(v) => commitField("amount", v)}
          disabled={!fieldEditable("amount")}
          disabledReason={fieldLockReason("amount")}
          min={0}
          step={0.01}
        />
      </td>

      {/* Category */}
      <td>
        <div className="flex items-center gap-1.5">
          <EditableCell
            variant="select"
            value={expense.category}
            displayNode={
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium ${
                  // "other" gets the warning tint so post-import bulk
                  // recategorize work is visually obvious. Other
                  // categories use the muted surface-inset chip.
                  expense.category === "other"
                    ? "bg-warning-soft text-warning-text"
                    : "bg-surface-inset text-content-secondary"
                }`}
              >
                {t(`categories.${expense.category}`)}
              </span>
            }
            options={categoryOptions}
            ariaLabel={t("ariaActions.editField", {
              vendor: ariaIdent,
              field: t("fields.category"),
            })}
            onCommit={(v) => commitField("category", v)}
            disabled={!fieldEditable("category")}
            disabledReason={fieldLockReason("category")}
          />
          {expense.is_sample && (
            <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-label font-medium text-accent">
              {t("sampleTag")}
            </span>
          )}
        </div>
      </td>

      {/* Team (conditional) — column width owned by the
          <colgroup> in expenses-table.tsx. */}
      {teamName !== null && (
        <td className="text-content-secondary truncate">
          <Tooltip label={teamName} labelMode="label">
            <span className="block truncate">{teamName}</span>
          </Tooltip>
        </td>
      )}

      {/* Vendor */}
      <td className="text-content-secondary">
        <EditableCell
          variant="text"
          value={vendorLabel}
          suggestions={vendorOptions}
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.vendor"),
          })}
          onCommit={(v) => commitField("vendor", v)}
          disabled={!fieldEditable("vendor")}
          disabledReason={fieldLockReason("vendor")}
          placeholder="—"
          className="truncate"
        />
      </td>

      {/* Description — soft-clamp to 2 lines (line-clamp-2) so the
          user can read more inline without a hover-tooltip dance.
          Row height grows to a max of 2 lines for cells with long
          content; short cells still occupy 1 line. */}
      <td className="text-content-secondary">
        <EditableCell
          variant="textarea"
          value={expense.description ?? ""}
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.description"),
          })}
          onCommit={(v) => commitField("description", v)}
          disabled={!fieldEditable("description")}
          disabledReason={fieldLockReason("description")}
          placeholder="—"
          displayNode={
            expense.description ? (
              <span className="block line-clamp-2 break-words">
                {expense.description}
              </span>
            ) : (
              <span className="text-content-muted">—</span>
            )
          }
        />
      </td>

      {/* Reference # (external_reference) — replaces the Notes column
          in the dense table; Notes stays in the expanded editor and in
          free-text search. Metadata: editable even on an invoiced row. */}
      <td className="text-content-secondary">
        <EditableCell
          variant="text"
          value={expense.external_reference ?? ""}
          suggestions={[]}
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.externalReference"),
          })}
          onCommit={(v) => commitField("external_reference", v)}
          disabled={!fieldEditable("external_reference")}
          disabledReason={fieldLockReason("external_reference")}
          placeholder="—"
          className="truncate"
          displayNode={
            expense.external_reference ? (
              <span className="block truncate font-mono text-caption">
                {expense.external_reference}
              </span>
            ) : (
              <span className="text-content-muted">—</span>
            )
          }
        />
      </td>

      {/* Project */}
      <td className="text-content-secondary">
        <div className="flex items-center gap-1.5">
          <EditableCell
            variant="select"
            value={expense.project_id ?? ""}
            displayNode={
              expense.projects?.name ? (
                <span className="block truncate">{expense.projects.name}</span>
              ) : (
                <span className="text-content-muted">—</span>
              )
            }
            options={projectOptions}
            ariaLabel={t("ariaActions.editField", {
              vendor: ariaIdent,
              field: t("fields.project"),
            })}
            onCommit={(v) => commitField("project_id", v)}
            disabled={!fieldEditable("project_id")}
            disabledReason={fieldLockReason("project_id")}
            className="truncate"
          />
          {expense.billable && (
            <Tooltip label={t("fields.billable")} labelMode="label">
              <span className="inline-flex items-center rounded-full bg-success-soft px-1.5 py-0.5 text-label font-semibold uppercase tracking-wider text-success-text">
                {t("billableShort")}
              </span>
            </Tooltip>
          )}
        </div>
      </td>

      {/* Author (avatar only, name on tooltip) */}
      <td>
        {author ? (
          <Tooltip
            label={author.displayName ?? author.userId.slice(0, 8)}
            labelMode="label"
          >
            <span className="inline-flex">
              <Avatar
                avatarUrl={resolveAvatarUrl(author.avatarUrl, author.userId)}
                displayName={author.displayName ?? ""}
                size={20}
              />
            </span>
          </Tooltip>
        ) : (
          <span className="text-content-muted">—</span>
        )}
      </td>

      {/* Actions (split + delete; edit is per-cell). When the row
          is invoiced (phase-2 lock), the action cluster collapses
          to a single "Invoiced #INV-…" chip linking to the parent
          invoice — every other affordance is suppressed because
          the action layer + DB trigger would refuse the write. */}
      <td className="text-left">
        {expense.invoiced && expense.invoice_id ? (
          <div className="inline-flex items-center gap-1">
            <Tooltip
              label={t("ariaActions.invoicedTooltip", {
                number: expense.invoice_number ?? "",
              })}
              labelMode="label"
            >
              <Link
                href={`/invoices/${expense.invoice_id}`}
                className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-label font-semibold uppercase tracking-wider text-accent-text hover:opacity-90"
                aria-label={t("ariaActions.invoicedTooltip", {
                  number: expense.invoice_number ?? "",
                })}
              >
                <FileText size={12} aria-hidden="true" />
                {expense.invoice_number
                  ? t("ariaActions.invoicedBadge", {
                      number: expense.invoice_number,
                    })
                  : t("ariaActions.invoicedBadgeUnknown")}
              </Link>
            </Tooltip>
            {expandButton}
          </div>
        ) : !canEdit ? (
          <span aria-hidden="true" />
        ) : confirmingDelete ? (
          <form
            action={del.handleSubmit}
            className="inline-flex items-center gap-1"
          >
            <input type="hidden" name="id" value={expense.id} />
            <Tooltip label={t("confirmDelete")} labelMode="label">
              <button
                type="submit"
                disabled={del.pending}
                className="inline-flex items-center gap-1 rounded-md bg-error px-2 py-1 text-caption font-medium text-content-inverse hover:opacity-90 disabled:opacity-50 transition-opacity"
                aria-label={t("confirmDelete")}
              >
                {del.pending ? (
                  <Spinner size="h-3 w-3" />
                ) : (
                  <Check size={12} />
                )}
              </button>
            </Tooltip>
            <Tooltip label={tc("actions.cancel")} labelMode="label">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={del.pending}
                className="inline-flex items-center rounded-md p-1 text-content-muted hover:bg-hover"
                aria-label={tc("actions.cancel")}
              >
                <X size={12} />
              </button>
            </Tooltip>
          </form>
        ) : (
          <div className="inline-flex items-center gap-0.5">
            {expandButton}
            <Tooltip
              label={t("ariaActions.split", { vendor: ariaIdent })}
              labelMode="label"
            >
              <button
                type="button"
                onClick={() => setSplitOpen(true)}
                className="inline-flex items-center rounded-md p-1 text-content-secondary hover:bg-hover hover:text-content"
                aria-label={t("ariaActions.split", { vendor: ariaIdent })}
              >
                <Split size={14} />
              </button>
            </Tooltip>
            <Tooltip
              label={t("ariaActions.delete", { vendor: ariaIdent })}
              labelMode="label"
            >
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center rounded-md p-1 text-content-secondary hover:bg-hover hover:text-error"
                aria-label={t("ariaActions.delete", { vendor: ariaIdent })}
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </div>
        )}
      </td>
      {/* Modal portals into document.body — see SplitExpenseModal.
          Mounted as a child of <tr> only so unmount tracks the
          row; the actual DOM lives at body level. */}
      {splitOpen && (
        <SplitExpenseModal
          expenseId={expense.id}
          originalAmount={expense.amount}
          originalCurrency={expense.currency}
          originalCategory={expense.category}
          originalNotes={expense.notes}
          onClose={() => setSplitOpen(false)}
        />
      )}
    </tr>
    {isExpanded && (
      <ExpenseExpandedRow
        expense={expense}
        projects={projects}
        vendorOptions={vendorOptions}
        columnCount={columnCount}
        canEdit={canEdit}
        onClose={toggleExpand}
        onFieldCommitted={applyOverride}
      />
    )}
    </>
  );
}
