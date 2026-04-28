"use client";

import { useTranslations } from "next-intl";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
} from "@/lib/form-styles";
import { updateBusinessIdentityAction } from "../../actions";

interface Props {
  businessId: string;
  legalName: string;
  entityType: string;
  taxId: string;
  dateIncorporated: string;
  fiscalYearStart: string;
  /** Whether the viewer is owner|admin and may see/edit the
   *  sensitive identity fields (tax_id / incorporation date / fiscal
   *  year start). Defaults to false so a forgotten prop fails closed. */
  canEditPrivate?: boolean;
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

const ENTITY_LABEL: Record<string, string> = {
  sole_prop: "Sole Proprietorship",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  nonprofit: "Nonprofit",
  other: "Other",
};

export function IdentityForm({
  businessId,
  legalName,
  entityType,
  taxId,
  dateIncorporated,
  fiscalYearStart,
  canEditPrivate = false,
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
      <input type="hidden" name="business_id" value={businessId} />

      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>{t("fields.legalName")}</label>
          <input
            name="legal_name"
            defaultValue={legalName}
            placeholder={t("fields.legalNamePlaceholder")}
            className={inputClass}
          />
          <p className="mt-1 text-caption text-content-muted">
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
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {ENTITY_LABEL[type] ?? type}
              </option>
            ))}
          </select>
        </div>

        {canEditPrivate && (
          <>
            <div>
              <label className={labelClass}>{t("fields.taxId")}</label>
              <input
                name="tax_id"
                defaultValue={taxId}
                placeholder="XX-XXXXXXX"
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1 text-caption text-content-muted">
                {t("fields.taxIdHelp")}
              </p>
            </div>

            <div>
              <label className={labelClass}>
                {t("fields.dateIncorporated")}
              </label>
              <input
                name="date_incorporated"
                type="date"
                defaultValue={dateIncorporated}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                {t("fields.fiscalYearStart")}
              </label>
              <input
                name="fiscal_year_start"
                defaultValue={fiscalYearStart}
                placeholder="01-01"
                pattern="^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1 text-caption text-content-muted">
                {t("fields.fiscalYearStartHelp")}
              </p>
            </div>
          </>
        )}
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
