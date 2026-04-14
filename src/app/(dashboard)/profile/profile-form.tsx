"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
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
  Globe,
  Clock,
  Languages,
  Calendar,
} from "lucide-react";
import { MfaSetup } from "@/components/MfaSetup";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { useTheme } from "@/components/theme-provider";
import { COMMON_TIMEZONES } from "@/lib/time/tz";
import {
  updateUserSettingsAction,
  updateProfileAction,
  updatePreferencesAction,
} from "./actions";
import { AvatarPicker } from "./avatar-picker";
// Note: exported as `ProfileForm` — aligned with the /profile route.

type Theme = "system" | "light" | "dark" | "high-contrast";

const THEME_OPTIONS: ReadonlyArray<{
  key: Theme;
  icon: ComponentType<{ size?: number }>;
}> = [
  { key: "system", icon: Monitor },
  { key: "light", icon: Sun },
  { key: "dark", icon: Moon },
  { key: "high-contrast", icon: Eye },
];

interface Props {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  githubToken: string | null;
  preferredTheme: Theme | null;
  timezone: string | null;
  locale: string | null;
  weekStart: string | null;
  timeFormat: string | null;
}

export function ProfileForm({
  userId,
  email,
  displayName,
  avatarUrl,
  githubToken,
  timezone,
  locale,
  weekStart,
  timeFormat,
}: Props): React.JSX.Element {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { theme, setTheme } = useTheme();

  const [detectedTz, setDetectedTz] = useState<string>("");
  useEffect(() => {
    try {
      setDetectedTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      setDetectedTz("");
    }
  }, []);

  const profileForm = useFormAction({ action: updateProfileAction });
  const tokenForm = useFormAction({ action: updateUserSettingsAction });
  const prefsForm = useFormAction({ action: updatePreferencesAction });

  // Apply theme changes optimistically + persist to DB without requiring the
  // user to click "Save preferences". Saving theme here re-submits the current
  // values of the other preference fields so we don't blow them away.
  const handleThemeChange = useCallback(
    (next: Theme) => {
      setTheme(next);
      const fd = new FormData();
      fd.set("preferred_theme", next);
      if (timezone) fd.set("timezone", timezone);
      if (locale) fd.set("locale", locale);
      if (weekStart) fd.set("week_start", weekStart);
      if (timeFormat) fd.set("time_format", timeFormat);
      void prefsForm.handleSubmit(fd);
    },
    [setTheme, prefsForm, timezone, locale, weekStart, timeFormat],
  );

  return (
    <div className="mt-6 space-y-6">
      {/* ───── Profile ───── */}
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-5">
        <SectionHeader icon={User} label={t("sections.profile")} />

        {/* Avatar — self-contained, saves on pick/upload */}
        <div>
          <label className={labelClass}>{t("profile.avatar")}</label>
          <AvatarPicker
            userId={userId}
            displayName={displayName}
            initialAvatarUrl={avatarUrl || null}
          />
        </div>

        {/* Name + email form */}
        <form action={profileForm.handleSubmit} className="space-y-3">
          {profileForm.serverError && (
            <ErrorBanner text={profileForm.serverError} />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>{t("profile.displayName")}</label>
              <input
                name="display_name"
                defaultValue={displayName}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t("profile.email")}</label>
              <input
                value={email}
                readOnly
                className={`${inputClass} text-content-muted`}
              />
              <p className="mt-1 text-xs text-content-muted">
                {t("profile.emailReadOnlyHelp")}
              </p>
            </div>
          </div>
          <SubmitButton
            label={t("profile.save")}
            pending={profileForm.pending}
            success={profileForm.success}
            successMessage={tc("actions.saved")}
            className={buttonSecondaryClass}
          />
        </form>
      </section>

      {/* ───── Preferences ───── */}
      <form action={prefsForm.handleSubmit}>
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-5">
          <SectionHeader icon={Palette} label={t("sections.preferences")} />
          {prefsForm.serverError && <ErrorBanner text={prefsForm.serverError} />}

          {/* Theme */}
          <div>
            <label className={labelClass}>{t("theme.title")}</label>
            <div className="flex gap-2 flex-wrap">
              {THEME_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isActive = theme === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleThemeChange(opt.key)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-accent-soft text-accent-text border border-accent/40"
                        : "border border-edge text-content-secondary hover:bg-hover"
                    }`}
                  >
                    <Icon size={16} />
                    {t(
                      `theme.${opt.key === "high-contrast" ? "highContrast" : opt.key}`,
                    )}
                  </button>
                );
              })}
            </div>
            {/* Hidden field so the Save button submits current theme too */}
            <input type="hidden" name="preferred_theme" value={theme} />
          </div>

          {/* Timezone */}
          <div>
            <label className={labelClass}>
              <Globe size={12} className="inline mr-1" />
              {t("preferences.timezone")}
            </label>
            <select
              name="timezone"
              defaultValue={timezone ?? ""}
              className={selectClass}
            >
              <option value="">
                {detectedTz
                  ? t("preferences.timezoneDetected", { zone: detectedTz })
                  : t("preferences.timezoneAuto")}
              </option>
              {COMMON_TIMEZONES.map((group) => (
                <optgroup key={group.region} label={group.region}>
                  {group.zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1 text-xs text-content-muted">
              {t("preferences.timezoneHelp")}
            </p>
          </div>

          {/* Locale + Week + Time format */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>
                <Languages size={12} className="inline mr-1" />
                {t("preferences.locale")}
              </label>
              <select
                name="locale"
                defaultValue={locale ?? ""}
                className={selectClass}
              >
                <option value="">{t("preferences.localeAuto")}</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>
                <Calendar size={12} className="inline mr-1" />
                {t("preferences.weekStart")}
              </label>
              <select
                name="week_start"
                defaultValue={weekStart ?? ""}
                className={selectClass}
              >
                <option value="">{t("preferences.weekStartMonday")}</option>
                <option value="monday">
                  {t("preferences.weekStartMonday")}
                </option>
                <option value="sunday">
                  {t("preferences.weekStartSunday")}
                </option>
              </select>
            </div>
            <div>
              <label className={labelClass}>
                <Clock size={12} className="inline mr-1" />
                {t("preferences.timeFormat")}
              </label>
              <select
                name="time_format"
                defaultValue={timeFormat ?? ""}
                className={selectClass}
              >
                <option value="">{t("preferences.timeFormatAuto")}</option>
                <option value="12h">{t("preferences.timeFormat12h")}</option>
                <option value="24h">{t("preferences.timeFormat24h")}</option>
              </select>
            </div>
          </div>

          <SubmitButton
            label={t("preferences.save")}
            pending={prefsForm.pending}
            success={prefsForm.success}
            successMessage={tc("actions.saved")}
            className={buttonSecondaryClass}
          />
        </section>
      </form>

      {/* ───── Security / MFA ───── */}
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <SectionHeader icon={Shield} label={t("sections.security")} />
        <div>
          <h3 className="text-sm font-medium text-content">{t("mfa.title")}</h3>
          <MfaSetup />
        </div>
      </section>

      {/* ───── Integrations ───── */}
      <form action={tokenForm.handleSubmit}>
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <SectionHeader icon={Link2} label={t("sections.integrations")} />
          {tokenForm.serverError && <ErrorBanner text={tokenForm.serverError} />}
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
            successMessage={tc("actions.saved")}
            className={buttonSecondaryClass}
          />
        </section>
      </form>

    </div>
  );
}

function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 mb-1">
      <Icon size={18} className="text-accent" />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
        {label}
      </h2>
    </div>
  );
}

function ErrorBanner({ text }: { text: string }): React.JSX.Element {
  return (
    <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
      {text}
    </p>
  );
}

