"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { updateTimeEntryAction } from "./actions";
import { CategoryPicker } from "./category-picker";
import { DurationInput } from "./duration-input";
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
  const descRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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
  // in the projects list). We need require_timestamps to decide the form shape.
  const project =
    projects.find((p) => p.id === entry.project_id) ??
    (entry.projects as { require_timestamps?: boolean } | null);
  const requiresTimestamps = project?.require_timestamps ?? true;

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      onKeyDown={handleKeyDown}
      className="space-y-3"
    >
      {serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {serverError}
        </p>
      )}
      <input type="hidden" name="id" value={entry.id} />
      {tzOffsetMin !== undefined && (
        <input type="hidden" name="tz_offset_min" value={String(tzOffsetMin)} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{t("fields.project")}</label>
          <select
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
            ref={descRef}
            name="description"
            defaultValue={entry.description ?? ""}
            placeholder={t("fields.descriptionPlaceholder")}
            className={inputClass}
          />
        </div>
        {requiresTimestamps ? (
          <>
            <div>
              <label className={labelClass}>{t("fields.startTime")} *</label>
              <input
                name="start_time"
                type="datetime-local"
                required
                defaultValue={toLocalDatetime(entry.start_time)}
                className={inputClass}
              />
              <FieldError error={fieldErrors.start_time} />
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
          </>
        ) : (
          <>
            <div>
              <label className={labelClass}>{t("fields.date")} *</label>
              <input
                name="entry_date"
                type="date"
                required
                defaultValue={toLocalDate(entry.start_time)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t("fields.duration")} *</label>
              <DurationInput
                name="duration_min"
                defaultMinutes={entry.duration_min ?? 0}
                ariaLabel={t("fields.duration")}
              />
            </div>
          </>
        )}
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
        <div className="sm:col-span-2">
          <CategoryPicker
            categories={categories}
            categorySetIds={[
              entry.projects?.category_set_id,
              // Look up the project's extension set via the projects list so
              // edit pickers see base + project-specific additions.
              projects.find((p) => p.id === entry.project_id)
                ?.extension_category_set_id,
            ]}
            defaultValue={entry.category_id}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <SubmitButton
          label={t("saveChanges")}
          pending={pending}
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
