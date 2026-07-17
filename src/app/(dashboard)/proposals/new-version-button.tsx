"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CopyPlus } from "lucide-react";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { createProposalVersionAction } from "./actions";

interface Props {
  proposalId: string;
}

/** Issue a new version of a sent/viewed/declined proposal: copies the
 *  document into a fresh editable draft and supersedes the old one (its
 *  outstanding sign links are revoked). Redirects into the new draft's
 *  editor. */
export function NewVersionButton({ proposalId }: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={buttonSecondaryClass}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const fd = new FormData();
              fd.set("id", proposalId);
              await assertActionResult(createProposalVersionAction(fd));
            } catch (err) {
              setError(
                err instanceof Error ? err.message : t("newVersionFailed"),
              );
            }
          });
        }}
      >
        <CopyPlus size={16} aria-hidden="true" />
        {pending ? t("newVersionPending") : t("newVersion")}
      </button>
      {error && (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      )}
    </span>
  );
}
