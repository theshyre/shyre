"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Sparkles, X } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
  buttonGhostClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import {
  applyParentDefaults,
  readParentInheritableFields,
} from "@/lib/projects/parent-defaults";
import { updateProjectAction } from "../actions";

interface Project {
  id: string;
  name: string;
  description: string | null;
  hourly_rate: number | null;
  budget_hours: number | null;
  /** Recurring per-period hour cap; null when no recurring cap. */
  budget_hours_per_period: number | null;
  /** Recurring per-period dollar cap. Null when no dollar cap.
   *  RLS-gated through `projects_v` (rate-visibility); pass through
   *  whatever the page query returns. */
  budget_dollars_per_period: number | null;
  /** Period type for the recurring cap. Null = no recurring cap. */
  budget_period: "weekly" | "monthly" | "quarterly" | null;
  /** Carryover policy. v1 only honors 'none'; the others exist for
   *  future expansion and currently behave like 'none'. */
  budget_carryover: "none" | "within_quarter" | "lifetime";
  /** Threshold % at which to fire an alert. Null = no alerts. */
  budget_alert_threshold_pct: number | null;
  github_repo: string | null;
  jira_project_key: string | null;
  invoice_code: string | null;
  status: string | null;
  category_set_id: string | null;
  require_timestamps: boolean;
  is_internal: boolean;
  default_billable: boolean;
  customer_id: string | null;
  parent_project_id: string | null;
}

interface ParentProjectOption {
  id: string;
  name: string;
  customer_id: string | null;
}

interface ParentInheritable {
  id: string;
  name: string;
  hourly_rate: number | string | null;
  default_billable: boolean | null;
  github_repo: string | null;
  jira_project_key: string | null;
  invoice_code: string | null;
  category_set_id: string | null;
  require_timestamps: boolean | null;
}

const STATUSES = ["active", "paused", "completed", "archived"] as const;

