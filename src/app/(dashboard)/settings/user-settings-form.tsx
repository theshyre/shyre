"use client";

import { useTranslations } from "next-intl";
import {
  Palette,
  Shield,
  Link2,
  User,
  Sun,
  Moon,
  Monitor,
  Eye,
  Upload,
  Tags,
} from "lucide-react";
import { MfaSetup } from "@/components/MfaSetup";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  labelClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { useTheme } from "@/components/theme-provider";
import { updateUserSettingsAction, updateProfileAction } from "./actions";

const THEME_OPTIONS = [
  { key: "system", icon: Monitor },
  { key: "light", icon: Sun },
  { key: "dark", icon: Moon },
  { key: "high-contrast", icon: Eye },
] as const;

export function UserSettingsForm({
  githubToken,
  displayName,
}: {
  githubToken: string | null;
  displayName: string;
}): React.JSX.Element {
  const t = useTranslations("settings");
  const { theme, setTheme } = useTheme();

  const profileForm = useFormAction({
    action: updateProfileAction,
  });

  const tokenForm = useFormAction({
    action: updateUserSettingsAction,
  });

  return (
    <div className="mt-6 space-y-8">
      {/* Profile */}
      <form action={profileForm.handleSubmit}>
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <User size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              Profile
            </h2>
          </div>
          {profileForm.serverError && (
            <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">{profileForm.serverError}</p>
          )}
          <div className="max-w-sm">
            <label className={labelClass}>Display Name</label>
            <input
              name="display_name"
              defaultValue={displayName}
              className={inputClass}
            />
          </div>
          <SubmitButton
            label="Save Profile"
            pending={profileForm.pending}
            success={profileForm.success}
            successMessage="Saved"
            className={buttonSecondaryClass}
          />
        </section>
      </form>

      {/* Appearance */}
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

      {/* GitHub Token */}
      <form action={tokenForm.handleSubmit}>
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Link2 size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              {t("sections.integrations")}
            </h2>
          </div>
          {tokenForm.serverError && (
            <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">{tokenForm.serverError}</p>
          )}
          <div>
            <label className={labelClass}>{t("fields.githubToken")}</label>
            <input
              name="github_token"
              type="password"
              placeholder={t("fields.githubTokenPlaceholder")}
              defaultValue={githubToken ?? ""}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-content-muted">
              {t("fields.githubTokenHelp")}
            </p>
          </div>
          <SubmitButton
            label={t("saveSettings")}
            pending={tokenForm.pending}
            success={tokenForm.success}
            successMessage={t("saved")}
            className={buttonSecondaryClass}
          />
        </section>
      </form>

      {/* Security Groups */}
      <a
        href="/settings/security-groups"
        className="flex items-center gap-3 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
      >
        <Shield size={20} className="text-accent" />
        <div>
          <p className="text-sm font-medium text-content">Security Groups</p>
          <p className="text-xs text-content-muted">
            Bundle users to grant permissions in bulk
          </p>
        </div>
      </a>

      {/* Time Categories */}
      <a
        href="/settings/categories"
        className="flex items-center gap-3 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
      >
        <Tags size={20} className="text-accent" />
        <div>
          <p className="text-sm font-medium text-content">Time Categories</p>
          <p className="text-xs text-content-muted">
            Tag time entries with configurable categories per project
          </p>
        </div>
      </a>

      {/* Import */}
      <a
        href="/settings/import"
        className="flex items-center gap-3 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
      >
        <Upload size={20} className="text-accent" />
        <div>
          <p className="text-sm font-medium text-content">Import Data</p>
          <p className="text-xs text-content-muted">
            Import from Harvest or other services
          </p>
        </div>
      </a>
    </div>
  );
}
