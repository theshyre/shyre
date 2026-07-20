"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { UserCheck, X } from "lucide-react";
import {
  buttonSecondaryClass,
  buttonPrimaryClass,
  buttonGhostClass,
  textareaClass,
} from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { overrideProposalSignoffAction } from "./actions";

interface Props {
  proposalId: string;
  /** Signers still outstanding — shown in the confirm so the user sees
   *  exactly whose signature they're waiving. */
  waivedNames: string[];
}

/**
 * Owner/admin override of a stalled multi-signer sign-off. Inline
 * expansion (not a modal — one field) with a REQUIRED reason textarea:
 * the override waives a co-signer, so the record must say why. The
 * server action re-checks every precondition and records the note +
 * waived signers as an audited `signoff_overridden` event.
 */
export function OverrideSignoffButton({
  proposalId,
  waivedNames,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        className={buttonSecondaryClass}
        onClick={() => {
          setNote("");
          setError(null);
          setConfirming(true);
        }}
      >
        <UserCheck size={16} aria-hidden="true" />
        {t("override")}
      </button>
    );
  }

  const armed = note.trim().length >= 5;

  return (
    <form
      className="flex w-full max-w-md flex-col gap-2 rounded-lg border border-edge bg-surface-raised p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!armed || pending) return;
        setError(null);
        startTransition(async () => {
          try {
            const fd = new FormData();
            fd.set("id", proposalId);
            fd.set("note", note.trim());
            await assertActionResult(overrideProposalSignoffAction(fd));
            setConfirming(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : t("overrideFailed"));
          }
        });
      }}
    >
      <p className="text-body font-medium text-content">
        {t("overrideConfirmTitle")}
      </p>
      {waivedNames.length > 0 && (
        <p className="text-caption text-content-secondary">
          {t("overrideWaiving", { names: waivedNames.join(", ") })}
        </p>
      )}
      <label htmlFor="override-note" className="sr-only">
        {t("overrideNoteLabel")}
      </label>
      <textarea
        id="override-note"
        className={textareaClass}
        rows={2}
        autoFocus
        required
        placeholder={t("overrideNotePlaceholder")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className={buttonPrimaryClass}
          disabled={pending || !armed}
        >
          <UserCheck size={16} aria-hidden="true" />
          {t("overrideConfirm")}
        </button>
        <button
          type="button"
          className={buttonGhostClass}
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          <X size={16} aria-hidden="true" />
          {t("overrideCancel")}
        </button>
      </div>
      {!armed && (
        <span className="text-caption text-content-secondary">
          {t("overrideNoteHint")}
        </span>
      )}
      {error && (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      )}
    </form>
  );
}
