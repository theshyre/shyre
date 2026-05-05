"use client";

import {
  useCallback,
  useRef,
  useState,
  useTransition,
  useSyncExternalStore,
  type ComponentType,
} from "react";
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
  BookOpen,
  Globe,
  Clock,
  Languages,
  Calendar,
  ALargeSmall,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  PlugZap,
} from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { MfaSetup } from "@/components/MfaSetup";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { Tooltip } from "@/components/Tooltip";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { useTheme } from "@/components/theme-provider";
import {
  useTextSize,
  type TextSize,
} from "@/components/text-size-provider";
import { COMMON_TIMEZONES } from "@/lib/time/tz";
import { daysUntilExpiry, expiryStatus } from "@/lib/credential-expiry";
import {
  updateUserSettingsAction,
  updateProfileAction,
  updatePreferencesAction,
  testGithubTokenAction,
  testJiraCredsAction,
} from "./actions";
import { AvatarPicker } from "./avatar-picker";
// Note: exported as `ProfileForm` — aligned with the /profile route.

type Theme = "system" | "light" | "dark" | "high-contrast" | "warm";

const THEME_OPTIONS: ReadonlyArray<{
  key: Theme;
  icon: ComponentType<{ size?: number }>;
}> = [
  { key: "system", icon: Monitor },
  { key: "light", icon: Sun },
  { key: "dark", icon: Moon },
  { key: "high-contrast", icon: Eye },
  // Selector key stays "warm" so stored prefs survive — only the user-
  // facing label and icon change. Cream paper palette, low glare.
  { key: "warm", icon: BookOpen },
];

// Selector keys → i18n keys. The DB / data-theme selector is the source
// of truth; the i18n key tracks the user-facing label, which can drift
// (warm → reading) without breaking stored prefs.
function themeI18nKey(key: Theme): string {
  if (key === "high-contrast") return "highContrast";
  if (key === "warm") return "reading";
  return key;
}

