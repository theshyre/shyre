"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Trash2, X } from "lucide-react";
import {
  buttonDangerClass,
  buttonGhostClass,
  inputClass,
} from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { deleteProposalAction } from "./actions";

interface Props {
  proposalId: string;
}

/** Tier-2 destructive flow (typed-`delete`) for removing a DRAFT proposal.
 *  Drafts are the only deletable state, but they can carry hours of authored
 *  scope prose with no soft-delete layer behind them — so this is a hard
 *  delete gated on typing the word, and failures surface inline (never a
 *  silent no-op). */
export function DeleteProposalButton({ proposalId }: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
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
        <Trash2 size={16} aria-hidden="true" />
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
            fd.set("id", proposalId);
            await assertActionResult(deleteProposalAction(fd));
          } catch (err) {
            setError(err instanceof Error ? err.message : t("deleteFailed"));
          }
        });
      }}
    >
      <span className="inline-flex items-center gap-2">
        <label htmlFor="delete-proposal-confirm" className="sr-only">
          {t("deleteTypeLabel")}
        </label>
        <input
          id="delete-proposal-confirm"
          className={`${inputClass} w-[120px]`}
          placeholder={t("deleteTypePlaceholder")}
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button
          type="submit"
          className={buttonDangerClass}
          disabled={pending || !armed}
        >
          <Trash2 size={16} aria-hidden="true" />
          {t("deleteConfirm")}
        </button>
        <button
          type="button"
          className={buttonGhostClass}
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          <X size={16} aria-hidden="true" />
          {t("deleteCancel")}
        </button>
      </span>
      {!armed && (
        <span className="text-caption text-content-secondary">
          {t("deleteTypeHint")}
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
