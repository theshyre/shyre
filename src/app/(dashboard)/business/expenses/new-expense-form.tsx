"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useFormAction } from "@/hooks/use-form-action";
import {
  inputClass,
  textareaClass,
  labelClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { SubmitButton } from "@/components/SubmitButton";
import { createExpenseAction } from "./actions";
import { EXPENSE_CATEGORIES } from "./categories";
import type { ProjectOption } from "./page";

interface Props {
  orgId: string;
  projects: ProjectOption[];
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function NewExpenseForm({ orgId, projects }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const t = useTranslations("expenses");
  const tc = useTranslations("common");

  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: createExpenseAction,
    onSuccess: () => setOpen(false),
  });

  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => setOpen(true), []),
    enabled: !open,
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonPrimaryClass}
      >
        <Plus size={16} />
        {t("add")}
        <kbd className={kbdClass}>N</kbd>
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      <input type="hidden" name="organization_id" value={orgId} />

      {serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {serverError}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass}>{t("fields.incurredOn")} *</label>
          <input
            name="incurred_on"
            type="date"
            defaultValue={todayStr()}
            required
            autoFocus
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
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t("fields.category")} *</label>
          <select name="category" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              {t("selectCategory")}
            </option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>{t("fields.vendor")}</label>
          <input name="vendor" type="text" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>{t("fields.project")}</label>
          <select name="project_id" defaultValue="none" className={inputClass}>
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
          <textarea name="description" rows={2} className={textareaClass} />
        </div>
        <div className="sm:col-span-3 flex items-center gap-2">
          <input
            id="billable"
            type="checkbox"
            name="billable"
            className="h-4 w-4"
          />
          <label htmlFor="billable" className="text-sm text-content-secondary">
            {t("fields.billable")}
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <SubmitButton
          label={t("save")}
          pending={pending}
          success={success}
          successMessage={tc("actions.saved")}
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