interface Props {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  githubToken: string | null;
  githubTokenExpiresAt: string | null;
  jiraBaseUrl: string | null;
  jiraEmail: string | null;
  jiraApiToken: string | null;
  jiraApiTokenExpiresAt: string | null;
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
  githubTokenExpiresAt,
  jiraBaseUrl,
  jiraEmail,
  jiraApiToken,
  jiraApiTokenExpiresAt,
  timezone,
  locale,
  weekStart,
  timeFormat,
}: Props): React.JSX.Element {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { theme, setTheme } = useTheme();
  const { textSize, setTextSize } = useTextSize();

  // Browser-detected TZ. Read via useSyncExternalStore so we don't need a
  // setState-in-effect (lint rule) and the value is correct on first render.
  const detectedTz = useSyncExternalStore(
    subscribeNever,
    getDetectedTz,
    getDetectedTzServer,
  );

  const profileForm = useFormAction({ action: updateProfileAction });
  const tokenForm = useFormAction({ action: updateUserSettingsAction });
  const prefsForm = useFormAction({ action: updatePreferencesAction });

  // Apply theme changes optimistically + persist to DB without requiring the
  // user to click "Save preferences". Saving here re-submits the current
  // values of the other preference fields so we don't blow them away.
  const submitPrefs = useCallback(
    (overrides: Partial<{ theme: Theme; textSize: TextSize }>) => {
      const fd = new FormData();
      fd.set("preferred_theme", overrides.theme ?? theme);
      fd.set("text_size", overrides.textSize ?? textSize);
      if (timezone) fd.set("timezone", timezone);
      if (locale) fd.set("locale", locale);
      if (weekStart) fd.set("week_start", weekStart);
      if (timeFormat) fd.set("time_format", timeFormat);
      void prefsForm.handleSubmit(fd);
    },
    [prefsForm, theme, textSize, timezone, locale, weekStart, timeFormat],
  );

  const handleThemeChange = useCallback(
    (next: Theme) => {
      setTheme(next);
      submitPrefs({ theme: next });
    },
    [setTheme, submitPrefs],
  );

  const handleTextSizeChange = useCallback(
    (next: TextSize) => {
      setTextSize(next);
      submitPrefs({ textSize: next });
    },
    [setTextSize, submitPrefs],
  );

  return (
    <div className="mt-6 space-y-6">
      {/* ───── Profile ───── */}
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-5">
        <SectionHeader icon={User} label={t("sections.profile")} />

        {/* Avatar — self-contained, saves on pick/upload. Uses a
            spanned wrapper rather than `htmlFor` because AvatarPicker
            renders its own focusable controls (preset tiles, upload
            input). The visual label is informational. */}
        <div>
          <span className={labelClass}>{t("profile.avatar")}</span>
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
              <label htmlFor="profile-display-name" className={labelClass}>
                {t("profile.displayName")}
              </label>
              <input
                id="profile-display-name"
                name="display_name"
                defaultValue={displayName}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="profile-email" className={labelClass}>
                {t("profile.email")}
              </label>
              <input
                id="profile-email"
                value={email}
                readOnly
                className={`${inputClass} text-content-muted`}
                aria-describedby="profile-email-help"
              />
              <p
                id="profile-email-help"
                className="mt-1 text-caption text-content-muted"
              >
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

          {/* Theme — radio group of buttons. The wrapping
              `<fieldset>` + `<legend>` is the canonical a11y
              pattern for "label that names a set of inputs."
              `htmlFor` on a single label can't address a button
              group. */}
          <fieldset>
            <legend className={labelClass}>{t("theme.title")}</legend>
            <div className="flex gap-2 flex-wrap">
              {THEME_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isActive = theme === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleThemeChange(opt.key)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-body-lg font-medium transition-colors ${
                      isActive
                        ? "bg-accent-soft text-accent-text border border-accent/40"
                        : "border border-edge text-content-secondary hover:bg-hover"
                    }`}
                  >
                    <Icon size={16} />
                    {t(`theme.${themeI18nKey(opt.key)}`)}
                  </button>
                );
              })}
            </div>
            {/* Hidden field so the Save button submits current theme too */}
            <input type="hidden" name="preferred_theme" value={theme} />
          </fieldset>

          {/* Text size — same fieldset/legend treatment as Theme. */}
          <fieldset>
            <legend className={labelClass}>{t("textSize.title")}</legend>
            <div className="flex items-center gap-1 flex-wrap">
              <ALargeSmall
                size={16}
                className="mr-1 text-content-muted shrink-0"
              />
              {(["compact", "regular", "large"] as const).map((size) => {
                const isActive = textSize === size;
                return (
                  <Tooltip key={size} label={t(`textSize.${size}`)}>
                    <button
                      type="button"
                      onClick={() => handleTextSizeChange(size)}
                      aria-label={t(`textSize.${size}`)}
                      aria-pressed={isActive}
                      className={`flex h-8 w-8 items-center justify-center rounded-md font-semibold transition-colors ${
                        isActive
                          ? "bg-accent text-content-inverse"
                          : "border border-edge text-content-secondary hover:bg-hover"
                      }`}
                      style={{
                        fontSize:
                          size === "compact"
                            ? "11px"
                            : size === "large"
                              ? "16px"
                              : "13px",
                      }}
                    >
                      A
                    </button>
                  </Tooltip>
                );
              })}
              <span className="ml-2 text-caption text-content-muted">
                {t(`textSize.${textSize}`)}
              </span>
            </div>
            <input type="hidden" name="text_size" value={textSize} />
          </fieldset>

          {/* Timezone */}
          <div>
            <label htmlFor="profile-timezone" className={labelClass}>
              <Globe size={12} className="inline mr-1" />
              {t("preferences.timezone")}
            </label>
            <select
              id="profile-timezone"
              name="timezone"
              defaultValue={timezone ?? ""}
              className={selectClass}
              aria-describedby="profile-timezone-help"
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
            <p
              id="profile-timezone-help"
              className="mt-1 text-caption text-content-muted"
            >
              {t("preferences.timezoneHelp")}
            </p>
          </div>

          {/* Locale + Week + Time format */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="profile-locale" className={labelClass}>
                <Languages size={12} className="inline mr-1" />
                {t("preferences.locale")}
              </label>
              <select
                id="profile-locale"
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
              <label htmlFor="profile-week-start" className={labelClass}>
                <Calendar size={12} className="inline mr-1" />
                {t("preferences.weekStart")}
              </label>
              <select
                id="profile-week-start"
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
              <label htmlFor="profile-time-format" className={labelClass}>
                <Clock size={12} className="inline mr-1" />
                {t("preferences.timeFormat")}
              </label>
              <select
                id="profile-time-format"
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
          <h3 className="text-body-lg font-medium text-content">{t("mfa.title")}</h3>
          <MfaSetup />
        </div>
      </section>

      {/* ───── Integrations ───── */}
      <IntegrationsSection
        tokenForm={tokenForm}
        githubToken={githubToken}
        githubTokenExpiresAt={githubTokenExpiresAt}
        jiraBaseUrl={jiraBaseUrl}
        jiraEmail={jiraEmail}
        jiraApiToken={jiraApiToken}
        jiraApiTokenExpiresAt={jiraApiTokenExpiresAt}
      />

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
      <h2 className="text-body-lg font-semibold uppercase tracking-wider text-content-muted">
        {label}
      </h2>
    </div>
  );
}

function ErrorBanner({ text }: { text: string }): React.JSX.Element {
  return <AlertBanner tone="error">{text}</AlertBanner>;
}

/** Status pill for an integration token's expiration. Three-channel
 *  encoding (icon + color + text). Renders nothing when no date is
 *  supplied — the user opted out of tracking. */
function ExpiryPill({
  expiresAt,
}: {
  expiresAt: string | null;
}): React.JSX.Element | null {
  const t = useTranslations("settings.fields");
  const days = daysUntilExpiry(expiresAt);
  const status = expiryStatus(expiresAt);
  if (status === null || days === null) return null;

  if (status === "expired") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-error bg-error-soft px-2 py-1 text-caption text-error-text">
        <AlertTriangle size={12} aria-hidden="true" />
        {t("expiryExpired", { days: Math.abs(days) })}
      </span>
    );
  }
  if (status === "critical") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-error bg-error-soft px-2 py-1 text-caption text-error-text">
        <AlertTriangle size={12} aria-hidden="true" />
        {t("expiryCritical", { days })}
      </span>
    );
  }
  if (status === "warning") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-warning bg-warning-soft px-2 py-1 text-caption text-warning-text">
        <AlertTriangle size={12} aria-hidden="true" />
        {t("expiryWarning", { days })}
      </span>
    );
  }
  // ok
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-inset px-2 py-1 text-caption text-content-secondary">
      <CheckCircle2 size={12} aria-hidden="true" />
      {t("expiryOk", { days })}
    </span>
  );
}

type ConnState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok" }
  | { status: "error"; message: string };

/** Inline status indicator next to a Test-connection button.
 *  Three-channel encoding: icon, color, and text. */
function ConnStatus({
  state,
  okLabel,
  failLabel,
}: {
  state: ConnState;
  okLabel: string;
  failLabel: string;
}): React.JSX.Element | null {
  if (state.status === "idle") return null;
  if (state.status === "testing") {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-content-muted">
        <Loader2 size={12} className="animate-spin" />
      </span>
    );
  }
  if (state.status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-success">
        <CheckCircle2 size={12} />
        {okLabel}
      </span>
    );
  }
  return (
    <Tooltip label={state.message}>
      <span className="inline-flex items-center gap-1 text-caption text-error">
        <AlertTriangle size={12} />
        {failLabel}
      </span>
    </Tooltip>
  );
}

interface IntegrationsSectionProps {
  tokenForm: ReturnType<typeof useFormAction>;
  githubToken: string | null;
  githubTokenExpiresAt: string | null;
  jiraBaseUrl: string | null;
  jiraEmail: string | null;
  jiraApiToken: string | null;
  jiraApiTokenExpiresAt: string | null;
}

/** Integrations section, broken out so the Test-connection logic
 *  (which needs a form-ref + transitions) doesn't live inside the
 *  much larger ProfileForm. The outer <form> handles save; the
 *  test buttons read the live input values via the formRef. */
function IntegrationsSection({
  tokenForm,
  githubToken,
  githubTokenExpiresAt,
  jiraBaseUrl,
  jiraEmail,
  jiraApiToken,
  jiraApiTokenExpiresAt,
}: IntegrationsSectionProps): React.JSX.Element {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const formRef = useRef<HTMLFormElement>(null);
  const [ghState, setGhState] = useState<ConnState>({ status: "idle" });
  const [jiraState, setJiraState] = useState<ConnState>({ status: "idle" });
  const [, startTransition] = useTransition();

  function readField(name: string): string {
    const el = formRef.current?.elements.namedItem(name);
    if (el && "value" in el && typeof (el as { value: unknown }).value === "string") {
      return (el as { value: string }).value;
    }
    return "";
  }

  function handleTestGithub(): void {
    const token = readField("github_token");
    setGhState({ status: "testing" });
    startTransition(async () => {
      const res = await testGithubTokenAction(token);
      setGhState(
        res.ok
          ? { status: "ok" }
          : { status: "error", message: res.error },
      );
    });
  }

  function handleTestJira(): void {
    const baseUrl = readField("jira_base_url");
    const email = readField("jira_email");
    const apiToken = readField("jira_api_token");
    setJiraState({ status: "testing" });
    startTransition(async () => {
      const res = await testJiraCredsAction(baseUrl, email, apiToken);
      setJiraState(
        res.ok
          ? { status: "ok" }
          : { status: "error", message: res.error },
      );
    });
  }

  return (
    <form ref={formRef} action={tokenForm.handleSubmit}>
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-4">
        <SectionHeader icon={Link2} label={t("sections.integrations")} />
        {tokenForm.serverError && <ErrorBanner text={tokenForm.serverError} />}

        {/* GitHub */}
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label htmlFor="profile-github-token" className={labelClass}>
              {t("fields.githubToken")}
            </label>
            <a
              href={t("fields.githubTokenLinkHref")}
              target="_blank"
              rel="noopener noreferrer"
              className="text-caption text-accent hover:underline"
            >
              {t("fields.githubTokenLink")}
            </a>
          </div>
          <input
            id="profile-github-token"
            name="github_token"
            type="password"
            placeholder={t("fields.githubTokenPlaceholder")}
            defaultValue={githubToken ?? ""}
            className={inputClass}
            onChange={() => setGhState({ status: "idle" })}
            aria-describedby="profile-github-token-help"
          />
          <p
            id="profile-github-token-help"
            className="mt-1 text-caption text-content-muted"
          >
            {t("fields.githubTokenHelp")}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="profile-github-token-expires"
                className={labelClass}
              >
                {t("fields.tokenExpiresOn")}
              </label>
              <input
                id="profile-github-token-expires"
                name="github_token_expires_at"
                type="date"
                defaultValue={githubTokenExpiresAt ?? ""}
                className={inputClass}
                aria-describedby="profile-github-token-expires-help"
              />
              <p
                id="profile-github-token-expires-help"
                className="mt-1 text-caption text-content-muted"
              >
                {t("fields.tokenExpiresOnHelp")}
              </p>
            </div>
            <div className="flex items-end">
              <ExpiryPill expiresAt={githubTokenExpiresAt} />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleTestGithub}
              disabled={ghState.status === "testing"}
              className={`${buttonSecondaryClass} disabled:opacity-50`}
            >
              <PlugZap size={14} />
              {t("fields.testConnection")}
            </button>
            <ConnStatus
              state={ghState}
              okLabel={t("fields.testConnectionOk")}
              failLabel={t("fields.testConnectionFailed")}
            />
          </div>
        </div>

        {/* Jira */}
        <div className="border-t border-edge pt-4 space-y-3">
          <div>
            <h3 className="text-body-lg font-semibold text-content">
              {t("fields.jiraSection")}
            </h3>
            <p className="mt-1 text-caption text-content-muted max-w-3xl">
              {t("fields.jiraSectionHelp")}
            </p>
          </div>

          <div>
            <label htmlFor="profile-jira-base-url" className={labelClass}>
              {t("fields.jiraBaseUrl")}
            </label>
            <input
              id="profile-jira-base-url"
              name="jira_base_url"
              type="url"
              placeholder={t("fields.jiraBaseUrlPlaceholder")}
              defaultValue={jiraBaseUrl ?? ""}
              className={inputClass}
              onChange={() => setJiraState({ status: "idle" })}
            />
          </div>

          <div>
            <label htmlFor="profile-jira-email" className={labelClass}>
              {t("fields.jiraEmail")}
            </label>
            <input
              id="profile-jira-email"
              name="jira_email"
              type="email"
              defaultValue={jiraEmail ?? ""}
              className={inputClass}
              onChange={() => setJiraState({ status: "idle" })}
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label htmlFor="profile-jira-api-token" className={labelClass}>
                {t("fields.jiraApiToken")}
              </label>
              <a
                href={t("fields.jiraApiTokenLinkHref")}
                target="_blank"
                rel="noopener noreferrer"
                className="text-caption text-accent hover:underline"
              >
                {t("fields.jiraApiTokenLink")}
              </a>
            </div>
            <input
              id="profile-jira-api-token"
              name="jira_api_token"
              type="password"
              placeholder={t("fields.jiraApiTokenPlaceholder")}
              defaultValue={jiraApiToken ?? ""}
              className={inputClass}
              onChange={() => setJiraState({ status: "idle" })}
              aria-describedby="profile-jira-api-token-help"
            />
            <p
              id="profile-jira-api-token-help"
              className="mt-1 text-caption text-content-muted"
            >
              {t("fields.jiraApiTokenHelp")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="profile-jira-token-expires"
                className={labelClass}
              >
                {t("fields.tokenExpiresOn")}
              </label>
              <input
                id="profile-jira-token-expires"
                name="jira_api_token_expires_at"
                type="date"
                defaultValue={jiraApiTokenExpiresAt ?? ""}
                className={inputClass}
                aria-describedby="profile-jira-token-expires-help"
              />
              <p
                id="profile-jira-token-expires-help"
                className="mt-1 text-caption text-content-muted"
              >
                {t("fields.tokenExpiresOnHelp")}
              </p>
            </div>
            <div className="flex items-end">
              <ExpiryPill expiresAt={jiraApiTokenExpiresAt} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTestJira}
              disabled={jiraState.status === "testing"}
              className={`${buttonSecondaryClass} disabled:opacity-50`}
            >
              <PlugZap size={14} />
              {t("fields.testConnection")}
            </button>
            <ConnStatus
              state={jiraState}
              okLabel={t("fields.testConnectionOk")}
              failLabel={t("fields.testConnectionFailed")}
            />
          </div>
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
  );
}

// Browser-only helpers for useSyncExternalStore — the "store" here is the
// Intl API, which is effectively immutable for the tab's lifetime, so the
// subscriber is a no-op.
function subscribeNever(): () => void {
  return () => {};
}
function getDetectedTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}
function getDetectedTzServer(): string {
  return "";
}

