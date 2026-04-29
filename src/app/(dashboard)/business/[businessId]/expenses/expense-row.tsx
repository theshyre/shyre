"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Check, X } from "lucide-react";
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
import { EXPENSE_CATEGORIES } from "./categories";
import {
  formatExpenseAmount,
  formatExpenseDateDisplay,
} from "./format-helpers";
import type { ProjectOption } from "./page";

interface ExpenseRecord {
  id: string;
  team_id: string;
  user_id: string;
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
  category: string;
  description: string | null;
  notes: string | null;
  project_id: string | null;
  billable: boolean;
  is_sample: boolean;
  projects: { id: string; name: string } | null;
}

export interface ExpenseAuthor {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// formatDateDisplay + formatCurrency live in ./format-helpers as
// pure functions so they can be unit-tested without rendering React.

export function ExpenseRow({
  expense,
  author,
  projects,
  teamName,
  canEdit,
  selected,
  onToggleSelect,
}: {
  expense: ExpenseRecord;
  /** The submitter (avatar + name). Per CLAUDE.md "time-entry
   *  authorship" rule — extends to any user-authored entity. In
   *  the spreadsheet view we render avatar-only with the name in
   *  a tooltip to keep rows single-line. */
  author: ExpenseAuthor | null;
  projects: ProjectOption[];
  /** Set when the parent table is showing a team column (multi-team
   *  business). Null when there's only one team in scope and the
   *  column is hidden — the row drops the cell entirely so column
   *  count matches the header. */
  teamName: string | null;
  /** True when the viewer authored this expense OR is owner|admin
   *  on its team. Hides the Trash icon for non-authors and disables
   *  every editable cell so the UI matches the action-layer role
   *  gate (server still enforces the same — defense in depth). */
  canEdit: boolean;
  /** Whether this row is in the current bulk-select set. */
  selected: boolean;
  /** Toggle this row's id in/out of the bulk-select set. */
  onToggleSelect: (id: string) => void;
}): React.JSX.Element {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const tToast = useTranslations("expenses.toast");
  const toast = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  return (
    <tr
      className={`border-b border-edge last:border-0 hover:bg-hover transition-colors ${
        selected ? "bg-accent-soft/30" : ""
      }`}
    >
      {/* Selection checkbox */}
      <td className="w-10">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(expense.id)}
          aria-label={t("bulk.selectRow", { vendor: ariaIdent })}
          className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
        />
      </td>

      {/* Date */}
      <td className="text-content-secondary font-mono tabular-nums">
        <EditableCell
          variant="date"
          value={expense.incurred_on}
          displayNode={formatExpenseDateDisplay(expense.incurred_on)}
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.incurredOn"),
          })}
          onCommit={(v) => commitField("incurred_on", v)}
          disabled={!canEdit}
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
                    ? "bg-warning-soft text-warning"
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
            disabled={!canEdit}
          />
          {expense.is_sample && (
            <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-label font-medium text-accent">
              {t("sampleTag")}
            </span>
          )}
        </div>
      </td>

      {/* Team (conditional) */}
      {teamName !== null && (
        <td className="text-content-secondary truncate max-w-[160px]">
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
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.vendor"),
          })}
          onCommit={(v) => commitField("vendor", v)}
          disabled={!canEdit}
          placeholder="—"
          className="truncate max-w-[180px]"
        />
      </td>

      {/* Description */}
      <td className="text-content-secondary">
        <EditableCell
          variant="textarea"
          value={expense.description ?? ""}
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.description"),
          })}
          onCommit={(v) => commitField("description", v)}
          disabled={!canEdit}
          placeholder="—"
          displayNode={
            expense.description ? (
              <Tooltip label={expense.description} labelMode="label">
                <span className="block truncate">{expense.description}</span>
              </Tooltip>
            ) : (
              <span className="text-content-muted">—</span>
            )
          }
          className="truncate max-w-[280px]"
        />
      </td>

      {/* Notes */}
      <td className="text-content-muted italic">
        <EditableCell
          variant="textarea"
          value={expense.notes ?? ""}
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.notes"),
          })}
          onCommit={(v) => commitField("notes", v)}
          disabled={!canEdit}
          placeholder="—"
          displayNode={
            expense.notes ? (
              <Tooltip label={expense.notes} labelMode="label">
                <span className="block truncate">{expense.notes}</span>
              </Tooltip>
            ) : (
              <span className="text-content-muted">—</span>
            )
          }
          className="truncate max-w-[200px]"
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
            disabled={!canEdit}
            className="truncate max-w-[160px]"
          />
          {expense.billable && (
            <Tooltip label={t("fields.billable")} labelMode="label">
              <span className="inline-flex items-center rounded-full bg-success-soft px-1.5 py-0.5 text-label font-semibold uppercase tracking-wider text-success">
                {t("billableShort")}
              </span>
            </Tooltip>
          )}
        </div>
      </td>

      {/* Amount */}
      <td className="text-right font-mono tabular-nums text-content">
        <EditableCell
          variant="number"
          value={expense.amount.toFixed(2)}
          displayNode={formatExpenseAmount(expense.amount, expense.currency)}
          ariaLabel={t("ariaActions.editField", {
            vendor: ariaIdent,
            field: t("fields.amount"),
          })}
          onCommit={(v) => commitField("amount", v)}
          disabled={!canEdit}
          min={0}
          step={0.01}
        />
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

      {/* Actions (delete only — edit is per-cell) */}
      <td className="text-right">
        {!canEdit ? (
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
        )}
      </td>
    </tr>
  );
}
