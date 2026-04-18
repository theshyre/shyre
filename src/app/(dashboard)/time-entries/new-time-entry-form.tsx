"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { GitHubIssuePicker } from "@/components/GitHubIssuePicker";
import { TeamSelector } from "@/components/TeamSelector";
import type { TeamListItem } from "@/lib/team-context";
import { createTimeEntryAction } from "./actions";
import { CategoryPicker } from "./category-picker";
import { DurationInput } from "./duration-input";
import type { CategoryOption } from "./types";

interface ProjectOption {
  id: string;
  name: string;
  github_repo: string | null;
  category_set_id?: string | null;
  extension_category_set_id?: string | null;
  require_timestamps?: boolean;
}

export function NewTimeEntryForm({
  projects,
  teams,
  defaultTeamId,
  categories,
  tzOffsetMin,
}: {
  projects: ProjectOption[];
  teams: TeamListItem[];
  defaultTeamId?: string;
  categories: CategoryOption[];
  tzOffsetMin?: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [issueNumber, setIssueNumber] = useState<number | null>(null);
  const t = useTranslations("time");
  const tc = useTranslations("common");

  const { pending, success, serverError, fieldErrors, handleSubmit } = useFormAction({
    action: createTimeEntryAction,
    onSuccess: () => {
      setOpen(false);
      setSelectedProjectId("");
      setIssueNumber(null);
    },
  });

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const linkedRepo = selectedProject?.github_repo ?? null;

  // Note: no global `N` shortcut here. The week-timesheet's inline "Add
  // row" already owns `N`, and both surfaces are visible at once in Week
  // view — a shared shortcut would be ambiguous. This button stays a
  // click-only action; the inline timesheet covers fast keyboard add.

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={buttonSecondaryClass}>
        <Plus size={16} />
        {t("addEntry")}
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      {serverError && (
        <p className="text-body text-error bg-error-soft rounded-lg px-3 py-2">{serverError}</p>
      )}
      {tzOffsetMin !== undefined && (
        <input type="hidden" name="tz_offset_min" value={String(tzOffsetMin)} />
      )}
      <TeamSelector teams={teams} defaultTeamId={defaultTeamId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{t("fields.project")} *</label>
          <select
            name="project_id"
            required
            className={selectClass}
            value={selectedProjectId}
            onChange={(e) => {
              setSelectedProjectId(e.target.value);
              setIssueNumber(null);
            }}
          >
            <option value="">{t("fields.project")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <FieldError error={fieldErrors.project_id} />
        </div>
        <div>
          <label className={labelClass}>{t("fields.description")}</label>
          <input
            name="description"
            placeholder={t("fields.descriptionPlaceholder")}
            className={inputClass}
          />
        </div>
        {selectedProject?.require_timestamps ?? true ? (
          <>
            <div>
              <label className={labelClass}>{t("fields.startTime")} *</label>
              <input
                name="start_time"
                type="datetime-local"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t("fields.endTime")}</label>
              <input name="end_time" type="datetime-local" className={inputClass} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelClass}>{t("fields.date")} *</label>
              <input
                name="entry_date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t("fields.duration")} *</label>
              <DurationInput
                name="duration_min"
                defaultMinutes={0}
                ariaLabel={t("fields.duration")}
              />
            </div>
          </>
        )}
        {linkedRepo ? (
          <div>
            <label className={labelClass}>{t("fields.githubIssue")}</label>
            <GitHubIssuePicker
              repo={linkedRepo}
              value={issueNumber}
              onChange={setIssueNumber}
            />
          </div>
        ) : (
          <div>
            <label className={labelClass}>{t("fields.githubIssue")}</label>
            <input
              name="github_issue"
              type="number"
              min="1"
              className={inputClass}
            />
          </div>
        )}
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-body-lg font-medium text-content cursor-pointer">
            <input
              name="billable"
              type="checkbox"
              defaultChecked
              className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
            />
            {t("fields.billable")}
          </label>
        </div>
        <div className="sm:col-span-2">
          <CategoryPicker
            categories={categories}
            categorySetIds={[
              selectedProject?.category_set_id,
              selectedProject?.extension_category_set_id,
            ]}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <SubmitButton label={t("saveEntry")} pending={pending} success={success} successMessage={tc("actions.saved")} />
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
