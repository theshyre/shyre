"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
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
import { updateTimeEntryAction } from "./actions";
import { CategoryPicker } from "./category-picker";
import { DurationInput } from "./duration-input";
import { Tooltip } from "@/components/Tooltip";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  entry: TimeEntry;
  projects: ProjectOption[];
  categories: CategoryOption[];
  onDone: () => void;
  tzOffsetMin?: number;
}

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function InlineEditForm({
  entry,
  projects,
  categories,
  onDone,
  tzOffsetMin,
}: Props): React.JSX.Element {
  const t = useTranslations("time");
  const tc = useTranslations("common");
  const tLock = useTranslations("time.lock");
  const descRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Locked entries get a read-only banner + disabled inputs. The
  // DB trigger refuses UPDATE/DELETE on rows where invoiced=true,
  // so the form would error on save anyway — this surfaces the
  // state up front instead of letting the user type into a draft
  // that can't be saved.
  const locked = entry.invoiced && entry.invoice_id != null;

  const { pending, success, serverError, fieldErrors, handleSubmit } =
    useFormAction({
      action: updateTimeEntryAction,
      onSuccess: () => onDone(),
    });

  useEffect(() => {
    descRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLFormElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDone();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    },
    [onDone],
  );

  // Resolve the project (from the entry's embedded projects field, or look up
  // in the projects list). We need require_timestamps to decide the form shape
  // and is_internal to gate the billable toggle.
  const project =
    projects.find((p) => p.id === entry.project_id) ??
    (entry.projects as {
      require_timestamps?: boolean;
      is_internal?: boolean;
    } | null);
  const requiresTimestamps = project?.require_timestamps ?? true;
  const projectIsInternal = project?.is_internal === true;

  // Surface the project's auto-link config so the user knows what
  // ticket reference to type into the description. Description-based
  // detection on save handles `AE-640` (Jira key) and
  // `owner/repo#42` (GitHub long form). Bare `#42` resolves against
  // the project's GitHub repo when configured.
  const autolinkProject = projects.find((p) => p.id === entry.project_id);
  const githubRepo = autolinkProject?.github_repo ?? null;
  const jiraProjectKey = autolinkProject?.jira_project_key ?? null;

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      onKeyDown={handleKeyDown}
      className="space-y-3"
    >
      {locked && (
        <AlertBanner tone="warning">{tLock("editBlocked")}</AlertBanner>
      )}
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <input type="hidden" name="id" value={entry.id} />
      {tzOffsetMin !== undefined && (
        <input type="hidden" name="tz_offset_min" value={String(tzOffsetMin)} />
      )}
      {/* 12-col grid — hero fields (Project, Category, Description)
          get col-span-6 / 12; compact metadata (Date, Duration,
          Issue, Billable) packs into col-span-4/3/3/2. See
          docs/reference/forms-and-buttons.md → "Field sizing". */}
      <div className={formGridClass}>
        {/* Row 1: Project + Category — paired because the project's
            category-set ids drive what the picker offers. */}
        <div className={formSpanHalf}>
          <label htmlFor={`ie-project-${entry.id}`} className={labelClass}>
            {t("fields.project")}
          </label>
          <select
            id={`ie-project-${entry.id}`}
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
        <div className={formSpanHalf}>
          <CategoryPicker
            categories={categories}
            categorySetIds={[
              entry.projects?.category_set_id,
              projects.find((p) => p.id === entry.project_id)
                ?.extension_category_set_id,
            ]}
            defaultValue={entry.category_id}
          />
        </div>

        {/* Row 2: Description — full-width, multi-line. Imported
            Harvest entries can run hundreds of characters; a single-
            line input truncated. 3 rows fits a typical paragraph
            without auto-grow CLS in the multi-select-table parent. */}
        <div className={formSpanFull}>
          <label htmlFor={`ie-description-${entry.id}`} className={labelClass}>
            {t("fields.description")}
          </label>
          <textarea
            id={`ie-description-${entry.id}`}
            ref={descRef}
            name="description"
            defaultValue={entry.description ?? ""}
            placeholder={t("fields.descriptionPlaceholder")}
            rows={3}
            className={textareaClass}
            aria-describedby={
              githubRepo || jiraProjectKey
                ? `ie-description-${entry.id}-autolink`
                : undefined
            }
          />
          {(githubRepo || jiraProjectKey) && (
            <p
              id={`ie-description-${entry.id}-autolink`}
              className="mt-1 text-caption text-content-muted"
            >
              {t("fields.autolinkHint", {
                jiraExample: jiraProjectKey
                  ? `${jiraProjectKey}-123`
                  : "PROJ-123",
                githubExample: githubRepo
                  ? `${githubRepo}#42`
                  : "owner/repo#42",
              })}
            </p>
          )}
        </div>

        {/* Row 3: Date/time fields — compact. Datetime-locals get
            slightly more room than the date+duration pair. */}
        {requiresTimestamps ? (
          <>
            <div className={formSpanThird}>
              <label
                htmlFor={`ie-start-${entry.id}`}
                className={labelClass}
              >
                {t("fields.startTime")} *
              </label>
              <input
                id={`ie-start-${entry.id}`}
                name="start_time"
                type="datetime-local"
                required
                defaultValue={toLocalDatetime(entry.start_time)}
                className={inputClass}
                aria-describedby={
                  fieldErrors.start_time
                    ? `ie-start-${entry.id}-error`
                    : undefined
                }
              />
              <FieldError
                error={fieldErrors.start_time}
                id={`ie-start-${entry.id}-error`}
              />
            </div>
            <div className={formSpanThird}>
              <label htmlFor={`ie-end-${entry.id}`} className={labelClass}>
                {t("fields.endTime")}
              </label>
              <input
                id={`ie-end-${entry.id}`}
                name="end_time"
                type="datetime-local"
                defaultValue={entry.end_time ? toLocalDatetime(entry.end_time) : ""}
                className={inputClass}
              />
            </div>
          </>
        ) : (
          <>
            <div className={formSpanThird}>
              <label htmlFor={`ie-date-${entry.id}`} className={labelClass}>
                {t("fields.date")} *
              </label>
              <input
                id={`ie-date-${entry.id}`}
                name="entry_date"
                type="date"
                required
                defaultValue={toLocalDate(entry.start_time)}
                className={inputClass}
              />
            </div>
            <div className={formSpanQuarter}>
              <label
                htmlFor={`ie-duration-${entry.id}`}
                className={labelClass}
              >
                {t("fields.duration")} *
              </label>
              <DurationInput
                name="duration_min"
                defaultMinutes={entry.duration_min ?? 0}
                ariaLabel={t("fields.duration")}
              />
            </div>
          </>
        )}

        {/* Row 4: Metadata — GitHub issue + billable. Compact spans;
            metadata shouldn't be as visually loud as Project /
            Description. */}
        <div className={formSpanQuarter}>
          <label htmlFor={`ie-github-issue-${entry.id}`} className={labelClass}>
            {t("fields.githubIssue")}
          </label>
          <input
            id={`ie-github-issue-${entry.id}`}
            name="github_issue"
            type="number"
            min="1"
            defaultValue={entry.github_issue ?? ""}
            className={inputClass}
          />
        </div>
        <div className={`${formSpanCompact} flex items-end pb-1`}>
          {(() => {
            const label = (
              <label
                className={`flex items-center gap-2 text-body-lg font-medium ${projectIsInternal ? "text-content-muted cursor-not-allowed" : "text-content cursor-pointer"}`}
              >
                <input
                  name="billable"
                  type="checkbox"
                  defaultChecked={entry.billable && !projectIsInternal}
                  disabled={projectIsInternal || locked}
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
        <SubmitButton
          label={t("saveChanges")}
          pending={pending}
          disabled={locked}
          success={success}
          successMessage={tc("actions.saved")}
        />
        <button
          type="button"
          disabled={pending}
          onClick={onDone}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
