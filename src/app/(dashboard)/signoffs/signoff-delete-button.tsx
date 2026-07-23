"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";

import { buttonDangerClass, buttonGhostClass } from "@/lib/form-styles";
import { deleteSignoffAction } from "./actions";

/** Inline typed-free confirm for deleting a DRAFT sign-off (low-stakes: a
 *  never-sent draft). Sent sign-offs are audit records and aren't deletable. */
export function SignoffDeleteButton({
  documentId,
}: {
  documentId: string;
}): React.JSX.Element {
  const t = useTranslations("signoff");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(): Promise<void> {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("document_id", documentId);
    const result = await deleteSignoffAction(fd);
    if (result.success) {
      router.push("/signoffs");
      router.refresh();
    } else {
      // Keep the confirm open so the inline error stays visible + retryable.
      setError(t("deleteFailed"));
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className={buttonGhostClass}
        onClick={() => setConfirming(true)}
      >
        <Trash2 size={15} />
        {t("delete")}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-label text-error-text">{error}</span>}
      <button
        type="button"
        className={buttonDangerClass}
        onClick={onDelete}
        disabled={pending}
      >
        {t("confirmDelete")}
      </button>
      <button
        type="button"
        className={buttonGhostClass}
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        {t("cancel")}
      </button>
    </span>
  );
}
