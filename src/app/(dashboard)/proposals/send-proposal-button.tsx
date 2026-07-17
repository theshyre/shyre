"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Send, X, CircleAlert } from "lucide-react";
import { buttonPrimaryClass, buttonGhostClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { sendProposalAction } from "./actions";

interface Props {
  proposalId: string;
  /** Translated "what's still missing before this can go out" messages. Empty
   *  means the draft is ready to send; non-empty disables Send and renders the
   *  readiness checklist so the author knows exactly what to finish. */
  blockers: string[];
  /** The signer's email — restated in the inline confirm so a one-click
   *  misfire can't email the wrong person, and the author always knows
   *  exactly who receives the link. */
  signerEmail: string | null;
}

/** "Send for sign-off" — two-step: the confirm restates the recipient, since
 *  sending freezes the draft and emails the customer. A draft that isn't
 *  complete shows a checklist instead of an enabled button. Errors inline. */
export function SendProposalButton({
  proposalId,
  blockers,
  signerEmail,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ready = blockers.length === 0;

  if (!confirming) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={!ready}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          <Send size={16} aria-hidden="true" />
          {t("send")}
        </button>
        {!ready && (
          <span className="mt-1 flex flex-col gap-1">
            <span className="text-caption text-content-secondary">
              {t("sendChecklistIntro")}
            </span>
            <ul className="flex flex-col gap-1">
              {blockers.map((b, i) => (
                <li
                  key={i}
                  className="flex items-center gap-1 text-caption text-content-secondary"
                >
                  <CircleAlert
                    size={12}
                    aria-hidden="true"
                    className="shrink-0 text-warning"
                  />
                  {b}
                </li>
              ))}
            </ul>
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const fd = new FormData();
                fd.set("id", proposalId);
                await assertActionResult(sendProposalAction(fd));
              } catch (err) {
                setError(err instanceof Error ? err.message : t("sendFailed"));
              }
            });
          }}
        >
          <Send size={16} aria-hidden="true" />
          {pending
            ? t("sending")
            : t("sendConfirm", { email: signerEmail ?? "—" })}
        </button>
        <button
          type="button"
          className={buttonGhostClass}
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          <X size={16} aria-hidden="true" />
          {t("sendCancel")}
        </button>
      </span>
      <span className="text-caption text-content-secondary">
        {t("sendFreezeNote")}
      </span>
      {error && (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      )}
    </span>
  );
}
