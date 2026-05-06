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
  textareaClass,
  buttonSecondaryClass,
  formGridClass,
  formSpanFull,
  formSpanHalf,
  formSpanThird,
  formSpanQuarter,
  formSpanCompact,
} from "@/lib/form-styles";
import { TeamSelector } from "@/components/TeamSelector";
import { Tooltip } from "@/components/Tooltip";
import { TicketField, ticketFieldVisible } from "@/components/TicketField";
import { DateField } from "@/components/DateField";
import {
  ProjectPicker,
  type ProjectPickerOption,
} from "@/components/ProjectPicker";
import type { TeamListItem } from "@/lib/team-context";
import { createTimeEntryAction } from "./actions";
import { CategoryPicker } from "./category-picker";
import { DurationInput } from "./duration-input";
import type { CategoryOption } from "./types";

interface ProjectOption {
  id: string;
  name: string;
  github_repo: string | null;
  /** Atlassian project key (e.g. "AE") for the unified ticket-link
   *  field. Drives placeholder + bare-number resolution. When the
   *  project has neither this nor github_repo, the ticket field is
   *  hidden entirely. */
  jira_project_key: string | null;
  category_set_id?: string | null;
  extension_category_set_id?: string | null;
  require_timestamps?: boolean;
  is_internal?: boolean;
  default_billable?: boolean;
  /** When non-null, this project is a sub-project of `parent_project_id`.
   *  Drives the indented rendering in ProjectPicker. */
  parent_project_id?: string | null;
  /** Customer for the project — null when the project is internal. */
  customers?: { id: string; name: string } | null;
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
  const [entryDate, setEntryDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const t = useTranslations("time");
  const tc = useTranslations("common");

  const { pending, success, serverError, fieldErrors, handleSubmit } = useFormAction({
    action: createTimeEntryAction,
    onSuccess: () => {
      setOpen(false);
      setSelectedProjectId("");
    },
  });

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const linkedRepo = selectedProject?.github_repo ?? null;
  const linkedJiraKey = selectedProject?.jira_project_key ?? null;
  const showTicket = ticketFieldVisible(linkedRepo, linkedJiraKey);
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
          <label htmlFor="new-time-entry-project" className={labelClass}>
            {t("fields.project")} *
          </label>
          <ProjectPicker
            id="new-time-entry-project"
            name="project_id"
            value={selectedProjectId}
            onChange={setSelectedProjectId}
            required
            autoFocus
            ariaLabel={t("fields.project")}
            projects={projects.map<ProjectPickerOption>((p) => ({
              id: p.id,
              name: p.name,
              parent_project_id: p.parent_project_id ?? null,
              customer_name: p.customers?.name ?? null,
              is_internal: p.is_internal === true,
            }))}
          />
          <FieldError
            error={fieldErrors.project_id}
            id="new-time-entry-project-error"
          />
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
          <label
            htmlFor="new-time-entry-description"
            className={labelClass}
          >
            {t("fields.description")}
          </label>
          <textarea
            id="new-time-entry-description"
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
              <label
                htmlFor="new-time-entry-start"
                className={labelClass}
              >
                {t("fields.startTime")} *
              </label>
              <input
                id="new-time-entry-start"
                name="start_time"
                type="datetime-local"
                required
                className={inputClass}
                aria-describedby={
                  fieldErrors.start_time
                    ? "new-time-entry-start-error"
                    : undefined
                }
              />
              <FieldError
                error={fieldErrors.start_time}
                id="new-time-entry-start-error"
              />
            </div>
            <div className={formSpanThird}>
              <label
                htmlFor="new-time-entry-end"
                className={labelClass}
              >
                {t("fields.endTime")}
              </label>
              <input
                id="new-time-entry-end"
                name="end_time"
                type="datetime-local"
                className={inputClass}
              />
            </div>
          </>
        ) : (
          <>
            <div className={formSpanThird}>
              <label
                htmlFor="new-time-entry-date"
                className={labelClass}
              >
                {t("fields.date")} *
              </label>
              <DateField
                id="new-time-entry-date"
                name="entry_date"
                value={entryDate}
                onChange={setEntryDate}
              />
            </div>
            <div className={formSpanQuarter}>
              <label
                htmlFor="new-time-entry-duration"
                className={labelClass}
              >
                {t("fields.duration")} *
              </label>
              <DurationInput
                name="duration_min"
                defaultMinutes={0}
                ariaLabel={t("fields.duration")}
              />
            </div>
          </>
        )}

        {/* Row 4: Metadata — compact. The ticket field hides itself
            entirely when neither GitHub nor Jira is configured on the
            selected project. */}
        {showTicket && (
          <div className={formSpanQuarter}>
            <TicketField
              idPrefix="new-time-entry"
              githubRepo={linkedRepo}
              jiraProjectKey={linkedJiraKey}
            />
          </div>
        )}
        <div className={`${formSpanCompact} flex items-end pb-1`}>
          {(() => {
            const label = (
              <label
                className={`flex items-center gap-2 text-body-lg font-medium ${projectIsInternal ? "text-content-muted cursor-not-allowed" : "text-content cursor-pointer"}`}
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
            );
            return projectIsInternal ? (
              <Tooltip label={t("fields.billableInternalLocked")}>{label}</Tooltip>
            ) : (
              label
            );
          })()}
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
