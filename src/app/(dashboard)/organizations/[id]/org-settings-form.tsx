"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, CheckCircle } from "lucide-react";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  kbdClass,
} from "@/lib/form-styles";
import { updateOrgSettingsAction } from "../../settings/actions";

interface OrgSettings {
  business_name: string | null;
  business_email: string | null;
  business_address: string | null;
  business_phone: string | null;
  default_rate: number | null;
  invoice_prefix: string | null;
  invoice_next_num: number | null;
  tax_rate: number | null;
}

const DEFAULTS: OrgSettings = {
  business_name: null,
  business_email: null,
  business_address: null,
  business_phone: null,
  default_rate: 0,
  invoice_prefix: "INV",
  invoice_next_num: 1,
  tax_rate: 0,
};

export function OrgSettingsForm({
  orgSettings,
  orgId,
  role,
}: {
  orgSettings: OrgSettings | null;
  orgId: string;
  role: string;
}): React.JSX.Element {
  const t = useTranslations("settings");
  const [saved, setSaved] = useState(false);
  const org = orgSettings ?? DEFAULTS;
  const isAdmin = role === "owner" || role === "admin";

  return (
    <form
      action={async (formData) => {
        await updateOrgSettingsAction(formData);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }}
      className="mt-6 space-y-6"
    >
      <input type="hidden" name="organization_id" value={orgId} />

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
          </div>
          <div>
            <label className={labelClass}>{t("fields.businessPhone")}</label>
            <input
              name="business_phone"
              defaultValue={org.business_phone ?? ""}
              disabled={!isAdmin}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("fields.businessAddress")}</label>
            <input
              name="business_address"
              defaultValue={org.business_address ?? ""}
              disabled={!isAdmin}
              className={inputClass}
            />
          </div>
        </div>
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
        <div className="flex items-center gap-3">
          <button type="submit" className={buttonPrimaryClass}>
            <kbd className={kbdClass}>⌘S</kbd>
            {t("saveSettings")}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle size={14} />
              {t("saved")}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
