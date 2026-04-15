"use client";

import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import { AddressFields } from "@/components/AddressFields";
import { deserializeAddress } from "@/lib/schemas/address";
import {
  inputClass,
  labelClass,
} from "@/lib/form-styles";
import { updateTeamSettingsAction } from "../../settings/actions";

interface TeamSettings {
  business_name: string | null;
  business_email: string | null;
  business_address: string | null;
  business_phone: string | null;
  default_rate: number | null;
  invoice_prefix: string | null;
  invoice_next_num: number | null;
  tax_rate: number | null;
}

const DEFAULTS: TeamSettings = {
  business_name: null,
  business_email: null,
  business_address: null,
  business_phone: null,
  default_rate: 0,
  invoice_prefix: "INV",
  invoice_next_num: 1,
  tax_rate: 0,
};

export function TeamSettingsForm({
  teamSettings,
  teamId,
  role,
}: {
  teamSettings: TeamSettings | null;
  teamId: string;
  role: string;
}): React.JSX.Element {
  const t = useTranslations("settings");
  const org = teamSettings ?? DEFAULTS;
  const isAdmin = role === "owner" || role === "admin";
  const businessAddress = deserializeAddress(org.business_address ?? null);

  const { pending, success, serverError, fieldErrors, handleSubmit } = useFormAction({
    action: updateTeamSettingsAction,
  });

  return (
    <form
      action={handleSubmit}
      className="mt-6 space-y-6"
    >
      {serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">{serverError}</p>
      )}
      <input type="hidden" name="team_id" value={teamId} />

      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Building2 size={18} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            {t("sections.business")}
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("fields.businessName")}</label>
            <input
              name="business_name"
              defaultValue={org.business_name ?? ""}
              disabled={!isAdmin}
              className={inputClass}
            />
            <FieldError error={fieldErrors.business_name} />
          </div>
          <div>
            <label className={labelClass}>{t("fields.businessEmail")}</label>
            <input
              name="business_email"
              type="email"
              defaultValue={org.business_email ?? ""}
              disabled={!isAdmin}
              className={inputClass}
            />
            <FieldError error={fieldErrors.business_email} />
          </div>
          <div>
            <label className={labelClass}>{t("fields.businessPhone")}</label>
            <input
              name="business_phone"
              defaultValue={org.business_phone ?? ""}
              disabled={!isAdmin}
              className={inputClass}
            />
            <FieldError error={fieldErrors.business_phone} />
          </div>
        </div>
        <AddressFields
          prefix="business_address"
          value={businessAddress}
          label={t("fields.businessAddress")}
          disabled={!isAdmin}
          errors={fieldErrors}
        />
      </section>

      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted mb-2">
          {t("sections.defaults")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>{t("fields.defaultRate")}</label>
            <input
              name="default_rate"
              type="number"
              step="0.01"
              min="0"
              defaultValue={org.default_rate ?? 0}
              disabled={!isAdmin}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("fields.invoicePrefix")}</label>
            <input
              name="invoice_prefix"
              defaultValue={org.invoice_prefix ?? "INV"}
              disabled={!isAdmin}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("fields.invoiceNextNum")}</label>
            <input
              name="invoice_next_num"
              type="number"
              min="1"
              defaultValue={org.invoice_next_num ?? 1}
              disabled={!isAdmin}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("fields.taxRate")}</label>
            <input
              name="tax_rate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={org.tax_rate ?? 0}
              disabled={!isAdmin}
              className={inputClass}
            />
          </div>
        </div>
      </section>

      {isAdmin && (
        <SubmitButton label={t("saveSettings")} pending={pending} success={success} successMessage={t("saved")} />
      )}
    </form>
  );
}
