"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Check, X } from "lucide-react";
import { buttonDangerClass, buttonGhostClass } from "@/lib/form-styles";
import { deleteProposalAction } from "./actions";

interface Props {
  proposalId: string;
}

/** Tier-1 destructive flow (inline [Confirm][Cancel]) for deleting a DRAFT
 *  proposal. Drafts are the only deletable state and carry no acceptance
 *  record, so no soft-delete/Undo pairing is required — nothing a client
 *  signed can be lost here. */
export function DeleteProposalButton({ proposalId }: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        className={buttonDangerClass}
        onClick={() => setConfirming(true)}
      >
        <Trash2 size={16} aria-hidden="true" />
        {t("delete")}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={buttonDangerClass}
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const fd = new FormData();
            fd.set("id", proposalId);
            await deleteProposalAction(fd);
          });
        }}
      >
        <Check size={16} aria-hidden="true" />
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
  );
}
