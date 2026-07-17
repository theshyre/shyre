"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { buttonPrimaryClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { sendProposalAction } from "./actions";

interface Props {
  proposalId: string;
  /** Sending requires a signer contact (the link + OTP go to their email). */
  hasSigner: boolean;
}

/** "Send for sign-off" — flips draft → sent, mints the public link, emails
 *  the signer. Errors render inline (never a silent failure). */
export function SendProposalButton({
  proposalId,
  hasSigner,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={buttonPrimaryClass}
        disabled={pending || !hasSigner}
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
        {pending ? t("sending") : t("send")}
      </button>
      {!hasSigner && (
        <span className="text-caption text-content-secondary">
          {t("sendNeedsSigner")}
        </span>
      )}
      {error && (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      )}
    </span>
  );
}
