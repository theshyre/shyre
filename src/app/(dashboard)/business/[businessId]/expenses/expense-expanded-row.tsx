"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronUp, AlertTriangle, Check, Loader2, Lock } from "lucide-react";
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
import { INVOICED_EDITABLE_EXPENSE_FIELDS } from "./expense-lock-helpers";
import type { ProjectOption } from "./page";

export interface ExpandedRowExpense {
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
  /** Phase-2 invoiced lock state — drives per-field read-only on the
   *  financial fields. Optional so non-invoiced callers stay simple. */
  invoiced?: boolean;
  invoice_number?: string | null;
}

interface Props {
  expense: ExpandedRowExpense;
  projects: ProjectOption[];
  /** Distinct prior vendors → native <datalist> on the vendor field.
   *  Optional (defaults to []) so non-suggesting callers still work. */
  vendorOptions?: string[];
  /** Number of columns the parent <table> renders, so the expansion's
   *  single <td> spans the full row width without disturbing the
   *  fixed layout. */
  columnCount: number;
  canEdit: boolean;
  /** Called when the user dismisses the expansion (Esc, the
   *  "Collapse" button). Owned by the parent so URL syncing and
   *  the chevron's `aria-expanded` state stay consistent. */
  onClose: () => void;
  /** Called after a field saves so the parent row can apply the value
   *  optimistically (the inline action skips revalidatePath to avoid a
   *  scroll-resetting route refresh). */
  onFieldCommitted?: (field: string, value: string) => void;
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
  vendorOptions = [],
  columnCount,
  canEdit,
  onClose,
  onFieldCommitted,
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
    // Let the parent row reflect the saved value optimistically — the
    // inline action skips revalidatePath to avoid a scroll-resetting
    // route refresh.
    onFieldCommitted?.(field, value);
  };

  // Field-level invoice lock — mirrors expense-row. Financial fields
  // (amount / currency / incurred_on / project_id / billable) are
  // read-only once invoiced; metadata stays editable.
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
              disabled={!fieldEditable("incurred_on")}
              disabledReason={fieldLockReason("incurred_on")}
            />
          </Field>
          <Field label={t("fields.amount")}>
            <EditableCell
              variant="number"
              value={String(expense.amount)}
              ariaLabel={t("fields.amount")}
              onCommit={(v) => commitField("amount", v)}
              disabled={!fieldEditable("amount")}
              disabledReason={fieldLockReason("amount")}
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
              disabled={!fieldEditable("category")}
              disabledReason={fieldLockReason("category")}
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
              disabled={!fieldEditable("project_id")}
              disabledReason={fieldLockReason("project_id")}
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label={t("fields.vendor")}>
            <EditableCell
              variant="text"
              value={expense.vendor ?? ""}
              suggestions={vendorOptions}
              ariaLabel={t("fields.vendor")}
              onCommit={(v) => commitField("vendor", v)}
              disabled={!fieldEditable("vendor")}
              disabledReason={fieldLockReason("vendor")}
              placeholder={t("drawer.placeholderVendor")}
            />
          </Field>
          <Field label={t("fields.externalReference")}>
            <EditableCell
              variant="text"
              value={expense.external_reference ?? ""}
              ariaLabel={t("fields.externalReference")}
              onCommit={(v) => commitField("external_reference", v)}
              disabled={!fieldEditable("external_reference")}
              disabledReason={fieldLockReason("external_reference")}
              placeholder={t("drawer.placeholderExternalReference")}
              // Reference numbers are IDs — render in mono tabular so
              // digits align and a transposed character is obvious.
              displayNode={
                expense.external_reference ? (
                  <span className="font-mono tabular-nums">
                    {expense.external_reference}
                  </span>
                ) : undefined
              }
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label={t("fields.description")}>
            <ExpandedTextarea
              value={expense.description ?? ""}
              ariaLabel={t("fields.description")}
              onCommit={(v) => commitField("description", v)}
              disabled={!fieldEditable("description")}
              lockReason={fieldLockReason("description")}
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
              disabled={!fieldEditable("notes")}
              lockReason={fieldLockReason("notes")}
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
              disabled={!fieldEditable("billable")}
              lockReason={fieldLockReason("billable")}
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
 * EditableCell pattern.
 *
 * Surfaces its own save status (saving / saved / error) — the previous
 * `void onCommit(next)` swallowed rejections, so a failed save left the
 * field looking saved when it wasn't (the silent-failure bug). When
 * read-only because the row is invoiced, shows the lock reason instead.
 */
function ExpandedTextarea({
  value,
  ariaLabel,
  onCommit,
  disabled,
  lockReason,
  rows,
  placeholder,
}: {
  value: string;
  ariaLabel: string;
  onCommit: (next: string) => Promise<void>;
  disabled: boolean;
  lockReason?: string;
  rows: number;
  placeholder?: string;
}): React.JSX.Element {
  const t = useTranslations("expenses");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function commit(next: string): Promise<void> {
    if (next === value) return;
    setStatus("saving");
    setError(null);
    try {
      await onCommit(next);
      setStatus("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("drawer.saveFailed"));
      setStatus("error");
    }
  }

  return (
    <div>
      <textarea
        defaultValue={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        onBlur={(e) => void commit(e.target.value)}
        className={`${textareaClass} w-full ${
          status === "error" ? "border-error" : ""
        }`}
      />
      {lockReason ? (
        <p className="mt-1 inline-flex items-center gap-1 text-caption text-content-muted">
          <Lock size={11} aria-hidden="true" /> {lockReason}
        </p>
      ) : status === "saving" ? (
        <p className="mt-1 inline-flex items-center gap-1 text-caption text-content-muted">
          <Loader2 size={11} className="animate-spin" aria-hidden="true" />{" "}
          {t("drawer.saving")}
        </p>
      ) : status === "saved" ? (
        <p className="mt-1 inline-flex items-center gap-1 text-caption text-success-text">
          <Check size={11} aria-hidden="true" /> {t("drawer.saved")}
        </p>
      ) : status === "error" && error ? (
        <p className="mt-1 inline-flex items-center gap-1 text-caption text-error">
          <AlertTriangle size={11} aria-hidden="true" /> {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Billable toggle. Locked (read-only) once the expense is invoiced —
 * billable decides whether the line is on the invoice, so it can't
 * change after billing. Surfaces save errors inline (the old
 * `void onChange` swallowed them).
 */
function BillableCheckbox({
  checked,
  onChange,
  disabled,
  lockReason,
}: {
  checked: boolean;
  onChange: (next: boolean) => Promise<void>;
  disabled: boolean;
  lockReason?: string;
}): React.JSX.Element {
  const t = useTranslations("expenses");
  const [error, setError] = useState<string | null>(null);

  async function handle(next: boolean): Promise<void> {
    setError(null);
    try {
      await onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("drawer.saveFailed"));
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => void handle(e.target.checked)}
        className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring disabled:opacity-50"
      />
      {lockReason && (
        <span className="inline-flex items-center gap-1 text-caption text-content-muted">
          <Lock size={11} aria-hidden="true" /> {lockReason}
        </span>
      )}
      {error && (
        <span className="inline-flex items-center gap-1 text-caption text-error">
          <AlertTriangle size={11} aria-hidden="true" /> {error}
        </span>
      )}
    </span>
  );
}
