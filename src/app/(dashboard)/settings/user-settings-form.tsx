"use client";

import { useState } from "react";
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
  CheckCircle,
} from "lucide-react";
import { MfaSetup } from "@/components/MfaSetup";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
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
  const [tokenSaved, setTokenSaved] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  return (
    <div className="mt-6 space-y-8">
      {/* Profile */}
      <form
        action={async (formData) => {
          await updateProfileAction(formData);
          setProfileSaved(true);
          setTimeout(() => setProfileSaved(false), 3000);
        }}
      >
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <User size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              Profile
            </h2>
          </div>
          <div className="max-w-sm">
            <label className={labelClass}>Display Name</label>
            <input
              name="display_name"
              defaultValue={displayName}
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className={buttonSecondaryClass}>
              Save Profile
            </button>
            {profileSaved && (
              <span className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle size={14} />
                Saved
              </span>
            )}
          </div>
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
      <form
        action={async (formData) => {
          await updateUserSettingsAction(formData);
          setTokenSaved(true);
          setTimeout(() => setTokenSaved(false), 3000);
        }}
      >
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Link2 size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              {t("sections.integrations")}
            </h2>
          </div>
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
          <div className="flex items-center gap-3">
            <button type="submit" className={buttonSecondaryClass}>
              {t("saveSettings")}
            </button>
            {tokenSaved && (
              <span className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle size={14} />
                {t("saved")}
              </span>
            )}
          </div>
        </section>
      </form>
    </div>
  );
}
