"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { AlertBanner, useKeyboardShortcut } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formGridClass,
  formSpanFull,
  formSpanThird,
  formSpanQuarter,
} from "@/lib/form-styles";
import { SubmitButton } from "@/components/SubmitButton";
import { DateField } from "@/components/DateField";
import { createExpenseAction } from "./actions";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./categories";
import { getCategoryHelp } from "./categories-help";
import type { ProjectOption } from "./page";

interface Props {
  /** Default team to charge a new expense to. Used as the hidden
   *  team_id when there's only one team option, or the initial
   *  selection of the team picker when there are multiple. */
  defaultTeamId: string;
  /** Every team in this business that the viewer can write to.
   *  Length 1 → no picker rendered. Length >1 → team selector
   *  shows so multi-team agencies can target the right team. */
  teamOptions: { id: string; name: string }[];
  projects: ProjectOption[];
  /** Optional secondary action rendered next to the "Add expense"
   *  button when the form is collapsed. Hidden when the form
   *  expands so a tall form panel doesn't end up with a button
   *  hanging off its top-right corner. Used today for the "Import
   *  CSV" link on /business/[businessId]/expenses. */
  secondaryAction?: React.ReactNode;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function NewExpenseForm({
  defaultTeamId,
  teamOptions,
  projects,
  secondaryAction,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(defaultTeamId);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [incurredOn, setIncurredOn] = useState<string>(() => todayStr());
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const showTeamPicker = teamOptions.length > 1;
  // When a team is selected, scope the project dropdown to projects
  // owned by that team — a project from Team A can't accept an
  // expense charged to Team B (FK on projects.team_id wouldn't match).
  const projectsForTeam = projects.filter(
    (p) => p.team_id === selectedTeamId,
  );

  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: createExpenseAction,
    onSuccess: () => setOpen(false),
  });

  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => setOpen(true), []),
    enabled: !open,
  });

  if (!open) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={buttonPrimaryClass}
        >
          <Plus size={16} />
          {t("add")}
          <kbd className={kbdClass}>N</kbd>
        </button>
        {secondaryAction}
      </div>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      <input
        type="hidden"
        name="team_id"
        value={showTeamPicker ? selectedTeamId : defaultTeamId}
      />

      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}

      {/* 12-col grid — see docs/reference/forms-and-buttons.md →
          "Field sizing". Compact metadata (Date, Amount, Category)
          on the first row; Vendor + Project + Team in row 2;
          Description + Notes full-width below. */}
      <div className={formGridClass}>
        {/* Row 1: Compact essentials — Date, Amount, Category. */}
        <div className={formSpanThird}>
          <label htmlFor="ne-incurred-on" className={labelClass}>
            {t("fields.incurredOn")} *
          </label>
          <DateField
            id="ne-incurred-on"
            name="incurred_on"
            value={incurredOn}
            onChange={setIncurredOn}
            autoFocus
          />
        </div>
        <div className={formSpanQuarter}>
          <label htmlFor="ne-amount" className={labelClass}>
            {t("fields.amount")} *
          </label>
          <input
            id="ne-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            className={inputClass}
          />
        </div>
        <div className={formSpanThird}>
          <label htmlFor="ne-category" className={labelClass}>
            {t("fields.category")} *
          </label>
          {/* selectClass not inputClass — the select needs the
              chevron padding-right. */}
          <select
            id="ne-category"
            name="category"
            required
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className={selectClass}
          >
            <option value="" disabled>
              {t("selectCategory")}
            </option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </select>
          <CategoryHint category={selectedCategory} />
        </div>

        {/* Row 2: Vendor + Project + (optional) Team. */}
        <div className={formSpanThird}>
          <label htmlFor="ne-vendor" className={labelClass}>
            {t("fields.vendor")}
          </label>
          <input
            id="ne-vendor"
            name="vendor"
            type="text"
            className={inputClass}
          />
        </div>
        <div className={formSpanThird}>
          <label htmlFor="ne-project" className={labelClass}>
            {t("fields.project")}
          </label>
          <select
            id="ne-project"
            name="project_id"
            defaultValue="none"
            className={selectClass}
          >
            <option value="none">{t("noProject")}</option>
            {projectsForTeam.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {showTeamPicker && (
          <div className={formSpanThird}>
            <label htmlFor="ne-team" className={labelClass}>
              {t("fields.team")} *
            </label>
            <select
              id="ne-team"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              required
              className={selectClass}
            >
              {teamOptions.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Row 3: Description (full-width). */}
        <div className={formSpanFull}>
          <label htmlFor="ne-description" className={labelClass}>
            {t("fields.description")}
          </label>
          <textarea
            id="ne-description"
            name="description"
            rows={2}
            className={textareaClass}
          />
        </div>

        {/* Row 4: Notes (full-width). */}
        <div className={formSpanFull}>
          <label htmlFor="ne-notes" className={labelClass}>
            {t("fields.notes")}
          </label>
          <textarea
            id="ne-notes"
            name="notes"
            rows={2}
            placeholder={t("fields.notesPlaceholder")}
            className={textareaClass}
            aria-describedby="ne-notes-hint"
          />
          <p
            id="ne-notes-hint"
            className="mt-1 text-caption text-content-muted"
          >
            {t("fields.notesHint")}
          </p>
        </div>

        {/* Row 5: Billable. */}
        <div className={`${formSpanFull} flex items-center gap-2`}>
          <input
            id="billable"
            type="checkbox"
            name="billable"
            className="h-4 w-4"
          />
          <label
            htmlFor="billable"
            className="text-body-lg font-medium text-content cursor-pointer"
          >
            {t("fields.billable")}
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <SubmitButton
          label={t("save")}
          pending={pending}
          success={success}
          successMessage={tc("actions.saved")}
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}

/** Show the description + examples for the chosen category as a
 *  small caption below the dropdown. Renders nothing when no
 *  category is picked yet — the placeholder option's "— Select
 *  category —" already cues the user to make a choice. */
function CategoryHint({ category }: { category: string }): React.JSX.Element | null {
  const t = useTranslations("expenses");
  if (!category) return null;
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
    return null;
  }
  const help = getCategoryHelp(category as ExpenseCategory, t);
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-caption text-content-muted">{help.description}</p>
      <p className="text-caption text-content-muted italic">
        {help.examples}
      </p>
    </div>
  );
}
