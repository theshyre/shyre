"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, Plus, Pencil, X } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
} from "@/lib/form-styles";
import {
  createStateRegistrationAction,
  updateStateRegistrationAction,
  deleteStateRegistrationAction,
} from "../../registrations-actions";

export interface StateRegistrationRow {
  id: string;
  state: string;
  is_formation: boolean;
  registration_type: "domestic" | "foreign_qualification";
  entity_number: string | null;
  state_tax_id: string | null;
  registered_on: string | null;
  nexus_start_date: string | null;
  registration_status:
    | "pending"
    | "active"
    | "delinquent"
    | "withdrawn"
    | "revoked";
  withdrawn_on: string | null;
  revoked_on: string | null;
  report_frequency: "annual" | "biennial" | "decennial" | null;
  due_rule: "fixed_date" | "anniversary" | "quarter_end" | null;
  annual_report_due_mmdd: string | null;
  next_due_date: string | null;
  annual_report_fee_cents: number | null;
  registered_agent_id: string | null;
  notes: string | null;
}

interface Props {
  businessId: string;
  registrations: StateRegistrationRow[];
  /** Whether the current viewer can edit (owner/admin). Read-only otherwise. */
  canEdit: boolean;
}

/** True if the business already has a formation row (excluding the row being edited). */
function hasExistingFormation(
  registrations: StateRegistrationRow[],
  excludeId: string | null,
): boolean {
  return registrations.some(
    (r) => r.is_formation && r.id !== excludeId,
  );
}

const STATUS_TONE: Record<StateRegistrationRow["registration_status"], string> = {
  pending: "bg-surface-inset text-content-secondary",
  active: "bg-success-soft text-success-text",
  delinquent: "bg-warning-soft text-warning-text",
  withdrawn: "bg-surface-inset text-content-muted",
  revoked: "bg-error-soft text-error-text",
};

