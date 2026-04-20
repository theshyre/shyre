"use client";

import { useTranslations } from "next-intl";
import { Building2, Lock } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import { AddressFields } from "@/components/AddressFields";
import { deserializeAddress } from "@/lib/schemas/address";
import {
  inputClass,
  labelClass,
  selectClass,
} from "@/lib/form-styles";
import { updateTeamSettingsAction } from "./team-settings-actions";

interface TeamSettings {
  business_name: string | null;
  business_email: string | null;
  business_address: string | null;
  business_phone: string | null;
  default_rate: number | null;
  invoice_prefix: string | null;
  invoice_next_num: number | null;
  tax_rate: number | null;
  rate_visibility: string | null;
  rate_editability: string | null;
  time_entries_visibility: string | null;
  admins_can_set_rate_permissions: boolean | null;
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
  rate_visibility: "owner",
  rate_editability: "owner",
  time_entries_visibility: "own_only",
  admins_can_set_rate_permissions: false,
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
  const isOwner = role === "owner";
  const isAdmin = isOwner || role === "admin";
  // canSetRatePerms = owner always; admin only if the delegation flag is on.
  const canSetRatePerms =
    isOwner || (role === "admin" && !!org.admins_can_set_rate_permissions);
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
        <AlertBanner tone="error">{serverError}</AlertBanner>
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

      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Lock size={18} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            {t("sections.rateAccess")}
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              {t("fields.rateVisibility")}
            </label>
            <select
              name="rate_visibility"
              defaultValue={org.rate_visibility ?? "owner"}
              disabled={!canSetRatePerms}
              className={selectClass}
            >
              <option value="owner">{t("rateLevels.owner")}</option>
              <option value="admins">{t("rateLevels.admins")}</option>
              <option value="all_members">
                {t("rateLevels.all_members")}
              </option>
            </select>
          </div>
          <div>
            <label className={labelClass}>
              {t("fields.rateEditability")}
            </label>
            <select
              name="rate_editability"
              defaultValue={org.rate_editability ?? "owner"}
              disabled={!canSetRatePerms}
              className={selectClass}
            >
              <option value="owner">{t("rateLevels.owner")}</option>
              <option value="admins">{t("rateLevels.admins")}</option>
              <option value="all_members">
                {t("rateLevels.all_members")}
              </option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>
              {t("fields.timeEntriesVisibility")}
            </label>
            <select
              name="time_entries_visibility"
              defaultValue={org.time_entries_visibility ?? "own_only"}
              disabled={!isAdmin}
              className={selectClass}
            >
              <option value="own_only">
                {t("timeEntriesLevels.own_only")}
              </option>
              <option value="read_all">
                {t("timeEntriesLevels.read_all")}
              </option>
              <option value="read_write_all">
                {t("timeEntriesLevels.read_write_all")}
              </option>
            </select>
          </div>
          {isOwner && (
            <div className="sm:col-span-2">
              <label className="flex items-start gap-2 text-body text-content">
                <input
                  type="checkbox"
                  name="admins_can_set_rate_permissions"
                  defaultChecked={!!org.admins_can_set_rate_permissions}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">
                    {t("fields.adminsCanSetRatePermissions")}
                  </span>
                  <span className="block text-caption text-content-muted mt-0.5">
                    {t("fields.adminsCanSetRatePermissionsHelp")}
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
      </section>

      {isAdmin && (
        <SubmitButton label={t("saveSettings")} pending={pending} success={success} successMessage={t("saved")} />
      )}
    </form>
  );
}
