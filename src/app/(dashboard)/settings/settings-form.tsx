"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Building2,
  Palette,
  Shield,
  Link2,
  Sun,
  Moon,
  Monitor,
  Eye,
  CheckCircle,
} from "lucide-react";
import { MfaSetup } from "@/components/MfaSetup";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  kbdClass,
} from "@/lib/form-styles";
import { useTheme } from "@/components/theme-provider";
import { updateSettingsAction } from "./actions";

interface UserSettings {
  business_name: string | null;
  business_email: string | null;
  business_address: string | null;
  business_phone: string | null;
  default_rate: number | null;
  invoice_prefix: string | null;
  invoice_next_num: number | null;
  tax_rate: number | null;
  github_token: string | null;
}

const DEFAULTS: UserSettings = {
  business_name: null,
  business_email: null,
  business_address: null,
  business_phone: null,
  default_rate: 0,
  invoice_prefix: "INV",
  invoice_next_num: 1,
  tax_rate: 0,
  github_token: null,
};

const THEME_OPTIONS = [
  { key: "system", icon: Monitor },
  { key: "light", icon: Sun },
  { key: "dark", icon: Moon },
  { key: "high-contrast", icon: Eye },
] as const;

export function SettingsForm({
  settings,
}: {
  settings: UserSettings | null;
}): React.JSX.Element {
  const t = useTranslations("settings");
  const { theme, setTheme } = useTheme();
  const [saved, setSaved] = useState(false);

  const current = settings ?? DEFAULTS;

  return (
    <div className="mt-6 space-y-8">
      {/* Business Information */}
      <form
        action={async (formData) => {
          await updateSettingsAction(formData);
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        }}
        className="space-y-6"
      >
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              {t("sections.business")}
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                {t("fields.businessName")}
              </label>
              <input
                name="business_name"
                defaultValue={current.business_name ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("fields.businessEmail")}
              </label>
              <input
                name="business_email"
                type="email"
                defaultValue={current.business_email ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("fields.businessPhone")}
              </label>
              <input
                name="business_phone"
                defaultValue={current.business_phone ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("fields.businessAddress")}
              </label>
              <input
                name="business_address"
                defaultValue={current.business_address ?? ""}
                className={inputClass}
              />
            </div>
          </div>
        </section>

        {/* Defaults */}
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted mb-2">
            {t("sections.defaults")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>
                {t("fields.defaultRate")}
              </label>
              <input
                name="default_rate"
                type="number"
                step="0.01"
                min="0"
                defaultValue={current.default_rate ?? 0}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("fields.invoicePrefix")}
              </label>
              <input
                name="invoice_prefix"
                defaultValue={current.invoice_prefix ?? "INV"}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("fields.invoiceNextNum")}
              </label>
              <input
                name="invoice_next_num"
                type="number"
                min="1"
                defaultValue={current.invoice_next_num ?? 1}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("fields.taxRate")}
              </label>
              <input
                name="tax_rate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                defaultValue={current.tax_rate ?? 0}
                className={inputClass}
              />
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Link2 size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              {t("sections.integrations")}
            </h2>
          </div>
          <div>
            <label className={labelClass}>
              {t("fields.githubToken")}
            </label>
            <input
              name="github_token"
              type="password"
              placeholder={t("fields.githubTokenPlaceholder")}
              defaultValue={current.github_token ?? ""}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-content-muted">
              {t("fields.githubTokenHelp")}
            </p>
          </div>
        </section>

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
      </form>

      {/* Appearance — client-only, not part of the server form */}
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Palette size={18} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            {t("sections.appearance")}
          </h2>
        </div>
        <div>
          <label className={labelClass}>{t("theme.title")}</label>
          <div className="flex gap-2 mt-1">
            {THEME_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = theme === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setTheme(opt.key)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent-soft text-accent-text"
                      : "border border-edge text-content-secondary hover:bg-hover"
                  }`}
                >
                  <Icon size={16} />
                  {t(`theme.${opt.key === "high-contrast" ? "highContrast" : opt.key}`)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Security / MFA */}
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={18} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            {t("sections.security")}
          </h2>
        </div>
        <div>
          <h3 className="text-sm font-medium text-content">
            {t("mfa.title")}
          </h3>
          <MfaSetup />
        </div>
      </section>
    </div>
  );
}
