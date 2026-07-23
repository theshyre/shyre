"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, XCircle } from "lucide-react";

import { MarkdownView } from "@/components/MarkdownView";
import {
  inputClass,
  selectClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  checkboxClass,
} from "@/lib/form-styles";
import { AlertBanner } from "@theshyre/ui";
import type { SignBundle } from "@/lib/sign/signoff-sign-service";
import { submitSignoffDecisionAction } from "./actions";

/** The document + typed-signature form. `signature_meaning` + an attestation
 *  checkbox are the 21 CFR Part 11 manifestation seed. */
export function SignoffSignExperience({
  token,
  bundle,
}: {
  token: string;
  bundle: SignBundle;
}): React.JSX.Element {
  const t = useTranslations("signoff.sign");
  const router = useRouter();
  const [name, setName] = useState(bundle.signerName ?? "");
  const [title, setTitle] = useState(bundle.signerRole ?? "");
  const [signature, setSignature] = useState("");
  const [meaning, setMeaning] = useState("approver");
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const brand = bundle.businessName ?? bundle.wordmarkPrimary ?? "";
  const canSign = name.trim() !== "" && signature.trim() !== "" && attested;

  function submit(decision: "signed" | "declined"): void {
    setError(null);
    startTransition(async () => {
      const res = await submitSignoffDecisionAction(token, {
        decision,
        signerName: name,
        signerTitle: title,
        signatureTyped: signature,
        signatureMeaning: meaning,
      });
      if (res.ok) router.refresh();
      else setError(t("submitError"));
    });
  }

  if (bundle.decided) {
    const declined = bundle.decision === "declined";
    return (
      <main className="mx-auto max-w-[760px] px-[24px] py-10">
        <div
          className={`rounded-lg border px-5 py-6 text-center ${
            declined ? "border-error/40 bg-error-soft" : "border-success/40 bg-success-soft"
          }`}
        >
          {declined ? (
            <XCircle size={28} className="mx-auto mb-2 text-error-text" aria-hidden="true" />
          ) : (
            <CheckCircle2 size={28} className="mx-auto mb-2 text-success-text" aria-hidden="true" />
          )}
          <p className={declined ? "text-body text-error-text" : "text-body text-success-text"}>
            {declined ? t("declinedBanner") : t("signedBanner")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[760px] px-[24px] py-10">
      <header className="mb-6">
        {brand && <p className="text-body-lg font-semibold text-content">{brand}</p>}
        <h1 className="mt-1 text-page-title font-bold text-content">{bundle.title}</h1>
        {bundle.versionLabel && (
          <p className="text-body text-content-secondary">{bundle.versionLabel}</p>
        )}
      </header>

      <div className="rounded-lg border border-edge bg-surface-raised px-5 py-4">
        <MarkdownView content={bundle.bodyMarkdown} />
      </div>

      <section className="mt-8 rounded-lg border border-edge bg-surface-raised px-5 py-5">
        <h2 className="text-title font-semibold text-content">{t("signHeading")}</h2>

        {error && (
          <div className="mt-3">
            <AlertBanner tone="error">{error}</AlertBanner>
          </div>
        )}

        <div className="mt-4 grid grid-cols-12 gap-3">
          <div className="col-span-12 sm:col-span-6">
            <label htmlFor="s-name" className={labelClass}>{t("nameLabel")}</label>
            <input id="s-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="col-span-12 sm:col-span-6">
            <label htmlFor="s-title" className={labelClass}>{t("titleLabel")}</label>
            <input id="s-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="col-span-12 sm:col-span-6">
            <label htmlFor="s-meaning" className={labelClass}>{t("meaningLabel")}</label>
            <select id="s-meaning" className={selectClass} value={meaning} onChange={(e) => setMeaning(e.target.value)}>
              <option value="author">{t("meaningAuthor")}</option>
              <option value="reviewer">{t("meaningReviewer")}</option>
              <option value="approver">{t("meaningApprover")}</option>
            </select>
          </div>
          <div className="col-span-12 sm:col-span-6">
            <label htmlFor="s-sig" className={labelClass}>{t("signatureLabel")}</label>
            <input
              id="s-sig"
              className={`${inputClass} font-[cursive]`}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder={t("signaturePlaceholder")}
            />
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2 text-body text-content">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
          />
          <span>{t("attestation", { meaning: t(`meaning${meaning[0]!.toUpperCase()}${meaning.slice(1)}`) })}</span>
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonPrimaryClass}
            onClick={() => submit("signed")}
            disabled={pending || !canSign}
          >
            <CheckCircle2 size={16} />
            {t("signButton")}
          </button>
          <button
            type="button"
            className={buttonSecondaryClass}
            onClick={() => submit("declined")}
            disabled={pending}
          >
            <XCircle size={16} />
            {t("declineButton")}
          </button>
        </div>
        <p className="mt-2 text-caption text-content-muted">{t("legalNote")}</p>
      </section>
    </main>
  );
}
