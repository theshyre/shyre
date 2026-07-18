"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { createInvoiceFromProposalAction } from "./actions";

interface Props {
  proposalId: string;
  /** True when a deposit term exists and hasn't been billed yet — renders
   *  the "Bill deposit" companion button (2026-07-18 decision). */
  depositAvailable?: boolean;
}

/** Bill the accepted fixed prices onto a draft invoice (manual line items,
 *  terms carried from the proposal). Redirects to the new invoice. */
export function CreateInvoiceButton({
  proposalId,
  depositAvailable = false,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const [pending, startTransition] = useTransition();
  const [pendingMode, setPendingMode] = useState<"full" | "deposit" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  function bill(mode: "full" | "deposit"): void {
    setError(null);
    setPendingMode(mode);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("id", proposalId);
        fd.set("mode", mode);
        await assertActionResult(createInvoiceFromProposalAction(fd));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("billFailed"));
      } finally {
        setPendingMode(null);
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-2">
        {depositAvailable && (
          <button
            type="button"
            className={buttonSecondaryClass}
            disabled={pending}
            onClick={() => bill("deposit")}
          >
            <FileText size={16} aria-hidden="true" />
            {pendingMode === "deposit" ? t("billing") : t("billDeposit")}
          </button>
        )}
        <button
          type="button"
          className={buttonSecondaryClass}
          disabled={pending}
          onClick={() => bill("full")}
        >
          <FileText size={16} aria-hidden="true" />
          {pendingMode === "full" ? t("billing") : t("bill")}
        </button>
      </span>
      {error && (
        <span
          role="alert"
          className="flex items-center gap-1 text-caption text-error-text"
        >
          {error}
        </span>
      )}
    </span>
  );
}
