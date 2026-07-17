"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { PenLine } from "lucide-react";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { counterSignProposalAction } from "./actions";

interface Props {
  proposalId: string;
}

/** Provider counter-signature on an accepted proposal — completes the
 *  both-parties record. */
export function CounterSignButton({ proposalId }: Props): React.JSX.Element {
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
              await assertActionResult(counterSignProposalAction(fd));
            } catch (err) {
              setError(err instanceof Error ? err.message : t("sendFailed"));
            }
          });
        }}
      >
        <PenLine size={16} aria-hidden="true" />
        {pending ? t("countersigning") : t("countersign")}
      </button>
      {error && (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      )}
    </span>
  );
}
