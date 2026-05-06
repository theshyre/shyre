"use client";

import { useEffect, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
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

export interface DrawerExpense {
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
  expenses: DrawerExpense[];
  projects: ProjectOption[];
  /** Map of expense_id → whether the viewer can edit. Drives the
   *  read-only treatment when the caller doesn't author the row
   *  AND isn't owner/admin on its team. */
  canEditByExpenseId: Record<string, boolean>;
}

/**
 * URL-driven side drawer for editing one expense at a time.
 *
 * Reads `?edit=<expense-id>` from the URL. When set, slides a panel
 * in from the right (~480px) containing all editable fields with
 * the breathing room the in-table cells lack — full-width
 * description and notes textareas in particular. Each field still
 * uses the shared `<EditableCell>` commit-on-blur semantics so
 * no new save mechanics are introduced; the drawer is just a
 * roomier rendering of the same edit affordances.
 *
 * Closes on:
 *   - Esc key
 *   - Backdrop click (outside the panel)
 *   - The X button in the header
 *
 * Deep-linkable: `?edit=<id>` shareable URL works.
 *
 * Hidden when the URL has no `?edit=` param.
 */
export function ExpenseEditDrawer({
  expenses,
  projects,
  canEditByExpenseId,
}: Props): React.JSX.Element | null {
  const t = useTranslations("expenses");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const expense = useMemo(
    () => expenses.find((e) => e.id === editId) ?? null,
    [expenses, editId],
  );

  // Esc-to-close. Wired unconditionally so the hook order stays
  // stable across the render where the drawer is open vs closed.
  useEffect(() => {
    if (!editId) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  function close(): void {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("edit");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  if (!editId || !expense) return null;

  const canEdit = canEditByExpenseId[expense.id] === true;

  const commitField = async (field: string, value: string): Promise<void> => {
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
    (c) => ({
      value: c,
      label: t(`categories.${c}`),
    }),
  );
  const projectOptions: EditableCellSelectOption[] = [
    { value: "", label: t("noProject") },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const titleLabel = expense.vendor ?? t("drawer.untitled");

  return (
    <>
      {/* Backdrop — clicking it closes. role="presentation" so
          screen readers don't announce it as interactive content. */}
      <div
        className="fixed inset-0 bg-overlay/40 z-40"
        role="presentation"
        onClick={close}
      />
      <aside
        className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] bg-surface-raised border-l border-edge shadow-xl z-50 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={t("drawer.title", { vendor: titleLabel })}
      >
        <header className="flex items-center gap-2 border-b border-edge px-4 py-3 shrink-0">
          <h2 className="text-body-lg font-semibold text-content truncate flex-1 min-w-0">
            {titleLabel}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t("drawer.close")}
            className={buttonGhostClass}
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
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

          <Field label={t("fields.description")}>
            {/* Direct textarea — bypass EditableCell's compact mode so
                long descriptions edit comfortably. Commit on blur to
                match the inline-cell pattern (the user doesn't have
                to click a Save button). */}
            <DrawerTextarea
              value={expense.description ?? ""}
              ariaLabel={t("fields.description")}
              onCommit={(v) => commitField("description", v)}
              disabled={!canEdit}
              rows={6}
              placeholder={t("drawer.placeholderDescription")}
            />
          </Field>

          <Field label={t("fields.notes")}>
            <DrawerTextarea
              value={expense.notes ?? ""}
              ariaLabel={t("fields.notes")}
              onCommit={(v) => commitField("notes", v)}
              disabled={!canEdit}
              rows={4}
              placeholder={t("drawer.placeholderNotes")}
            />
          </Field>

          <Field label={t("fields.billable")}>
            <label className="flex items-center gap-2 text-body text-content">
              <BillableCheckbox
                checked={expense.billable}
                onChange={(v) =>
                  commitField("billable", v ? "true" : "false")
                }
                disabled={!canEdit}
              />
              <span>{t("billableTag")}</span>
            </label>
          </Field>
        </div>

        <footer className="border-t border-edge px-4 py-2 text-caption text-content-muted">
          {t("drawer.savedHint")}
        </footer>
      </aside>
    </>
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
 * Roomier textarea than EditableCell's compact textarea — full
 * width, multiple rows, commit-on-blur. Used in the drawer for
 * description and notes where the in-table cell's narrow
 * column was the user's specific complaint.
 */
function DrawerTextarea({
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
