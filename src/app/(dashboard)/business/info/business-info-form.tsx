"use client";

import { useTranslations } from "next-intl";
import type { OrgListItem } from "@/lib/org-context";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { OrgSelector } from "@/components/OrgSelector";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
} from "@/lib/form-styles";
import { updateBusinessIdentityAction } from "../actions";

interface Props {
  orgs: OrgListItem[];
  orgId: string | null;
  legalName: string;
  entityType: string;
  taxId: string;
  stateRegistrationId: string;
  registeredState: string;
  dateIncorporated: string;
  fiscalYearStart: string;
}

const ENTITY_TYPES = [
  "sole_prop",
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "nonprofit",
  "other",
] as const;

export function BusinessInfoForm({
  orgs,
  orgId,
  legalName,
  entityType,
  taxId,
  stateRegistrationId,
  registeredState,
  dateIncorporated,
  fiscalYearStart,
}: Props): React.JSX.Element {
  const t = useTranslations("business.info");
  const tc = useTranslations("common");
  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: updateBusinessIdentityAction,
  });

  return (
    <form
      action={handleSubmit}
      className="space-y-4 rounded-lg border border-edge bg-surface-raised p-5"
    >
      {serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {serverError}
        </p>
      )}

      <OrgSelector orgs={orgs} defaultOrgId={orgId ?? undefined} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>{t("fields.legalName")}</label>
          <input
            name="legal_name"
            defaultValue={legalName}
            placeholder={t("fields.legalNamePlaceholder")}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-content-muted">
            {t("fields.legalNameHelp")}
          </p>
        </div>

        <div>
          <label className={labelClass}>{t("fields.entityType")}</label>
          <select
            name="entity_type"
            defaultValue={entityType}
            className={selectClass}
          >
            <option value="">{t("fields.entityTypeAny")}</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {labelForEntity(t)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>{t("fields.registeredState")}</label>
          <input
            name="registered_state"
            defaultValue={registeredState}
            placeholder="e.g. Delaware, CA"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>{t("fields.taxId")}</label>
          <input
            name="tax_id"
            defaultValue={taxId}
            placeholder="XX-XXXXXXX"
            className={`${inputClass} font-mono`}
          />
          <p className="mt-1 text-xs text-content-muted">
            {t("fields.taxIdHelp")}
          </p>
        </div>

        <div>
          <label className={labelClass}>{t("fields.stateRegistrationId")}</label>
          <input
            name="state_registration_id"
            defaultValue={stateRegistrationId}
            className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label className={labelClass}>{t("fields.dateIncorporated")}</label>
          <input
            name="date_incorporated"
            type="date"
            defaultValue={dateIncorporated}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>{t("fields.fiscalYearStart")}</label>
          <input
            name="fiscal_year_start"
            defaultValue={fiscalYearStart}
            placeholder="01-01"
            pattern="^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"
            className={`${inputClass} font-mono`}
          />
          <p className="mt-1 text-xs text-content-muted">
            {t("fields.fiscalYearStartHelp")}
          </p>
        </div>
      </div>

      <SubmitButton
        label={t("save")}
        pending={pending}
        success={success}
        successMessage={tc("actions.saved")}
        className={buttonPrimaryClass}
      />
    </form>
  );
}

function labelForEntity(key: string): string {
  return (
    {
      sole_prop: "Sole Proprietorship",
      llc: "LLC",
      s_corp: "S-Corp",
      c_corp: "C-Corp",
      partnership: "Partnership",
      nonprofit: "Nonprofit",
      other: "Other",
    }[key] ?? key
  );
}
