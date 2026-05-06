"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { useFormDirty } from "@/hooks/use-form-dirty";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import { DateField } from "@/components/DateField";
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
import { TicketField, ticketFieldVisible } from "@/components/TicketField";
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

  const [entryDate, setEntryDate] = useState(toLocalDate(entry.start_time));

  const { pending, success, serverError, fieldErrors, handleSubmit } =
    useFormAction({
      action: updateTimeEntryAction,
      onSuccess: () => onDone(),
    });
  // Save button stays disabled until something actually changes —
  // every form submission costs a server roundtrip + an updated_at
  // bump, even no-ops, and a no-op success toast feels broken.
  const dirty = useFormDirty(formRef, success);

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

  // The project's ticket-provider config drives the new <TicketField>
  // (placeholder, label, and whether the row renders at all). Pulled
  // from the projects list — falls back to null when the entry's
  // project isn't in the visible list (rare; should not happen given
  // the page query).
  const autolinkProject = projects.find((p) => p.id === entry.project_id);
  const githubRepo = autolinkProject?.github_repo ?? null;
  const jiraProjectKey = autolinkProject?.jira_project_key ?? null;
  const showTicket = ticketFieldVisible(githubRepo, jiraProjectKey);

  // Map the entry's linked_ticket_* columns into the chip's prop
  // shape. NULL provider means nothing is attached today.
  const attachedTicket =
    entry.linked_ticket_provider && entry.linked_ticket_key
      ? {
          provider: entry.linked_ticket_provider,
          key: entry.linked_ticket_key,
          url: entry.linked_ticket_url,
          title: entry.linked_ticket_title,
        }
      : null;

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
            currentCategoryId={entry.category_id}
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
          {/* `key` is the entry.description so the textarea remounts
              when the chip's "Use as description" action mutates
              entry.description server-side and revalidates this form
              with a fresh prop. Without the key, the uncontrolled
              defaultValue freezes at first-render — the list row
              updated but the open form's textarea kept the pre-edit
              text. Local typing is preserved since the key only
              changes on remote mutations of entry.description. */}
          <textarea
            id={`ie-description-${entry.id}`}
            key={entry.description ?? ""}
            ref={descRef}
            name="description"
            defaultValue={entry.description ?? ""}
            placeholder={t("fields.descriptionPlaceholder")}
            rows={3}
            className={textareaClass}
          />
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
              <DateField
                id={`ie-date-${entry.id}`}
                name="entry_date"
                value={entryDate}
                onChange={setEntryDate}
                disabled={locked}
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

        {/* Row 4: Metadata — linked ticket + billable. The ticket
            cell needs half-width so the attached chip can show
            "{key} — {title}" + the refresh / use-as-description
            buttons without wrapping. When the project has neither
            provider configured, the field collapses entirely and
            billable absorbs the row. */}
        {showTicket && (
          <div className={`${formSpanHalf} min-w-0`}>
            <TicketField
              idPrefix={`ie-${entry.id}`}
              githubRepo={githubRepo}
              jiraProjectKey={jiraProjectKey}
              attached={attachedTicket}
              entryId={entry.id}
              canRefresh={!locked}
              disabled={locked}
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
          disabled={locked || !dirty}
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