export function ProjectEditForm({
  project,
  eligibleParents = [],
  hasChildren = false,
  parent = null,
}: {
  project: Project;
  /** Top-level projects in the same customer the user can re-parent
   *  to. Excludes the project itself. The trigger validates anyway,
   *  but client-side filtering prevents an obvious mistake. */
  eligibleParents?: ParentProjectOption[];
  /** True when this project has sub-projects of its own. Disables
   *  the parent dropdown — a project with children can't itself be
   *  re-parented (would violate the 1-level-deep rule). */
  hasChildren?: boolean;
  /** The full parent row (with inheritable fields) when this project
   *  is currently a sub-project. Drives the "Apply parent's settings"
   *  affordance — clicking it overwrites the inheritable inputs with
   *  the parent's current values. Null for top-level projects. */
  parent?: ParentInheritable | null;
}): React.JSX.Element {
  const t = useTranslations("projects");
  const tc = useTranslations("common");

  // Inheritable fields are controlled state so the "Apply parent's
  // settings" button can overwrite them programmatically. Other
  // fields (name, description, status, budget_hours) stay
  // uncontrolled — they aren't inheritable and benefit from the
  // simpler markup.
  const [hourlyRate, setHourlyRate] = useState<string>(
    project.hourly_rate != null ? String(project.hourly_rate) : "",
  );
  const [githubRepo, setGithubRepo] = useState<string>(
    project.github_repo ?? "",
  );
  const [jiraProjectKey, setJiraProjectKey] = useState<string>(
    project.jira_project_key ?? "",
  );
  const [invoiceCode, setInvoiceCode] = useState<string>(
    project.invoice_code ?? "",
  );
  const [defaultBillable, setDefaultBillable] = useState<boolean>(
    project.default_billable,
  );
  const [requireTimestamps, setRequireTimestamps] = useState<boolean>(
    project.require_timestamps,
  );
  const [parentSelection, setParentSelection] = useState<string>(
    project.parent_project_id ?? "",
  );

  // Inline confirm pattern for the parent-settings overwrite — first
  // click arms, second click within the same render commits. Avoids
  // a browser confirm() dialog (which breaks the in-page flow) and
  // skips a typed-confirm (overkill for a non-destructive overwrite —
  // the data isn't lost; the user can keep editing afterwards).
  const [confirmingApply, setConfirmingApply] = useState(false);

  // The "Apply parent's settings" button is only shown when:
  //   1. the project actually has a parent (loaded as `parent`);
  //   2. the user hasn't changed the parent dropdown to a different
  //      value yet (selecting a new parent without saving means the
  //      `parent` prop no longer matches; force a save first to load
  //      the new parent's defaults). Avoids surprises like applying
  //      the OLD parent's settings after the dropdown has been
  //      pointed elsewhere.
  const canApplyParent =
    parent !== null && parentSelection === parent.id;

  function applyFromParent(): void {
    if (!parent) return;
    const defaults = readParentInheritableFields(parent);
    if (!defaults) return;
    const { values } = applyParentDefaults(
      defaults,
      {
        hourly_rate: hourlyRate,
        github_repo: githubRepo,
        invoice_code: invoiceCode,
        category_set_id: project.category_set_id ?? "",
        default_billable: defaultBillable,
        require_timestamps: requireTimestamps,
      },
      // The retroactive Apply gesture is explicit — every field
      // gets overwritten regardless of what the user previously
      // typed. So mark every field "untouched" so the helper
      // overwrites everything.
      {
        hourly_rate: false,
        github_repo: false,
        invoice_code: false,
        category_set_id: false,
        default_billable: false,
        require_timestamps: false,
      },
    );
    setHourlyRate(values.hourly_rate);
    setGithubRepo(values.github_repo);
    // Jira key isn't on the New form / parent-defaults shape, but
    // it's a parent-inheritable field. Apply directly here.
    setJiraProjectKey(parent.jira_project_key ?? "");
    setInvoiceCode(values.invoice_code);
    setDefaultBillable(values.default_billable);
    setRequireTimestamps(values.require_timestamps);
    setConfirmingApply(false);
  }

  const { pending, success, serverError, fieldErrors, handleSubmit } = useFormAction({
    action: updateProjectAction,
  });

  return (
    <form action={handleSubmit} className="space-y-4">
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <input type="hidden" name="id" value={project.id} />
      {/* Preserve category_set_id on save — it's managed by the
          ProjectCategoriesEditor below, but updateProjectAction reads
          this field and would null it out if absent. */}
      <input
        type="hidden"
        name="category_set_id"
        value={project.category_set_id ?? ""}
      />

      {project.is_internal && (
        // Read-only chip: this project's internal status is managed
        // through setProjectInternalAction, not the regular update
        // path. Surfacing the badge inline keeps the user oriented
        // when they're editing other fields.
        <div className="flex items-center gap-2 rounded-md border border-edge bg-surface-inset px-3 py-2 text-body-lg text-content-secondary">
          <Building2 size={14} className="text-content-muted" />
          {t("fields.isInternalBadge")}
          <span className="text-caption text-content-muted">
            {t("fields.isInternalBadgeHint")}
          </span>
        </div>
      )}

      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="project-edit-name" className={labelClass}>
              {t("fields.name")} *
            </label>
            <input
              id="project-edit-name"
              name="name"
              required
              defaultValue={project.name}
              className={inputClass}
              aria-describedby={
                fieldErrors.name ? "project-edit-name-error" : undefined
              }
            />
            <FieldError
              error={fieldErrors.name}
              id="project-edit-name-error"
            />
          </div>
          <div>
            <label htmlFor="project-edit-status" className={labelClass}>
              {t("fields.status")}
            </label>
            <select
              id="project-edit-status"
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
          {/* Parent project — opt-in nesting. Hidden for internal
              projects (mixed internal/external nesting is not a
              current use case) and disabled when this project
              already has children of its own (1-level-deep rule).
              Eligible parents are scoped to the same customer; the
              trigger enforces this server-side too. */}
          {!project.is_internal && (
            <div>
              <label
                htmlFor="project-edit-parent"
                className={labelClass}
              >
                {t("fields.parentProject")}
              </label>
              <select
                id="project-edit-parent"
                name="parent_project_id"
                value={parentSelection}
                onChange={(e) => {
                  setParentSelection(e.target.value);
                  setConfirmingApply(false);
                }}
                disabled={hasChildren}
                className={selectClass}
                aria-describedby="project-edit-parent-hint"
              >
                <option value="">{t("fields.parentProjectNone")}</option>
                {eligibleParents
                  .filter((p) => p.id !== project.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <p
                id="project-edit-parent-hint"
                className="mt-1 text-caption text-content-muted"
              >
                {hasChildren
                  ? t("fields.parentProjectLockedHasChildren")
                  : t("fields.parentProjectHint")}
              </p>
              {canApplyParent && parent && !confirmingApply && (
                <button
                  type="button"
                  onClick={() => setConfirmingApply(true)}
                  className={`${buttonGhostClass} mt-2 inline-flex items-center gap-1 text-caption text-accent-text`}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  {t("fields.applyParentSettings", { name: parent.name })}
                </button>
              )}
              {confirmingApply && parent && (
                <div className="mt-2 rounded-md border border-accent/30 bg-accent-soft/40 p-2.5 space-y-2">
                  <p className="text-caption text-content-secondary">
                    {t("fields.applyParentSettingsConfirm", {
                      name: parent.name,
                    })}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={applyFromParent}
                      className={`${buttonSecondaryClass} text-caption`}
                      style={{ padding: "2px 10px", height: 28 }}
                    >
                      <Sparkles size={12} aria-hidden="true" />
                      {t("fields.applyParentSettingsApply")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingApply(false)}
                      className={buttonGhostClass}
                      aria-label={tc("actions.cancel")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div>
            <label htmlFor="project-edit-hourly-rate" className={labelClass}>
              {t("fields.hourlyRate")}
            </label>
            <input
              id="project-edit-hourly-rate"
              name="hourly_rate"
              type="number"
              step="0.01"
              min="0"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="project-edit-budget-hours" className={labelClass}>
              {t("fields.budgetHours")}
            </label>
            <input
              id="project-edit-budget-hours"
              name="budget_hours"
              type="number"
              step="0.5"
              min="0"
              defaultValue={project.budget_hours ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="project-edit-github-repo" className={labelClass}>
              {t("fields.githubRepo")}
            </label>
            <input
              id="project-edit-github-repo"
              name="github_repo"
              placeholder={t("fields.githubRepoPlaceholder")}
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.githubRepoHint")}
            </p>
          </div>
          <div>
            <label htmlFor="project-edit-jira-key" className={labelClass}>
              {t("fields.jiraProjectKey")}
            </label>
            <input
              id="project-edit-jira-key"
              name="jira_project_key"
              placeholder={t("fields.jiraProjectKeyPlaceholder")}
              value={jiraProjectKey}
              onChange={(e) => setJiraProjectKey(e.target.value)}
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.jiraProjectKeyHint")}
            </p>
          </div>
          <div>
            <label htmlFor="project-edit-invoice-code" className={labelClass}>
              {t("fields.invoiceCode")}
            </label>
            <input
              id="project-edit-invoice-code"
              name="invoice_code"
              placeholder={t("fields.invoiceCodePlaceholder")}
              value={invoiceCode}
              onChange={(e) => setInvoiceCode(e.target.value)}
              maxLength={16}
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.invoiceCodeHint")}
            </p>
          </div>
          {!project.is_internal && (
            <div className="sm:col-span-2">
              <label className="flex items-start gap-2 text-body-lg font-medium text-content cursor-pointer">
                <input
                  name="default_billable"
                  type="checkbox"
                  checked={defaultBillable}
                  onChange={(e) => setDefaultBillable(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
                />
                <span>
                  {t("fields.defaultBillable")}
                  <span className="ml-1 block text-caption font-normal text-content-muted">
                    {t("fields.defaultBillableHint")}
                  </span>
                </span>
              </label>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-body-lg font-medium text-content cursor-pointer">
              <input
                name="require_timestamps"
                type="checkbox"
                checked={requireTimestamps}
                onChange={(e) => setRequireTimestamps(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
              />
              <span>
                {t("fields.requireTimestamps")}
                <span className="ml-1 block text-caption font-normal text-content-muted">
                  {t("fields.requireTimestampsHint")}
                </span>
              </span>
            </label>
          </div>
        </div>
        <div>
          <label htmlFor="[id]-project-edit-form-description" className={labelClass}>{t("fields.description")}</label>
          <textarea id="[id]-project-edit-form-description"
            name="description"
            rows={3}
            defaultValue={project.description ?? ""}
            className={textareaClass}
          />
        </div>
      </div>

      <BudgetSection project={project} />

      <SubmitButton label={t("saveChanges")} pending={pending} success={success} successMessage={tc("actions.saved")} />
    </form>
  );
}

/**
 * Recurring-budget disclosure section. Collapsed by default — most
 * projects don't carry a recurring cap, and the rule "don't surface
 * what most users don't need" wins on the form's information density.
 * Open the disclosure when any field is non-null so a user editing
 * an existing recurring cap doesn't have to hunt for it.
 *
 * Fields land via FormData in the standard way; updateProjectAction
 * gates them through the rate-edit permission alongside hourly_rate.
 */
function BudgetSection({ project }: { project: Project }): React.JSX.Element {
  const t = useTranslations("projects");
  const hasRecurring = project.budget_period !== null;
  const [open, setOpen] = useState(hasRecurring);
  const [period, setPeriod] = useState<string>(project.budget_period ?? "");
  const [hoursPer, setHoursPer] = useState<string>(
    project.budget_hours_per_period != null
      ? String(project.budget_hours_per_period)
      : "",
  );
  const [dollarsPer, setDollarsPer] = useState<string>(
    project.budget_dollars_per_period != null
      ? String(project.budget_dollars_per_period)
      : "",
  );
  const [carryover, setCarryover] = useState<string>(
    project.budget_carryover ?? "none",
  );
  const [threshold, setThreshold] = useState<string>(
    project.budget_alert_threshold_pct != null
      ? String(project.budget_alert_threshold_pct)
      : "",
  );

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 text-body-lg font-medium text-content w-full text-left"
      >
        <span className="text-content-muted">{open ? "▼" : "▶"}</span>
        {t("fields.recurringBudgetSection")}
        {hasRecurring && !open && (
          <span className="ml-auto text-caption text-content-muted">
            {t("fields.recurringBudgetActive")}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="project-edit-budget-period" className={labelClass}>
              {t("fields.budgetPeriod")}
            </label>
            <select
              id="project-edit-budget-period"
              name="budget_period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className={selectClass}
            >
              <option value="">{t("fields.budgetPeriodNone")}</option>
              <option value="weekly">{t("fields.budgetPeriodWeekly")}</option>
              <option value="monthly">{t("fields.budgetPeriodMonthly")}</option>
              <option value="quarterly">{t("fields.budgetPeriodQuarterly")}</option>
            </select>
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.budgetPeriodHint")}
            </p>
          </div>
          <div>
            <label
              htmlFor="project-edit-budget-carryover"
              className={labelClass}
            >
              {t("fields.budgetCarryover")}
            </label>
            <select
              id="project-edit-budget-carryover"
              name="budget_carryover"
              value={carryover}
              onChange={(e) => setCarryover(e.target.value)}
              className={selectClass}
            >
              <option value="none">{t("fields.budgetCarryoverNone")}</option>
              <option value="within_quarter">
                {t("fields.budgetCarryoverWithinQuarter")}
              </option>
              <option value="lifetime">
                {t("fields.budgetCarryoverLifetime")}
              </option>
            </select>
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.budgetCarryoverHint")}
            </p>
          </div>
          <div>
            <label
              htmlFor="project-edit-budget-hours-per-period"
              className={labelClass}
            >
              {t("fields.budgetHoursPerPeriod")}
            </label>
            <input
              id="project-edit-budget-hours-per-period"
              name="budget_hours_per_period"
              type="number"
              step="0.5"
              min="0"
              value={hoursPer}
              onChange={(e) => setHoursPer(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="project-edit-budget-dollars-per-period"
              className={labelClass}
            >
              {t("fields.budgetDollarsPerPeriod")}
            </label>
            <input
              id="project-edit-budget-dollars-per-period"
              name="budget_dollars_per_period"
              type="number"
              step="0.01"
              min="0"
              value={dollarsPer}
              onChange={(e) => setDollarsPer(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor="project-edit-budget-threshold"
              className={labelClass}
            >
              {t("fields.budgetAlertThreshold")}
            </label>
            <input
              id="project-edit-budget-threshold"
              name="budget_alert_threshold_pct"
              type="number"
              step="1"
              min="1"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={t("fields.budgetAlertThresholdPlaceholder")}
              className={inputClass}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("fields.budgetAlertThresholdHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
