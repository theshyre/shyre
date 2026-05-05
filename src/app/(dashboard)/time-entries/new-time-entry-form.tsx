"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import {
  inputClass,
  labelClass,
  selectClass,
  textareaClass,
  buttonSecondaryClass,
  formGridClass,
  formSpanFull,
  formSpanHalf,
  formSpanThird,
  formSpanQuarter,
  formSpanCompact,
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
  is_internal?: boolean;
  default_billable?: boolean;
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
  // Internal projects pin billable to false (server enforces too).
  // Pre-pick + disable the toggle so the form's behavior matches the
  // server action; render a tooltip-style hint so the disabled state
  // isn't confusing.
  const projectIsInternal = selectedProject?.is_internal === true;
  // External projects: pick up the project's default_billable as the
  // checkbox default. When no project is selected yet, fall back to
  // checked (the historical default).
  const billableDefault = selectedProject
    ? selectedProject.default_billable !== false
    : true;

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
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      {tzOffsetMin !== undefined && (
        <input type="hidden" name="tz_offset_min" value={String(tzOffsetMin)} />
      )}
      <TeamSelector teams={teams} defaultTeamId={defaultTeamId} />
      {/* 12-col grid — see docs/reference/forms-and-buttons.md →
          "Field sizing". Hero fields (Project, Category,
          Description) ride col-span-6/12; compact metadata (Date,
          Duration, Issue, Billable) takes col-span-4/3/3/2. */}
      <div className={formGridClass}>
        {/* Row 1: Project + Category — paired (Project's category-
            set ids drive what the picker offers). */}
        <div className={formSpanHalf}>
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
        <div className={formSpanHalf}>
          <CategoryPicker
            categories={categories}
            categorySetIds={[
              selectedProject?.category_set_id,
              selectedProject?.extension_category_set_id,
            ]}
          />
        </div>

        {/* Row 2: Description — full-width textarea (matches
            inline-edit-form). Was a single-line input that
            truncated long Harvest-imported text. */}
        <div className={formSpanFull}>
          <label className={labelClass}>{t("fields.description")}</label>
          <textarea
            name="description"
            placeholder={t("fields.descriptionPlaceholder")}
            rows={3}
            className={textareaClass}
          />
        </div>

        {/* Row 3: Date/time — compact. */}
        {selectedProject?.require_timestamps ?? true ? (
          <>
            <div className={formSpanThird}>
              <label className={labelClass}>{t("fields.startTime")} *</label>
              <input
                name="start_time"
                type="datetime-local"
                required
                className={inputClass}
              />
            </div>
            <div className={formSpanThird}>
              <label className={labelClass}>{t("fields.endTime")}</label>
              <input name="end_time" type="datetime-local" className={inputClass} />
            </div>
          </>
        ) : (
          <>
            <div className={formSpanThird}>
              <label className={labelClass}>{t("fields.date")} *</label>
              <input
                name="entry_date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
            </div>
            <div className={formSpanQuarter}>
              <label className={labelClass}>{t("fields.duration")} *</label>
              <DurationInput
                name="duration_min"
                defaultMinutes={0}
                ariaLabel={t("fields.duration")}
              />
            </div>
          </>
        )}

        {/* Row 4: Metadata — compact. */}
        {linkedRepo ? (
          <div className={formSpanQuarter}>
            <label className={labelClass}>{t("fields.githubIssue")}</label>
            <GitHubIssuePicker
              repo={linkedRepo}
              value={issueNumber}
              onChange={setIssueNumber}
            />
          </div>
        ) : (
          <div className={formSpanQuarter}>
            <label className={labelClass}>{t("fields.githubIssue")}</label>
            <input
              name="github_issue"
              type="number"
              min="1"
              className={inputClass}
            />
          </div>
        )}
        <div className={`${formSpanCompact} flex items-end pb-1`}>
          <label
            className={`flex items-center gap-2 text-body-lg font-medium ${projectIsInternal ? "text-content-muted cursor-not-allowed" : "text-content cursor-pointer"}`}
            title={
              projectIsInternal ? t("fields.billableInternalLocked") : undefined
            }
          >
            <input
              // `key` resets the controlled-default when the user
              // switches projects — otherwise React preserves the
              // previous DOM checkbox state across project changes.
              key={`${selectedProjectId}:${billableDefault}:${projectIsInternal}`}
              name="billable"
              type="checkbox"
              defaultChecked={!projectIsInternal && billableDefault}
              disabled={projectIsInternal}
              className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring disabled:opacity-50"
            />
            {t("fields.billable")}
          </label>
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
