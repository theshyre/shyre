"use client";

import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
} from "@/lib/form-styles";
import { updateTimeEntryAction } from "../actions";

interface TimeEntry {
  id: string;
  project_id: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  billable: boolean;
  github_issue: number | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function TimeEntryEditForm({
  entry,
  projects,
}: {
  entry: TimeEntry;
  projects: ProjectOption[];
}): React.JSX.Element {
  const t = useTranslations("time");

  return (
    <form action={updateTimeEntryAction} className="space-y-4">
      <input type="hidden" name="id" value={entry.id} />

      <div className="flex items-center gap-3">
        <Clock size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("editTitle")}</h1>
      </div>

      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("fields.project")}</label>
            <select
              name="project_id"
              defaultValue={entry.project_id}
              disabled
              className={selectClass}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{t("fields.description")}</label>
            <input
              name="description"
              defaultValue={entry.description ?? ""}
              placeholder={t("fields.descriptionPlaceholder")}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("fields.startTime")} *</label>
            <input
              name="start_time"
              type="datetime-local"
              required
              defaultValue={toLocalDatetime(entry.start_time)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("fields.endTime")}</label>
            <input
              name="end_time"
              type="datetime-local"
              defaultValue={entry.end_time ? toLocalDatetime(entry.end_time) : ""}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("fields.githubIssue")}</label>
            <input
              name="github_issue"
              type="number"
              min="1"
              defaultValue={entry.github_issue ?? ""}
              className={inputClass}
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm font-medium text-content cursor-pointer">
              <input
                name="billable"
                type="checkbox"
                defaultChecked={entry.billable}
                className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
              />
              {t("fields.billable")}
            </label>
          </div>
        </div>
      </div>

      <button type="submit" className={buttonPrimaryClass}>
        {t("saveChanges")}
      </button>
    </form>
  );
}
