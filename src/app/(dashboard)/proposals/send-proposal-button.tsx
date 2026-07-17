"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Send, X } from "lucide-react";
import { buttonPrimaryClass, buttonGhostClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { sendProposalAction } from "./actions";

interface Props {
  proposalId: string;
  /** Sending requires a signer contact (the link + OTP go to their email). */
  hasSigner: boolean;
  /** The signer's email — restated in the inline confirm so a one-click
   *  misfire can't email the wrong person, and the author always knows
   *  exactly who receives the link. */
  signerEmail: string | null;
}

/** "Send for sign-off" — two-step: the confirm restates the recipient, since
 *  sending freezes the draft and emails the customer. Errors render inline. */
export function SendProposalButton({
  proposalId,
  hasSigner,
  signerEmail,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={!hasSigner}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          <Send size={16} aria-hidden="true" />
          {t("send")}
        </button>
        {!hasSigner && (
          <span className="text-caption text-content-secondary">
            {t("sendNeedsSigner")}
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
