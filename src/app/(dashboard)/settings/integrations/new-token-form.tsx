"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import { Plus, Copy, Check, TriangleAlert } from "lucide-react";
import { AlertBanner, useKeyboardShortcut } from "@theshyre/ui";
import { useToast } from "@/components/Toast";
import { FieldError } from "@/components/FieldError";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  selectClass,
  labelClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formGridClass,
  formSpanHalf,
  formSpanThird,
} from "@/lib/form-styles";
import { createIntegrationTokenAction } from "./actions";
import {
  DEFAULT_TOKEN_TTL_DAYS,
  TOKEN_TTL_PRESETS,
} from "./token-constants";

interface Props {
  teamId: string;
  /** The four v1 scopes, displayed read-only (no picker yet). */
  scopes: readonly string[];
}

/**
 * Create-token flow: [New token] button (N shortcut) → inline expansion
 * form (name, expiry preset, one-time billable choice, read-only scope
 * display) → show-once box with the raw token.
 *
 * The raw token lives ONLY in this component's state. Dismissing the
 * show-once box drops it permanently — it is never rendered again
 * (Shyre stores only the hash). Dismissal is an explicit [Done] click
 * rather than Escape: losing the value is consequential, so a stray
 * keypress shouldn't do it.
 */
export function NewTokenForm({ teamId, scopes }: Props): React.JSX.Element {
  const t = useTranslations("integrations.create");
  const tc = useTranslations("common");
  // Root translator for server-provided i18n error keys.
  const tRoot = useTranslations();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Focus management: the show-once heading receives focus when the
  // box appears (the form it replaces vanishes, taking focus with it);
  // the trigger button gets it back after close/dismiss.
  const showOnceHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (rawToken !== null) showOnceHeadingRef.current?.focus();
  }, [rawToken]);

  useEffect(() => {
    if (!open && rawToken === null && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open, rawToken]);

  const translate = useCallback(
    (keyOrMessage: string): string => {
      try {
        const translated = tRoot(keyOrMessage);
        if (translated && translated !== keyOrMessage) return translated;
      } catch {
        // Not a known key — fall through to the raw message.
      }
      return keyOrMessage;
    },
    [tRoot],
  );

  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => setOpen(true), []),
    enabled: !open && rawToken === null,
  });

  // Inline expansions must be Escape-dismissible (overlay rule). Only
  // while the form is open and idle — never mid-submit, and never for
  // the show-once box (see the component docblock). Guard against
  // silent data loss: if the name field is focused with typed text,
  // the first Escape only blurs it; a second Escape closes the form.
  useEffect(() => {
    if (!open || pending) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const name = nameInputRef.current;
      if (
        name &&
        document.activeElement === name &&
        name.value.trim() !== ""
      ) {
        name.blur();
        return;
      }
      restoreFocusRef.current = true;
      setOpen(false);
      setServerError(null);
      setFieldErrors({});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  const handleSubmit = (formData: FormData): void => {
    setServerError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createIntegrationTokenAction(formData);
      if (!result.success || !result.rawToken) {
        const err = result.error;
        if (err?.fieldErrors) {
          const translated: Record<string, string> = {};
          for (const [field, key] of Object.entries(err.fieldErrors)) {
            translated[field] = translate(key);
          }
          setFieldErrors(translated);
        }
        setServerError(
          err?.message ?? translate(err?.userMessageKey ?? "errors.unknown"),
        );
        return;
      }
      setRawToken(result.rawToken);
      setOpen(false);
    });
  };

  // Await the clipboard write: a false "copied" toast followed by Done
  // would lose the only copy of the token. The `select-all` styling on
  // the code block is the manual fallback.
  const copyToken = async (): Promise<void> => {
    if (rawToken === null) return;
    try {
      await navigator.clipboard.writeText(rawToken);
      setCopied(true);
      toast.push({ kind: "success", message: t("showOnce.copied") });
    } catch {
      toast.push({ kind: "error", message: t("showOnce.copyFailed") });
    }
  };

  if (rawToken !== null) {
    return (
      <div className="space-y-3 rounded-lg border border-warning/40 bg-surface-raised p-4">
        <h3
          ref={showOnceHeadingRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-body-lg font-semibold text-content focus-visible:outline-none"
        >
          <TriangleAlert
            size={16}
            className="text-warning"
            aria-hidden="true"
          />
          {t("showOnce.heading")}
        </h3>
        <AlertBanner tone="warning">{t("showOnce.warning")}</AlertBanner>
        <code className="block break-all rounded-lg border border-edge bg-surface-inset p-3 font-mono text-body text-content select-all">
          {rawToken}
        </code>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              void copyToken();
            }}
            className={buttonPrimaryClass}
          >
            {copied ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
            {t("showOnce.copy")}
          </button>
          <button
            type="button"
            onClick={() => {
              restoreFocusRef.current = true;
              setRawToken(null);
              setCopied(false);
            }}
            className={buttonSecondaryClass}
          >
            {t("showOnce.done")}
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className={buttonPrimaryClass}
      >
        <Plus size={16} aria-hidden="true" />
        {t("button")}
        <kbd className={kbdClass}>N</kbd>
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      <input type="hidden" name="team_id" value={teamId} />

      {serverError && <AlertBanner tone="error">{serverError}</AlertBanner>}

      <div className={formGridClass}>
        <div className={formSpanHalf}>
          <label htmlFor="new-token-name" className={labelClass}>
            {t("nameLabel")} *
          </label>
          <input
            id="new-token-name"
            ref={nameInputRef}
            name="name"
            required
            autoFocus
            maxLength={100}
            placeholder={t("namePlaceholder")}
            className={inputClass}
            aria-describedby={
              fieldErrors.name ? "new-token-name-error" : undefined
            }
          />
          <FieldError error={fieldErrors.name} id="new-token-name-error" />
        </div>
        <div className={formSpanThird}>
          <label htmlFor="new-token-ttl" className={labelClass}>
            {t("expiryLabel")}
          </label>
          <select
            id="new-token-ttl"
            name="ttl_days"
            defaultValue={String(DEFAULT_TOKEN_TTL_DAYS)}
            aria-describedby="new-token-ttl-hint"
            className={selectClass}
          >
            {TOKEN_TTL_PRESETS.map((days) => (
              <option key={days} value={String(days)}>
                {days === DEFAULT_TOKEN_TTL_DAYS
                  ? t("expiryRecommended", { days })
                  : t("expiryOption", { days })}
              </option>
            ))}
          </select>
          <p
            id="new-token-ttl-hint"
            className="mt-1 text-caption text-content-muted"
          >
            {t("expiryHint")}
          </p>
        </div>
      </div>

      <fieldset aria-describedby="new-token-billable-explain">
        <legend className={labelClass}>{t("billableLegend")}</legend>
        <div className="space-y-2">
          {/* Hints live OUTSIDE the labels (aria-describedby) so the
              radios keep crisp accessible names — "Billable", not the
              whole explanatory sentence. */}
          <div>
            <label className="flex items-center gap-2 text-body text-content">
              <input
                type="radio"
                name="default_billable"
                value="true"
                defaultChecked
                aria-describedby="new-token-billable-true-hint"
              />
              <span className="font-medium">{t("billableOption")}</span>
            </label>
            <p
              id="new-token-billable-true-hint"
              className="ml-6 text-caption text-content-muted"
            >
              {t("billableHint")}
            </p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-body text-content">
              <input
                type="radio"
                name="default_billable"
                value="false"
                aria-describedby="new-token-billable-false-hint"
              />
              <span className="font-medium">{t("nonBillableOption")}</span>
            </label>
            <p
              id="new-token-billable-false-hint"
              className="ml-6 text-caption text-content-muted"
            >
              {t("nonBillableHint")}
            </p>
          </div>
        </div>
        <p
          id="new-token-billable-explain"
          className="mt-1 text-caption text-content-muted"
        >
          {t("billableExplain")}
        </p>
      </fieldset>

      <div>
        <span className={labelClass}>{t("scopesLabel")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {scopes.map((scope) => (
            <code
              key={scope}
              className="rounded bg-surface-inset px-1.5 py-0.5 font-mono text-caption text-content-secondary"
            >
              {scope}
            </code>
          ))}
        </div>
        <p className="mt-1 text-caption text-content-muted">
          {t("scopesHint")}
        </p>
      </div>

      <div className="flex gap-2">
        <SubmitButton
          label={t("submit")}
          pending={pending}
          pendingLabel={t("pending")}
        />
        <button
          type="button"
          onClick={() => {
            restoreFocusRef.current = true;
            setOpen(false);
            setServerError(null);
            setFieldErrors({});
          }}
          disabled={pending}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