export function StateRegistrationsSection({
  businessId,
  registrations,
  canEdit,
}: Props): React.JSX.Element {
  const t = useTranslations("business.stateRegistrations");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const sorted = [...registrations].sort((a, b) => {
    if (a.is_formation !== b.is_formation) return a.is_formation ? -1 : 1;
    return a.state.localeCompare(b.state);
  });

  return (
    <section
      className="space-y-3 rounded-lg border border-edge bg-surface-raised p-5"
      aria-labelledby="state-registrations-heading"
    >
      <div className="flex items-start gap-3 flex-wrap">
        <MapPin size={20} className="text-accent shrink-0 mt-0.5" />
        <div className="flex-1 min-w-[200px]">
          <h2
            id="state-registrations-heading"
            className="text-title font-semibold text-content"
          >
            {t("sectionTitle")}
          </h2>
          <p className="mt-1 text-body text-content-secondary max-w-3xl">
            {t("sectionDescription")}
          </p>
        </div>
        {canEdit && !adding && editingId === null ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`${buttonSecondaryClass} inline-flex items-center gap-1.5 self-start`}
          >
            <Plus size={14} />
            {t("addButton")}
          </button>
        ) : null}
      </div>

      {sorted.length === 0 && !adding ? (
        <p className="text-body text-content-muted italic py-2">{t("empty")}</p>
      ) : null}

      {sorted.length > 0 ? (
        <ul className="divide-y divide-edge-muted border-t border-edge-muted">
          {sorted.map((row) =>
            editingId === row.id ? (
              <li key={row.id} className="py-3">
                <RegistrationForm
                  businessId={businessId}
                  registration={row}
                  defaultIsFormation={row.is_formation}
                  onDone={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={row.id} className="py-3">
                <RegistrationRow
                  row={row}
                  canEdit={canEdit}
                  businessId={businessId}
                  onEdit={() => setEditingId(row.id)}
                />
              </li>
            ),
          )}
        </ul>
      ) : null}

      {adding ? (
        <div className="pt-3 border-t border-edge-muted">
          <RegistrationForm
            businessId={businessId}
            registration={null}
            defaultIsFormation={!hasExistingFormation(registrations, null)}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────
// Row rendering
// ────────────────────────────────────────────────────────────────

function RegistrationRow({
  row,
  canEdit,
  businessId,
  onEdit,
}: {
  row: StateRegistrationRow;
  canEdit: boolean;
  businessId: string;
  onEdit: () => void;
}): React.JSX.Element {
  const t = useTranslations("business.stateRegistrations");
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="flex items-start gap-3 flex-wrap">
      <div className="flex items-center gap-2 font-mono font-semibold text-title text-content min-w-[52px]">
        {row.state}
      </div>

      <div className="flex-1 min-w-[200px] space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {row.is_formation ? (
            <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-caption font-medium text-accent-text">
              {t("formationBadge")}
            </span>
          ) : null}
          <span className="text-body text-content-secondary">
            {t(`types.${row.registration_type}`)}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium ${STATUS_TONE[row.registration_status]}`}
          >
            {t(`statuses.${row.registration_status}`)}
          </span>
        </div>

        <div className="text-caption text-content-muted flex flex-wrap gap-x-3 gap-y-0.5">
          {row.entity_number ? (
            <span>
              <span className="text-content-muted">#</span>{" "}
              <span className="font-mono">{row.entity_number}</span>
            </span>
          ) : null}
          {row.registered_on ? <span>{row.registered_on}</span> : null}
          {row.report_frequency ? (
            <span>{t(`reportFrequencies.${row.report_frequency}`)}</span>
          ) : null}
          {row.next_due_date ? (
            <span>Next due: {row.next_due_date}</span>
          ) : null}
        </div>
      </div>

      {canEdit && !deleting ? (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className={`${buttonGhostClass} inline-flex items-center gap-1`}
            aria-label={`Edit ${row.state} registration`}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className={`${buttonGhostClass} inline-flex items-center gap-1 text-error-text hover:bg-error-soft`}
            aria-label={`Delete ${row.state} registration`}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {deleting ? (
        <div className="w-full pt-2">
          <InlineDeleteRowConfirm
            summary={t("deleteSummary", { state: row.state })}
            ariaLabel={`Delete ${row.state} registration`}
            onConfirm={async () => {
              const fd = new FormData();
              fd.set("business_id", businessId);
              fd.set("registration_id", row.id);
              await deleteStateRegistrationAction(fd);
              setDeleting(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Create / edit form
// ────────────────────────────────────────────────────────────────

function RegistrationForm({
  businessId,
  registration,
  defaultIsFormation,
  onDone,
}: {
  businessId: string;
  registration: StateRegistrationRow | null;
  /** Checked state for the formation toggle on first render. On create,
   * this is true if the business has no other formation row yet — the
   * user's first registration is almost always the formation state. */
  defaultIsFormation: boolean;
  onDone: () => void;
}): React.JSX.Element {
  const t = useTranslations("business.stateRegistrations");
  const tc = useTranslations("common");
  const isEdit = registration !== null;

  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: isEdit ? updateStateRegistrationAction : createStateRegistrationAction,
    onSuccess: onDone,
  });

  const initial = registration ?? {
    state: "",
    is_formation: defaultIsFormation,
    entity_number: null,
    state_tax_id: null,
    registered_on: null,
    nexus_start_date: null,
    registration_status: "pending" as const,
    withdrawn_on: null,
    revoked_on: null,
    report_frequency: null,
    due_rule: null,
    annual_report_due_mmdd: null,
    next_due_date: null,
    annual_report_fee_cents: null,
    registered_agent_id: null,
    notes: null,
  };

  return (
    <form action={handleSubmit} className="space-y-3">
      <input type="hidden" name="business_id" value={businessId} />
      {registration ? (
        <input type="hidden" name="registration_id" value={registration.id} />
      ) : null}

      {serverError ? <AlertBanner tone="error">{serverError}</AlertBanner> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="state-registrations-section-state" className={labelClass}>{t("fields.state")}</label>
          <input id="state-registrations-section-state"
            name="state"
            defaultValue={initial.state}
            placeholder={t("fields.statePlaceholder")}
            maxLength={2}
            required
            autoFocus
            className={`${inputClass} font-mono uppercase`}
          />
        </div>

        <div className="sm:col-span-2 rounded-md border border-edge-muted bg-surface p-3">
          <label className="flex items-start gap-2 text-body text-content">
            <input
              type="checkbox"
              name="is_formation"
              value="true"
              defaultChecked={initial.is_formation}
              className="h-4 w-4 mt-0.5 shrink-0"
            />
            <span className="flex-1">
              <span className="font-medium">{t("fields.isFormation")}</span>
              <span className="mt-1 block text-caption text-content-muted">
                {t("fields.isFormationHelp")}
              </span>
            </span>
          </label>
        </div>

        <div>
          <label htmlFor="state-registrations-section-entityNumber" className={labelClass}>{t("fields.entityNumber")}</label>
          <input id="state-registrations-section-entityNumber"
            name="entity_number"
            defaultValue={initial.entity_number ?? ""}
            className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="state-registrations-section-stateTaxId" className={labelClass}>{t("fields.stateTaxId")}</label>
          <input id="state-registrations-section-stateTaxId"
            name="state_tax_id"
            defaultValue={initial.state_tax_id ?? ""}
            className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="state-registrations-section-registeredOn" className={labelClass}>{t("fields.registeredOn")}</label>
          <input id="state-registrations-section-registeredOn"
            type="date"
            name="registered_on"
            defaultValue={initial.registered_on ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="state-registrations-section-nexusStartDate" className={labelClass}>{t("fields.nexusStartDate")}</label>
          <input id="state-registrations-section-nexusStartDate"
            type="date"
            name="nexus_start_date"
            defaultValue={initial.nexus_start_date ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="state-registrations-section-registrationStatus" className={labelClass}>{t("fields.registrationStatus")}</label>
          <select id="state-registrations-section-registrationStatus"
            name="registration_status"
            defaultValue={initial.registration_status}
            className={selectClass}
          >
            <option value="pending">{t("statuses.pending")}</option>
            <option value="active">{t("statuses.active")}</option>
            <option value="delinquent">{t("statuses.delinquent")}</option>
            <option value="withdrawn">{t("statuses.withdrawn")}</option>
            <option value="revoked">{t("statuses.revoked")}</option>
          </select>
        </div>

        <div>
          <label htmlFor="state-registrations-section-reportFrequency" className={labelClass}>{t("fields.reportFrequency")}</label>
          <select id="state-registrations-section-reportFrequency"
            name="report_frequency"
            defaultValue={initial.report_frequency ?? ""}
            className={selectClass}
          >
            <option value="">—</option>
            <option value="annual">{t("reportFrequencies.annual")}</option>
            <option value="biennial">{t("reportFrequencies.biennial")}</option>
            <option value="decennial">{t("reportFrequencies.decennial")}</option>
          </select>
        </div>

        <div>
          <label htmlFor="state-registrations-section-dueRule" className={labelClass}>{t("fields.dueRule")}</label>
          <select id="state-registrations-section-dueRule"
            name="due_rule"
            defaultValue={initial.due_rule ?? ""}
            className={selectClass}
          >
            <option value="">—</option>
            <option value="fixed_date">{t("dueRules.fixed_date")}</option>
            <option value="anniversary">{t("dueRules.anniversary")}</option>
            <option value="quarter_end">{t("dueRules.quarter_end")}</option>
          </select>
        </div>

        <div>
          <label htmlFor="state-registrations-section-annualReportDue" className={labelClass}>{t("fields.annualReportDue")}</label>
          <input id="state-registrations-section-annualReportDue"
            name="annual_report_due_mmdd"
            defaultValue={initial.annual_report_due_mmdd ?? ""}
            placeholder="MM-DD"
            pattern="^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"
            className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="state-registrations-section-nextDueDate" className={labelClass}>{t("fields.nextDueDate")}</label>
          <input id="state-registrations-section-nextDueDate"
            type="date"
            name="next_due_date"
            defaultValue={initial.next_due_date ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="state-registrations-section-annualReportFee" className={labelClass}>{t("fields.annualReportFee")}</label>
          <input id="state-registrations-section-annualReportFee"
            type="number"
            name="annual_report_fee_cents"
            min={0}
            step={1}
            defaultValue={initial.annual_report_fee_cents ?? ""}
            className={`${inputClass} font-mono`}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="state-registrations-section-notes" className={labelClass}>{t("fields.notes")}</label>
          <input id="state-registrations-section-notes"
            name="notes"
            defaultValue={initial.notes ?? ""}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <SubmitButton
          label={t("save")}
          pending={pending}
          success={success}
          successMessage={tc("actions.saved")}
          className={buttonPrimaryClass}
        />
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className={buttonGhostClass}
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
