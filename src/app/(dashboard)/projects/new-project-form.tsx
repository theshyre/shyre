"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Building2, Sparkles } from "lucide-react";
import { AlertBanner, useKeyboardShortcut } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { TeamSelector } from "@/components/TeamSelector";
import type { TeamListItem } from "@/lib/team-context";
import type { CategorySet } from "@/lib/categories/types";
import {
  applyParentDefaults,
  readParentInheritableFields,
} from "@/lib/projects/parent-defaults";
import { createProjectAction } from "./actions";

interface CustomerOption {
  id: string;
  name: string;
}

interface ParentProjectOption {
  id: string;
  name: string;
  customer_id: string | null;
  is_internal: boolean;
  /** Inheritable fields — pulled by the page query so the New form
   *  can pre-fill its inputs from the picked parent. See
   *  `src/lib/projects/parent-defaults.ts` for the full list +
   *  rationale for each field included / excluded. */
  hourly_rate: number | string | null;
  default_billable: boolean | null;
  github_repo: string | null;
  jira_project_key: string | null;
  invoice_code: string | null;
  category_set_id: string | null;
  require_timestamps: boolean | null;
}

export function NewProjectForm({
  customers,
  teams,
  defaultTeamId,
  categorySets,
  eligibleParents = [],
}: {
  customers: CustomerOption[];
  teams: TeamListItem[];
  defaultTeamId?: string;
  categorySets: CategorySet[];
  /** Top-level projects the new project can be nested under. The
   *  dropdown filters this list client-side by the picked customer
   *  (parent + child must share customer_id, enforced server-side
   *  by the projects_enforce_parent_invariants trigger). */
  eligibleParents?: ParentProjectOption[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // is_internal drives whether the customer picker is hidden and
  // whether default_billable is forced off. Local state only — the
  // form submits the checkbox value and the server normalizes.
  const [isInternal, setIsInternal] = useState(false);
  // Selected customer drives the visible parent options — the
  // trigger refuses cross-customer parents at the DB level, but we
  // also filter client-side so the user can't pick an invalid one.
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  // Selected parent id — controlled so we can react to changes and
  // pre-fill inheritable fields. Empty string === "no parent".
  const [selectedParentId, setSelectedParentId] = useState<string>("");

  // Inheritable fields — controlled so the parent-pick handler can
  // populate them. Each one carries a `<field>Touched` flag that
  // flips true the moment the user types/clicks; once touched, a
  // later parent change does NOT clobber the user's value (their
  // intent wins). Uses raw strings for inputs so we can fill empties
  // without coercion surprises.
  const [hourlyRate, setHourlyRate] = useState<string>("");
  const [hourlyRateTouched, setHourlyRateTouched] = useState(false);
  const [githubRepo, setGithubRepo] = useState<string>("");
  const [githubRepoTouched, setGithubRepoTouched] = useState(false);
  const [invoiceCode, setInvoiceCode] = useState<string>("");
  const [invoiceCodeTouched, setInvoiceCodeTouched] = useState(false);
  const [categorySetId, setCategorySetId] = useState<string>("");
  const [categorySetIdTouched, setCategorySetIdTouched] = useState(false);
  const [defaultBillable, setDefaultBillable] = useState<boolean>(true);
  const [defaultBillableTouched, setDefaultBillableTouched] = useState(false);
  const [requireTimestamps, setRequireTimestamps] = useState<boolean>(false);
  const [requireTimestampsTouched, setRequireTimestampsTouched] =
    useState(false);
  // Tracks whether the currently-displayed values came from a
  // parent — drives the "Filled from parent" hint. Cleared when
  // parent goes back to "(none)" or when the form closes.
  const [parentDefaultsApplied, setParentDefaultsApplied] = useState(false);

  const t = useTranslations("projects");
  const tc = useTranslations("common");

  function resetForm(): void {
    setIsInternal(false);
    setSelectedCustomerId("");
    setSelectedParentId("");
    setHourlyRate("");
    setHourlyRateTouched(false);
    setGithubRepo("");
    setGithubRepoTouched(false);
    setInvoiceCode("");
    setInvoiceCodeTouched(false);
    setCategorySetId("");
    setCategorySetIdTouched(false);
    setDefaultBillable(true);
    setDefaultBillableTouched(false);
    setRequireTimestamps(false);
    setRequireTimestampsTouched(false);
    setParentDefaultsApplied(false);
  }

  const { pending, success, serverError, fieldErrors, handleSubmit } = useFormAction({
    action: createProjectAction,
    onSuccess: () => {
      setOpen(false);
      resetForm();
    },
  });

  function handleParentSelect(parentId: string): void {
    setSelectedParentId(parentId);
    if (!parentId) {
      setParentDefaultsApplied(false);
      return;
    }
    const parent = eligibleParents.find((p) => p.id === parentId);
    const defaults = readParentInheritableFields(parent ?? null);
    if (!defaults) {
      setParentDefaultsApplied(false);
      return;
    }
    const { values, appliedAny } = applyParentDefaults(
      defaults,
      {
        hourly_rate: hourlyRate,
        github_repo: githubRepo,
        invoice_code: invoiceCode,
        category_set_id: categorySetId,
        default_billable: defaultBillable,
        require_timestamps: requireTimestamps,
      },
      {
        hourly_rate: hourlyRateTouched,
        github_repo: githubRepoTouched,
        invoice_code: invoiceCodeTouched,
        category_set_id: categorySetIdTouched,
        default_billable: defaultBillableTouched,
        require_timestamps: requireTimestampsTouched,
      },
    );
    setHourlyRate(values.hourly_rate);
    setGithubRepo(values.github_repo);
    setInvoiceCode(values.invoice_code);
    setCategorySetId(values.category_set_id);
    setDefaultBillable(values.default_billable);
    setRequireTimestamps(values.require_timestamps);
    setParentDefaultsApplied(appliedAny);
  }

  useKeyboardShortcut({
    key: "n",
    // React Compiler memoizes inline callbacks at the call site;
    // a manual useCallback here triggered the "inferred deps don't
    // match" rule because setOpen is a deps-relevant identifier.
    // Inline is correct.
    onTrigger: () => setOpen(true),
    enabled: !open,
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`${buttonPrimaryClass} mt-4`}
      >
        <Plus size={16} />
        {t("addProject")}
        <kbd className={kbdClass}>N</kbd>
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="mt-4 space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <TeamSelector teams={teams} defaultTeamId={defaultTeamId} />

      {/* Project type — internal vs client work — is the most
          important decision on this form. Drive it to the top so the
          subsequent fields (customer picker, default billable) make
          sense in the chosen context. */}
      <div className="rounded-md border border-edge bg-surface-inset p-3">
        <label className="flex items-start gap-2 text-body-lg font-medium text-content cursor-pointer">
          <input
            name="is_internal"
            type="checkbox"
            checked={isInternal}
            onChange={(e) => setIsInternal(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
          />
          <span className="flex-1">
            <span className="flex items-center gap-2">
              <Building2 size={14} className="text-content-muted" />
              {t("fields.isInternal")}
            </span>
            <span className="ml-1 mt-0.5 block text-caption font-normal text-content-muted">
              {t("fields.isInternalHint")}
            </span>
          </span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="new-project-name" className={labelClass}>
            {t("fields.name")} *
          </label>
          <input
            id="new-project-name"
            name="name"
            required
            autoFocus
            className={inputClass}
            aria-describedby={
              fieldErrors.name ? "new-project-name-error" : undefined
            }
          />
          <FieldError error={fieldErrors.name} id="new-project-name-error" />
        </div>
        {isInternal ? (
          // Customer picker is hidden for internal projects; the
          // server normalizes customer_id to NULL even if a stale
          // value is submitted.
          <div className="flex items-end">
            <p className="text-caption text-content-muted">
              {t("fields.internalProjectNoCustomer")}
            </p>
          </div>
        ) : (
          <div>
            <label htmlFor="new-project-customer" className={labelClass}>
              {t("fields.customer")} *
            </label>
            <select
              id="new-project-customer"
              name="customer_id"
              required
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className={selectClass}
              aria-describedby={
                fieldErrors.customer_id
                  ? "new-project-customer-error"
                  : undefined
              }
            >
              <option value="">{t("fields.pickCustomer")}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <FieldError
              error={fieldErrors.customer_id}
              id="new-project-customer-error"
            />
          </div>
        )}
        {/* Parent project — opt-in nesting. Renders only when a
            customer is picked (since the trigger requires same
            customer) and there's at least one eligible top-level
            project under that customer. Hidden for internal projects;
            mixed internal/external nesting isn't a current use case. */}
        {!isInternal &&
          selectedCustomerId &&
          eligibleParents.some(
            (p) => !p.is_internal && p.customer_id === selectedCustomerId,
          ) && (
            <div className="sm:col-span-2">
              <label
                htmlFor="new-project-parent"
                className={labelClass}
              >
                {t("fields.parentProject")}
              </label>
              <select
                id="new-project-parent"
                name="parent_project_id"
                value={selectedParentId}
                onChange={(e) => handleParentSelect(e.target.value)}
                className={selectClass}
              >
                <option value="">{t("fields.parentProjectNone")}</option>
                {eligibleParents
                  .filter(
                    (p) =>
                      !p.is_internal &&
                      p.customer_id === selectedCustomerId,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-caption text-content-muted">
                {t("fields.parentProjectHint")}
              </p>
              {parentDefaultsApplied && selectedParentId && (
                <p className="mt-1 inline-flex items-center gap-1 text-caption text-accent-text">
                  <Sparkles size={12} aria-hidden="true" />
                  {t("fields.parentInheritedHint")}
                </p>
              )}
            </div>
          )}
        <div>
          <label htmlFor="new-project-hourly-rate" className={labelClass}>
            {t("fields.hourlyRate")}
          </label>
          <input
            id="new-project-hourly-rate"
            name="hourly_rate"
            type="number"
            step="0.01"
            min="0"
            value={hourlyRate}
            onChange={(e) => {
              setHourlyRate(e.target.value);
              setHourlyRateTouched(true);
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="new-project-budget-hours" className={labelClass}>
            {t("fields.budgetHours")}
          </label>
          <input
            id="new-project-budget-hours"
            name="budget_hours"
            type="number"
            step="0.5"
            min="0"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="projects-new-project-form-githubRepo" className={labelClass}>{t("fields.githubRepo")}</label>
          <input id="projects-new-project-form-githubRepo"
            name="github_repo"
            placeholder={t("fields.githubRepoPlaceholder")}
            value={githubRepo}
            onChange={(e) => {
              setGithubRepo(e.target.value);
              setGithubRepoTouched(true);
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="projects-new-project-form-invoiceCode" className={labelClass}>{t("fields.invoiceCode")}</label>
          <input id="projects-new-project-form-invoiceCode"
            name="invoice_code"
            placeholder={t("fields.invoiceCodePlaceholder")}
            maxLength={16}
            value={invoiceCode}
            onChange={(e) => {
              setInvoiceCode(e.target.value);
              setInvoiceCodeTouched(true);
            }}
            className={`${inputClass} font-mono`}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("fields.invoiceCodeHint")}
          </p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="projects-new-project-form-categorySet" className={labelClass}>{t("fields.categorySet")}</label>
          <select
            id="projects-new-project-form-categorySet"
            name="category_set_id"
            value={categorySetId}
            onChange={(e) => {
              setCategorySetId(e.target.value);
              setCategorySetIdTouched(true);
            }}
            className={selectClass}
          >
            <option value="">{t("fields.noCategorySet")}</option>
            {categorySets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.is_system ? `${s.name} (built-in)` : s.name}
              </option>
            ))}
          </select>
        </div>
        {!isInternal && (
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-body-lg font-medium text-content cursor-pointer">
              <input
                name="default_billable"
                type="checkbox"
                checked={defaultBillable}
                onChange={(e) => {
                  setDefaultBillable(e.target.checked);
                  setDefaultBillableTouched(true);
                }}
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
              onChange={(e) => {
                setRequireTimestamps(e.target.checked);
                setRequireTimestampsTouched(true);
              }}
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
        <label htmlFor="projects-new-project-form-description" className={labelClass}>{t("fields.description")}</label>
        <textarea id="projects-new-project-form-description" name="description" rows={2} className={textareaClass} />
      </div>
      <div className="flex gap-2">
        <SubmitButton label={t("saveProject")} pending={pending} success={success} successMessage={tc("actions.saved")} />
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
