"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2, X } from "lucide-react";

import { buttonDangerClass, buttonGhostClass, inputClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { deleteSignoffAction } from "./actions";

/** Tier-2 destructive flow (typed-`delete`) for removing a deletable sign-off —
 *  a draft or a canceled one. A draft can hold a long markdown body + a signer
 *  roster with no soft-delete layer behind it, so this is a hard delete gated
 *  on typing the word (forms-and-buttons.md); the server action re-checks
 *  deletability. Failures surface inline, never a silent no-op. */
export function SignoffDeleteButton({
  documentId,
}: {
  documentId: string;
}): React.JSX.Element {
  const t = useTranslations("signoff");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        className={buttonDangerClass}
        onClick={() => {
          setTyped("");
          setError(null);
          setConfirming(true);
        }}
      >
        <Trash2 size={15} aria-hidden="true" />
        {t("delete")}
      </button>
    );
  }

  const armed = typed.trim().toLowerCase() === "delete";

  return (
    <form
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!armed || pending) return;
        setError(null);
        startTransition(async () => {
          try {
            const fd = new FormData();
            fd.set("document_id", documentId);
            await assertActionResult(deleteSignoffAction(fd));
            router.push("/signoffs");
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : t("deleteFailed"));
          }
        });
      }}
    >
      <span className="inline-flex items-center gap-2">
        <label htmlFor="delete-signoff-confirm" className="sr-only">
          {t("deleteTypeLabel")}
        </label>
        <input
          id="delete-signoff-confirm"
          className={`${inputClass} w-[120px]`}
          placeholder={t("deleteTypePlaceholder")}
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" className={buttonDangerClass} disabled={pending || !armed}>
          <Trash2 size={15} aria-hidden="true" />
          {t("confirmDelete")}
        </button>
        <button
          type="button"
          className={buttonGhostClass}
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          <X size={15} aria-hidden="true" />
          {t("cancel")}
        </button>
      </span>
      {!armed && (
        <span className="text-caption text-content-secondary">{t("deleteTypeHint")}</span>
      )}
      {error && (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      )}
    </form>
  );
}
