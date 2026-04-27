"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { AlertBanner, Spinner } from "@theshyre/ui";
import {
  inputClass,
  textareaClass,
  labelClass,
  buttonSecondaryClass,
  buttonDangerClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { updateExpenseAction, deleteExpenseAction } from "./actions";
import { EXPENSE_CATEGORIES } from "./categories";
import type { ProjectOption } from "./page";

interface ExpenseRecord {
  id: string;
  team_id: string;
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
  category: string;
  description: string | null;
  project_id: string | null;
  billable: boolean;
  is_sample: boolean;
  projects: { id: string; name: string } | null;
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function ExpenseRow({
  expense,
  projects,
}: {
  expense: ExpenseRecord;
  projects: ProjectOption[];
}): React.JSX.Element {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const [mode, setMode] = useState<"view" | "edit" | "confirmDelete">("view");

  const update = useFormAction({
    action: updateExpenseAction,
    onSuccess: () => setMode("view"),
  });

  const del = useFormAction({
    action: deleteExpenseAction,
    onSuccess: () => setMode("view"),
  });

  if (mode === "edit") {
    return (
      <tr className="border-b border-edge last:border-0 bg-surface-inset">
        <td colSpan={6} className="p-4">
          <form action={update.handleSubmit} className="space-y-3">
            <input type="hidden" name="id" value={expense.id} />
            {update.serverError && (
              <AlertBanner tone="error">{update.serverError}</AlertBanner>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={labelClass}>{t("fields.incurredOn")} *</label>
                <input
                  name="incurred_on"
                  type="date"
                  defaultValue={expense.incurred_on}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t("fields.amount")} *</label>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={expense.amount.toFixed(2)}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t("fields.category")} *</label>
                <select
                  name="category"
                  required
                  defaultValue={expense.category}
                  className={inputClass}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`categories.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>{t("fields.vendor")}</label>
                <input
                  name="vendor"
                  type="text"
                  defaultValue={expense.vendor ?? ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t("fields.project")}</label>
                <select
                  name="project_id"
                  defaultValue={expense.project_id ?? "none"}
                  className={inputClass}
                >
                  <option value="none">{t("noProject")}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className={labelClass}>{t("fields.description")}</label>
                <textarea
                  name="description"
                  rows={2}
                  defaultValue={expense.description ?? ""}
                  className={textareaClass}
                />
              </div>
              <div className="sm:col-span-3 flex items-center gap-2">
                <input
                  id={`billable-${expense.id}`}
                  type="checkbox"
                  name="billable"
                  defaultChecked={expense.billable}
                  className="h-4 w-4"
                />
                <label
                  htmlFor={`billable-${expense.id}`}
                  className="text-body text-content-secondary"
                >
                  {t("fields.billable")}
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <SubmitButton
                label={t("save")}
                pending={update.pending}
                success={update.success}
                successMessage={tc("actions.saved")}
              />
              <button
                type="button"
                onClick={() => setMode("view")}
                disabled={update.pending}
                className={buttonSecondaryClass}
              >
                {tc("actions.cancel")}
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-edge last:border-0 hover:bg-hover transition-colors">
      <td className="px-4 py-3 font-mono text-caption text-content-secondary">
        {expense.incurred_on}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-secondary">
          {t(`categories.${expense.category}`)}
        </span>
        {expense.is_sample && (
          <span className="ml-2 inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-label font-medium text-accent">
            {t("sampleTag")}
          </span>
        )}
        {expense.description && (
          <p className="mt-1 text-caption text-content-muted line-clamp-1">
            {expense.description}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-content-secondary">
        {expense.vendor || "—"}
      </td>
      <td className="px-4 py-3 text-content-secondary">
        {expense.projects?.name ?? "—"}
        {expense.billable && (
          <span className="ml-2 text-label font-semibold uppercase tracking-wider text-success">
            {t("billableTag")}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right font-mono tabular-nums text-content">
        {formatCurrency(expense.amount, expense.currency)}
      </td>
      <td className="px-4 py-3 text-right">
        {mode === "confirmDelete" ? (
          <form action={del.handleSubmit} className="inline-flex items-center gap-1">
            <input type="hidden" name="id" value={expense.id} />
            <button
              type="submit"
              disabled={del.pending}
              className={`${buttonDangerClass} !px-2 !py-1 text-caption`}
              aria-label={t("confirmDelete")}
            >
              {del.pending ? (
                <Spinner size="h-3 w-3" />
              ) : (
                <Check size={12} />
              )}
              {t("confirmDelete")}
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              disabled={del.pending}
              className="inline-flex items-center gap-1 rounded-md p-1.5 text-content-muted hover:bg-hover"
              aria-label={tc("actions.cancel")}
            >
              <X size={14} />
            </button>
          </form>
        ) : (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="inline-flex items-center gap-1 rounded-md p-1.5 text-content-secondary hover:bg-hover hover:text-content"
              aria-label={tc("actions.edit")}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={() => setMode("confirmDelete")}
              className="inline-flex items-center gap-1 rounded-md p-1.5 text-content-secondary hover:bg-hover hover:text-error"
              aria-label={tc("actions.delete")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
