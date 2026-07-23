"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";

import { useFormAction } from "@/hooks/use-form-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import {
  inputClass,
  selectClass,
  labelClass,
  buttonSecondaryClass,
  buttonGhostClass,
  formGridClass,
  formSpanFull,
  formSpanHalf,
} from "@/lib/form-styles";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import { AlertBanner } from "@theshyre/ui";
import {
  createSignoffAction,
  updateSignoffDraftAction,
} from "./actions";

export interface CustomerOption {
  id: string;
  name: string;
  team_id: string;
}

interface SignerRow {
  name: string;
  email: string;
  roleLabel: string;
  orgLabel: string;
}

export interface SignoffFormInitial {
  documentId?: string;
  teamId: string;
  customerId: string | null;
  title: string;
  versionLabel: string;
  bodyMarkdown: string;
  externalRef: string;
  signingMode: string;
  signTheme: string;
  signers: SignerRow[];
}

interface Props {
  /** Admin teams the author can create under. One → the picker is hidden. */
  teams: { id: string; name: string }[];
  customers: CustomerOption[];
  initial?: SignoffFormInitial;
}

const EMPTY_SIGNER: SignerRow = { name: "", email: "", roleLabel: "", orgLabel: "" };

export function SignoffForm({ teams, customers, initial }: Props): React.JSX.Element {
  const t = useTranslations("signoff.form");
  const isEdit = Boolean(initial?.documentId);

  const [teamId, setTeamId] = useState(initial?.teamId ?? teams[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [versionLabel, setVersionLabel] = useState(initial?.versionLabel ?? "");
  const [bodyMarkdown, setBodyMarkdown] = useState(initial?.bodyMarkdown ?? "");
  const [externalRef, setExternalRef] = useState(initial?.externalRef ?? "");
  const [signingMode, setSigningMode] = useState(initial?.signingMode ?? "all");
  const [signTheme, setSignTheme] = useState(initial?.signTheme ?? "light");
  const [signers, setSigners] = useState<SignerRow[]>(
    initial?.signers?.length ? initial.signers : [{ ...EMPTY_SIGNER }],
  );
  const [dirty, setDirty] = useState(false);

  const { pending, serverError, fieldErrors, handleSubmit } = useFormAction({
    action: isEdit ? updateSignoffDraftAction : createSignoffAction,
    onSuccess: () => setDirty(false),
  });
  useUnsavedChanges(dirty && !pending);

  const teamCustomers = useMemo(
    () => customers.filter((c) => c.team_id === teamId),
    [customers, teamId],
  );

  const payload = useMemo(
    () =>
      JSON.stringify({
        team_id: teamId,
        customer_id: customerId || null,
        document_type: "release_notes",
        title,
        version_label: versionLabel || null,
        body_markdown: bodyMarkdown,
        external_ref: externalRef || null,
        signing_mode: signingMode,
        sign_theme: signTheme,
        signers: signers
          .filter((s) => s.name.trim() || s.email.trim())
          .map((s) => ({
            name: s.name.trim(),
            email: s.email.trim(),
            roleLabel: s.roleLabel.trim() || null,
            orgLabel: s.orgLabel.trim() || null,
          })),
      }),
    [teamId, customerId, title, versionLabel, bodyMarkdown, externalRef, signingMode, signTheme, signers],
  );

  function updateSigner(i: number, patch: Partial<SignerRow>): void {
    setSigners((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setDirty(true);
  }

  return (
    <form action={handleSubmit} onChange={() => setDirty(true)} className="space-y-5">
      <input type="hidden" name="payload" value={payload} readOnly />
      {isEdit && <input type="hidden" name="document_id" value={initial!.documentId} readOnly />}

      {serverError && <AlertBanner tone="error">{serverError}</AlertBanner>}

      <div className={formGridClass}>
        {teams.length > 1 && (
          <div className={formSpanHalf}>
            <label htmlFor="signoff-team" className={labelClass}>{t("team")}</label>
            <select
              id="signoff-team"
              className={selectClass}
              value={teamId}
              onChange={(e) => { setTeamId(e.target.value); setCustomerId(""); }}
            >
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>{tm.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className={formSpanHalf}>
          <label htmlFor="signoff-customer" className={labelClass}>{t("customer")}</label>
          <select
            id="signoff-customer"
            className={selectClass}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">{t("noCustomer")}</option>
            {teamCustomers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className={formSpanHalf}>
          <label htmlFor="signoff-title" className={labelClass}>{t("titleLabel")}</label>
          <input
            id="signoff-title"
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("titlePlaceholder")}
            autoFocus
          />
          <FieldError error={fieldErrors.title} id="signoff-title-error" />
        </div>

        <div className={formSpanHalf}>
          <label htmlFor="signoff-version" className={labelClass}>{t("version")}</label>
          <input
            id="signoff-version"
            className={inputClass}
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder={t("versionPlaceholder")}
          />
        </div>

        <div className={formSpanFull}>
          <label htmlFor="signoff-ref" className={labelClass}>{t("externalRef")}</label>
          <input
            id="signoff-ref"
            className={inputClass}
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder={t("externalRefPlaceholder")}
          />
        </div>

        <div className={formSpanFull}>
          <label htmlFor="signoff-body" className={labelClass}>{t("body")}</label>
          <textarea
            id="signoff-body"
            className={`${inputClass} font-mono min-h-[240px]`}
            value={bodyMarkdown}
            onChange={(e) => setBodyMarkdown(e.target.value)}
            placeholder={t("bodyPlaceholder")}
          />
          <p className="mt-1 text-caption text-content-muted">{t("bodyHint")}</p>
          <FieldError error={fieldErrors.body_markdown} id="signoff-body-error" />
        </div>

        <div className={formSpanHalf}>
          <label htmlFor="signoff-mode" className={labelClass}>{t("signingMode")}</label>
          <select
            id="signoff-mode"
            className={selectClass}
            value={signingMode}
            onChange={(e) => setSigningMode(e.target.value)}
          >
            <option value="all">{t("modeAll")}</option>
            <option value="first">{t("modeFirst")}</option>
          </select>
        </div>

        <div className={formSpanHalf}>
          <label htmlFor="signoff-theme" className={labelClass}>{t("theme")}</label>
          <select
            id="signoff-theme"
            className={selectClass}
            value={signTheme}
            onChange={(e) => setSignTheme(e.target.value)}
          >
            <option value="light">{t("themeLight")}</option>
            <option value="dark">{t("themeDark")}</option>
            <option value="warm">{t("themeWarm")}</option>
          </select>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className={labelClass}>{t("signers")}</legend>
        <p className="text-caption text-content-muted">{t("signersHint")}</p>
        {signers.map((s, i) => (
          <div key={i} className="rounded-lg border border-edge p-3 space-y-2">
            <div className={formGridClass}>
              <div className={formSpanHalf}>
                <input
                  className={inputClass}
                  value={s.name}
                  onChange={(e) => updateSigner(i, { name: e.target.value })}
                  placeholder={t("signerName")}
                  aria-label={`${t("signerName")} — ${t("signerNumber", { n: i + 1 })}`}
                />
                <FieldError error={fieldErrors[`signers.${i}.name`]} id={`signer-${i}-name-error`} />
              </div>
              <div className={formSpanHalf}>
                <input
                  type="email"
                  className={inputClass}
                  value={s.email}
                  onChange={(e) => updateSigner(i, { email: e.target.value })}
                  placeholder={t("signerEmail")}
                  aria-label={`${t("signerEmail")} — ${t("signerNumber", { n: i + 1 })}`}
                />
                <FieldError error={fieldErrors[`signers.${i}.email`]} id={`signer-${i}-email-error`} />
              </div>
              <div className={formSpanHalf}>
                <input
                  className={inputClass}
                  value={s.roleLabel}
                  onChange={(e) => updateSigner(i, { roleLabel: e.target.value })}
                  placeholder={t("signerRole")}
                  aria-label={t("signerRole")}
                />
              </div>
              <div className={formSpanHalf}>
                <input
                  className={inputClass}
                  value={s.orgLabel}
                  onChange={(e) => updateSigner(i, { orgLabel: e.target.value })}
                  placeholder={t("signerOrg")}
                  aria-label={t("signerOrg")}
                />
              </div>
            </div>
            {signers.length > 1 && (
              <button
                type="button"
                className={buttonGhostClass}
                onClick={() => { setSigners((p) => p.filter((_, idx) => idx !== i)); setDirty(true); }}
              >
                <Trash2 size={14} />
                {t("removeSigner")}
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className={buttonSecondaryClass}
          onClick={() => { setSigners((p) => [...p, { ...EMPTY_SIGNER }]); setDirty(true); }}
        >
          <Plus size={16} />
          {t("addSigner")}
        </button>
      </fieldset>

      <div className="flex items-center gap-2 pt-2">
        <SubmitButton label={isEdit ? t("saveChanges") : t("createDraft")} pending={pending} />
      </div>
    </form>
  );
}
