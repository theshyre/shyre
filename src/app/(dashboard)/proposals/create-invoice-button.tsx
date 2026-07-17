"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { createInvoiceFromProposalAction } from "./actions";

interface Props {
  proposalId: string;
}

/** Bill the accepted fixed prices onto a draft invoice (manual line items,
 *  terms carried from the proposal). Redirects to the new invoice. */
export function CreateInvoiceButton({ proposalId }: Props): React.JSX.Element {
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
              await assertActionResult(createInvoiceFromProposalAction(fd));
            } catch (err) {
              setError(err instanceof Error ? err.message : t("billFailed"));
            }
          });
        }}
      >
        <FileText size={16} aria-hidden="true" />
        {pending ? t("billing") : t("bill")}
      </button>
      {error && (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      )}
    </span>
  );
}
