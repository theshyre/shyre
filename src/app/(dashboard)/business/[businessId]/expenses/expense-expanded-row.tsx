"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { ChevronUp } from "lucide-react";
import {
  labelClass,
  textareaClass,
  buttonGhostClass,
} from "@/lib/form-styles";
import {
  EditableCell,
  type EditableCellSelectOption,
} from "@/components/EditableCell";
import { EXPENSE_CATEGORIES } from "./categories";
import { updateExpenseFieldAction } from "./actions";
import type { ProjectOption } from "./page";

export interface ExpandedRowExpense {
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
}

interface Props {
  expense: ExpandedRowExpense;
  projects: ProjectOption[];
  /** Number of columns the parent <table> renders, so the expansion's
   *  single <td> spans the full row width without disturbing the
   *  fixed layout. */
  columnCount: number;
  canEdit: boolean;
  /** Called when the user dismisses the expansion (Esc, the
   *  "Collapse" button). Owned by the parent so URL syncing and
   *  the chevron's `aria-expanded` state stay consistent. */
  onClose: () => void;
}

/**
 * Inline expansion of one expense row.
 *
 * Replaces the previous side-drawer pattern: instead of sliding a
 * panel in from the right, the row "opens" between its neighbors
 * to reveal full-width Description and Notes textareas plus the
 * rest of the editable fields. The user stays in the table — they
 * never lose their place when sweeping through expenses.
 *
 * URL-driven via `?edit=<expense-id>`. Esc closes (returns the
 * URL to the bare list). One row open at a time — opening another
 * just changes the param, which collapses this one and expands
 * the new row.
 *
 * Each field still uses `<EditableCell>` (commit-on-blur) for the
 * compact controls; description and notes use a roomier textarea
 * the cell can't accommodate.
 */
export function ExpenseExpandedRow({
  expense,
  projects,
  columnCount,
  canEdit,
  onClose,
}: Props): React.JSX.Element {
  const t = useTranslations("expenses");

  // Esc returns to the un-expanded list. The row only mounts when
  // expanded, so the listener can be unconditional.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return (
    <tr className="bg-accent-soft/20 border-b border-edge">
      <td colSpan={columnCount} className="px-6 py-4">
        {/* Slide-in adds a tiny "yes, something happened" cue on
            expand. Honors prefers-reduced-motion via the @media
            rule in globals.css that collapses transitions. */}
        <div className="grid gap-3 md:grid-cols-4 animate-expand-in">
          <Field label={t("fields.incurredOn")}>
            <EditableCell
              variant="date"
              value={expense.incurred_on}
              ariaLabel={t("fields.incurredOn")}
              onCommit={(v) => commitField("incurred_on", v)}
              disabled={!canEdit}
            />
          </Field>
          <Field label={t("fields.amount")}>
            <EditableCell
              variant="number"
              value={String(expense.amount)}
              ariaLabel={t("fields.amount")}
              onCommit={(v) => commitField("amount", v)}
              disabled={!canEdit}
              displayNode={
                <span className="font-mono tabular-nums">
                  {Number(expense.amount).toFixed(2)}{" "}
                  {expense.currency.toUpperCase()}
                </span>
              }
            />
          </Field>
          <Field label={t("fields.category")}>
            <EditableCell
              variant="select"
              value={expense.category}
              ariaLabel={t("fields.category")}
              options={categoryOptions}
              onCommit={(v) => commitField("category", v)}
              disabled={!canEdit}
              displayNode={
                <span>{t(`categories.${expense.category}`)}</span>
              }
            />
          </Field>
          <Field label={t("fields.project")}>
            <EditableCell
              variant="select"
              value={expense.project_id ?? ""}
              ariaLabel={t("fields.project")}
              options={projectOptions}
              onCommit={(v) => commitField("project_id", v)}
              disabled={!canEdit}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label={t("fields.vendor")}>
            <EditableCell
              variant="text"
              value={expense.vendor ?? ""}
              ariaLabel={t("fields.vendor")}
              onCommit={(v) => commitField("vendor", v)}
              disabled={!canEdit}
              placeholder={t("drawer.placeholderVendor")}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label={t("fields.description")}>
            <ExpandedTextarea
              value={expense.description ?? ""}
              ariaLabel={t("fields.description")}
              onCommit={(v) => commitField("description", v)}
              disabled={!canEdit}
              rows={4}
              placeholder={t("drawer.placeholderDescription")}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label={t("fields.notes")}>
            <ExpandedTextarea
              value={expense.notes ?? ""}
              ariaLabel={t("fields.notes")}
              onCommit={(v) => commitField("notes", v)}
              disabled={!canEdit}
              rows={3}
              placeholder={t("drawer.placeholderNotes")}
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4 border-t border-edge pt-3">
          <label className="flex items-center gap-2 text-body text-content">
            <BillableCheckbox
              checked={expense.billable}
              onChange={(v) =>
                commitField("billable", v ? "true" : "false")
              }
              disabled={!canEdit}
            />
            <span>{t("fields.billable")}</span>
          </label>
          <div className="flex items-center gap-3">
            <span className="text-caption text-content-muted hidden sm:block">
              {t("drawer.savedHint")}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("drawer.collapse")}
              className={`${buttonGhostClass} gap-1`}
            >
              <ChevronUp size={14} />
              {t("drawer.collapse")}
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Full-width textarea for description and notes — the in-table cell
 * is too narrow for these in practice. Commit-on-blur to match the
 * EditableCell pattern; no Save button needed.
 */
function ExpandedTextarea({
  value,
  ariaLabel,
  onCommit,
  disabled,
  rows,
  placeholder,
}: {
  value: string;
  ariaLabel: string;
  onCommit: (next: string) => Promise<void>;
  disabled: boolean;
  rows: number;
  placeholder?: string;
}): React.JSX.Element {
  return (
    <textarea
      defaultValue={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      onBlur={(e) => {
        const next = e.target.value;
        if (next === value) return;
        void onCommit(next);
      }}
      className={`${textareaClass} w-full`}
    />
  );
}

function BillableCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => Promise<void>;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => {
        void onChange(e.target.checked);
      }}
      className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring disabled:opacity-50"
    />
  );
}
