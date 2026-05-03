"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { AlertBanner, useKeyboardShortcut } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { TeamSelector } from "@/components/TeamSelector";
import type { TeamListItem } from "@/lib/team-context";
import type { CategorySet } from "@/lib/categories/types";
import { createProjectAction } from "./actions";

interface CustomerOption {
  id: string;
  name: string;
}

export function NewProjectForm({
  customers,
  teams,
  defaultTeamId,
  categorySets,
}: {
  customers: CustomerOption[];
  teams: TeamListItem[];
  defaultTeamId?: string;
  categorySets: CategorySet[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const t = useTranslations("projects");
  const tc = useTranslations("common");

  const { pending, success, serverError, fieldErrors, handleSubmit } = useFormAction({
    action: createProjectAction,
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
        onClick={() => setOpen(true)}
        className={`${buttonPrimaryClass} mt-4`}
      >
        <Plus size={16} />
        {t("addProject")}
        <kbd className={kbdClass}>N</kbd>
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="mt-4 space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <TeamSelector teams={teams} defaultTeamId={defaultTeamId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{t("fields.name")} *</label>
          <input name="name" required className={inputClass} />
          <FieldError error={fieldErrors.name} />
        </div>
        <div>
          <label className={labelClass}>{t("fields.customer")}</label>
          <select name="customer_id" className={selectClass}>
            <option value="">{t("fields.internalProject")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t("fields.hourlyRate")}</label>
          <input
            name="hourly_rate"
            type="number"
            step="0.01"
            min="0"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t("fields.budgetHours")}</label>
          <input
            name="budget_hours"
            type="number"
            step="0.5"
            min="0"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>{t("fields.githubRepo")}</label>
          <input
            name="github_repo"
            placeholder={t("fields.githubRepoPlaceholder")}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t("fields.invoiceCode")}</label>
          <input
            name="invoice_code"
            placeholder={t("fields.invoiceCodePlaceholder")}
            maxLength={16}
            className={`${inputClass} font-mono`}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("fields.invoiceCodeHint")}
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>{t("fields.categorySet")}</label>
          <select name="category_set_id" className={selectClass}>
            <option value="">{t("fields.noCategorySet")}</option>
            {categorySets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.is_system ? `${s.name} (built-in)` : s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-start gap-2 text-sm font-medium text-content cursor-pointer">
            <input
              name="require_timestamps"
              type="checkbox"
              defaultChecked={false}
              className="mt-0.5 h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
            />
            <span>
              {t("fields.requireTimestamps")}
              <span className="ml-1 block text-xs font-normal text-content-muted">
                {t("fields.requireTimestampsHint")}
              </span>
            </span>
          </label>
        </div>
      </div>
      <div>
        <label className={labelClass}>{t("fields.description")}</label>
        <textarea name="description" rows={2} className={textareaClass} />
      </div>
      <div className="flex gap-2">
        <SubmitButton label={t("saveProject")} pending={pending} success={success} successMessage={tc("actions.saved")} />
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(false)}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
