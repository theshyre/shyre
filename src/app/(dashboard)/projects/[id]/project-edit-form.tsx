"use client";

import { useTranslations } from "next-intl";
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
  status: string | null;
  category_set_id: string | null;
  require_timestamps: boolean;
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

      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("fields.name")} *</label>
            <input
              name="name"
              required
              defaultValue={project.name}
              className={inputClass}
            />
            <FieldError error={fieldErrors.name} />
          </div>
          <div>
            <label className={labelClass}>{t("fields.status")}</label>
            <select
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
            <label className={labelClass}>{t("fields.hourlyRate")}</label>
            <input
              name="hourly_rate"
              type="number"
              step="0.01"
              min="0"
              defaultValue={project.hourly_rate ?? ""}
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
              defaultValue={project.budget_hours ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("fields.githubRepo")}</label>
            <input
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
            <label className={labelClass}>{t("fields.jiraProjectKey")}</label>
            <input
              name="jira_project_key"
              placeholder={t("fields.jiraProjectKeyPlaceholder")}
              defaultValue={project.jira_project_key ?? ""}
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.jiraProjectKeyHint")}
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-sm font-medium text-content cursor-pointer">
              <input
                name="require_timestamps"
                type="checkbox"
                defaultChecked={project.require_timestamps}
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
