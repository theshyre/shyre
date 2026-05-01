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
          <label className={labelClass}>{t("fields.description")}</label>
          <textarea
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
            <div className={formSpanThird}>
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
            <div className={formSpanThird}>
              <label className={labelClass}>{t("fields.date")} *</label>
              <input
                name="entry_date"
                type="date"
                required
                defaultValue={toLocalDate(entry.start_time)}
                className={inputClass}
              />
            </div>
            <div className={formSpanQuarter}>
              <label className={labelClass}>{t("fields.duration")} *</label>
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
          <label className={labelClass}>{t("fields.githubIssue")}</label>
          <input
            name="github_issue"
            type="number"
            min="1"
            defaultValue={entry.github_issue ?? ""}
            className={inputClass}
          />
        </div>
        <div className={`${formSpanCompact} flex items-end pb-1`}>
          <label className="flex items-center gap-2 text-body-lg font-medium text-content cursor-pointer">
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
