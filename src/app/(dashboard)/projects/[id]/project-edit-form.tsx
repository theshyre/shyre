"use client";

import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
} from "@/lib/form-styles";
import { updateProjectAction } from "../actions";

interface Project {
  id: string;
  name: string;
  description: string | null;
  hourly_rate: number | null;
  budget_hours: number | null;
  github_repo: string | null;
  jira_project_key: string | null;
  invoice_code: string | null;
  status: string | null;
  category_set_id: string | null;
  require_timestamps: boolean;
  is_internal: boolean;
  default_billable: boolean;
}

const STATUSES = ["active", "paused", "completed", "archived"] as const;

export function ProjectEditForm({
  project,
}: {
  project: Project;
}): React.JSX.Element {
  const t = useTranslations("projects");
  const tc = useTranslations("common");

  const { pending, success, serverError, fieldErrors, handleSubmit } = useFormAction({
    action: updateProjectAction,
  });

  return (
    <form action={handleSubmit} className="space-y-4">
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <input type="hidden" name="id" value={project.id} />
      {/* Preserve category_set_id on save — it's managed by the
          ProjectCategoriesEditor below, but updateProjectAction reads
          this field and would null it out if absent. */}
      <input
        type="hidden"
        name="category_set_id"
        value={project.category_set_id ?? ""}
      />

      {project.is_internal && (
        // Read-only chip: this project's internal status is managed
        // through setProjectInternalAction, not the regular update
        // path. Surfacing the badge inline keeps the user oriented
        // when they're editing other fields.
        <div className="flex items-center gap-2 rounded-md border border-edge bg-surface-inset px-3 py-2 text-body-lg text-content-secondary">
          <Building2 size={14} className="text-content-muted" />
          {t("fields.isInternalBadge")}
          <span className="text-caption text-content-muted">
            {t("fields.isInternalBadgeHint")}
          </span>
        </div>
      )}

      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="project-edit-name" className={labelClass}>
              {t("fields.name")} *
            </label>
            <input
              id="project-edit-name"
              name="name"
              required
              defaultValue={project.name}
              className={inputClass}
              aria-describedby={
                fieldErrors.name ? "project-edit-name-error" : undefined
              }
            />
            <FieldError
              error={fieldErrors.name}
              id="project-edit-name-error"
            />
          </div>
          <div>
            <label htmlFor="project-edit-status" className={labelClass}>
              {t("fields.status")}
            </label>
            <select
              id="project-edit-status"
              name="status"
              defaultValue={project.status ?? "active"}
              className={selectClass}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tc(`status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="project-edit-hourly-rate" className={labelClass}>
              {t("fields.hourlyRate")}
            </label>
            <input
              id="project-edit-hourly-rate"
              name="hourly_rate"
              type="number"
              step="0.01"
              min="0"
              defaultValue={project.hourly_rate ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="project-edit-budget-hours" className={labelClass}>
              {t("fields.budgetHours")}
            </label>
            <input
              id="project-edit-budget-hours"
              name="budget_hours"
              type="number"
              step="0.5"
              min="0"
              defaultValue={project.budget_hours ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="project-edit-github-repo" className={labelClass}>
              {t("fields.githubRepo")}
            </label>
            <input
              id="project-edit-github-repo"
              name="github_repo"
              placeholder={t("fields.githubRepoPlaceholder")}
              defaultValue={project.github_repo ?? ""}
              className={inputClass}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.githubRepoHint")}
            </p>
          </div>
          <div>
            <label htmlFor="project-edit-jira-key" className={labelClass}>
              {t("fields.jiraProjectKey")}
            </label>
            <input
              id="project-edit-jira-key"
              name="jira_project_key"
              placeholder={t("fields.jiraProjectKeyPlaceholder")}
              defaultValue={project.jira_project_key ?? ""}
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.jiraProjectKeyHint")}
            </p>
          </div>
          <div>
            <label htmlFor="project-edit-invoice-code" className={labelClass}>
              {t("fields.invoiceCode")}
            </label>
            <input
              id="project-edit-invoice-code"
              name="invoice_code"
              placeholder={t("fields.invoiceCodePlaceholder")}
              defaultValue={project.invoice_code ?? ""}
              maxLength={16}
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.invoiceCodeHint")}
            </p>
          </div>
          {!project.is_internal && (
            <div className="sm:col-span-2">
              <label className="flex items-start gap-2 text-body-lg font-medium text-content cursor-pointer">
                <input
                  name="default_billable"
                  type="checkbox"
                  defaultChecked={project.default_billable}
                  className="mt-0.5 h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
                />
                <span>
                  {t("fields.defaultBillable")}
                  <span className="ml-1 block text-caption font-normal text-content-muted">
                    {t("fields.defaultBillableHint")}
                  </span>
                </span>
              </label>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-body-lg font-medium text-content cursor-pointer">
              <input
                name="require_timestamps"
                type="checkbox"
                defaultChecked={project.require_timestamps}
                className="mt-0.5 h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
              />
              <span>
                {t("fields.requireTimestamps")}
                <span className="ml-1 block text-caption font-normal text-content-muted">
                  {t("fields.requireTimestampsHint")}
                </span>
              </span>
            </label>
          </div>
        </div>
        <div>
          <label className={labelClass}>{t("fields.description")}</label>
          <textarea
            name="description"
            rows={3}
            defaultValue={project.description ?? ""}
            className={textareaClass}
          />
        </div>
      </div>

      <SubmitButton label={t("saveChanges")} pending={pending} success={success} successMessage={tc("actions.saved")} />
    </form>
  );
}
