"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
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
import { OrgSelector } from "@/components/OrgSelector";
import type { OrgListItem } from "@/lib/org-context";
import { createProjectAction } from "./actions";

interface ClientOption {
  id: string;
  name: string;
}

export function NewProjectForm({
  clients,
  orgs,
  defaultOrgId,
}: {
  clients: ClientOption[];
  orgs: OrgListItem[];
  defaultOrgId?: string;
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
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">{serverError}</p>
      )}
      <OrgSelector orgs={orgs} defaultOrgId={defaultOrgId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{t("fields.name")} *</label>
          <input name="name" required className={inputClass} />
          <FieldError error={fieldErrors.name} />
        </div>
        <div>
          <label className={labelClass}>{t("fields.client")}</label>
          <select name="client_id" className={selectClass}>
            <option value="">{t("fields.internalProject")}</option>
            {clients.map((c) => (
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
