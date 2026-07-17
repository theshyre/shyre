"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FolderPlus } from "lucide-react";
import { buttonPrimaryClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { convertProposalAction } from "./actions";

interface Props {
  proposalId: string;
}

/** Convert the accepted line items into projects (phased items become a
 *  project with sub-projects). */
export function ConvertProposalButton({ proposalId }: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
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
              await assertActionResult(convertProposalAction(fd));
            } catch (err) {
              setError(err instanceof Error ? err.message : t("convertFailed"));
            }
          });
        }}
      >
        <FolderPlus size={16} aria-hidden="true" />
        {pending ? t("converting") : t("convert")}
      </button>
      {error && (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      )}
    </span>
  );
}
