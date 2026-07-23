"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Send, Ban } from "lucide-react";

import { buttonPrimaryClass, buttonGhostClass, buttonDangerClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { sendSignoffAction, cancelSignoffAction } from "./actions";

/** Send a draft sign-off — inline confirm (outward-facing: emails real people).
 *  Disabled until the draft is send-ready (parent gates on the readiness list). */
export function SignoffSendButton({
  documentId,
  ready,
}: {
  documentId: string;
  ready: boolean;
}): React.JSX.Element {
  const t = useTranslations("signoff");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(): void {
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("document_id", documentId);
        await assertActionResult(sendSignoffAction(fd));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("sendFailed"));
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className={buttonPrimaryClass}
        onClick={() => setConfirming(true)}
        disabled={!ready}
      >
        <Send size={15} />
        {t("send")}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-2">
        <button type="button" className={buttonPrimaryClass} onClick={send} disabled={pending}>
          <Send size={15} />
          {t("confirmSend")}
        </button>
        <button type="button" className={buttonGhostClass} onClick={() => setConfirming(false)} disabled={pending}>
          {t("cancel")}
        </button>
      </span>
      {error && <span role="alert" className="text-caption text-error">{error}</span>}
    </span>
  );
}

/** Cancel an in-flight sign-off — revokes outstanding links. Inline confirm. */
export function SignoffCancelButton({ documentId }: { documentId: string }): React.JSX.Element {
  const t = useTranslations("signoff");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel(): void {
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("document_id", documentId);
        await assertActionResult(cancelSignoffAction(fd));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("cancelFailed"));
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <button type="button" className={buttonGhostClass} onClick={() => setConfirming(true)}>
        <Ban size={15} />
        {t("cancelSignoff")}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-2">
        <button type="button" className={buttonDangerClass} onClick={cancel} disabled={pending}>
          {t("confirmCancelSignoff")}
        </button>
        <button type="button" className={buttonGhostClass} onClick={() => setConfirming(false)} disabled={pending}>
          {t("keepSending")}
        </button>
      </span>
      {error && <span role="alert" className="text-caption text-error">{error}</span>}
    </span>
  );
}
