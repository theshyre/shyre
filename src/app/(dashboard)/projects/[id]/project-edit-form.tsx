"use client";

import { useTranslations } from "next-intl";
import { FolderKanban } from "lucide-react";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
} from "@/lib/form-styles";
import { updateProjectAction } from "../actions";

interface Project {
  id: string;
  name: string;
  description: string | null;
  hourly_rate: number | null;
  budget_hours: number | null;
  github_repo: string | null;
  status: string | null;
}

const STATUSES = ["active", "paused", "completed", "archived"] as const;

export function ProjectEditForm({
  project,
}: {
  project: Project;
}): React.JSX.Element {
  const t = useTranslations("projects");
  const tc = useTranslations("common");

  return (
    <form action={updateProjectAction} className="space-y-4">
      <input type="hidden" name="id" value={project.id} />

      <div className="flex items-center gap-3">
        <FolderKanban size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("editTitle")}</h1>
      </div>

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
          <div className="sm:col-span-2">
            <label className={labelClass}>{t("fields.githubRepo")}</label>
            <input
              name="github_repo"
              placeholder={t("fields.githubRepoPlaceholder")}
              defaultValue={project.github_repo ?? ""}
              className={inputClass}
            />
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

      <button type="submit" className={buttonPrimaryClass}>
        {t("saveChanges")}
      </button>
    </form>
  );
}
