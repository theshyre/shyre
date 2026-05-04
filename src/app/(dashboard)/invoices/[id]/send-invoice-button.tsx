"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { buttonPrimaryClass } from "@/lib/form-styles";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";

/**
 * Top-right primary action on the invoice detail page. Routes to
 * `/invoices/[id]/send`. Was a modal trigger pre-2026-05-04 — the
 * promotion to a real route fixed the misclick-loses-draft failure
 * mode and lets the route page do its own data fetch (no PDF
 * bundle handed across a portal).
 */
export function SendInvoiceButton({
  invoiceId,
  disabled,
}: {
  invoiceId: string;
  /** Optional — server can pass `true` when emailConfig is missing
   *  to demote the button so the route's setup-CTA isn't the user's
   *  first signal that something's wrong. Falls through to the
   *  route's own warning banner when the user lands there anyway. */
  disabled?: boolean;
}): React.JSX.Element {
  const t = useTranslations("messaging.send");
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className={buttonPrimaryClass}
        aria-label={t("openButton")}
      >
        <Send size={14} />
        {t("openButton")}
      </button>
    );
  }
  return (
    <Link
      href={`/invoices/${invoiceId}/send`}
      className={buttonPrimaryClass}
    >
      <Send size={14} />
      {t("openButton")}
      <LinkPendingSpinner />
    </Link>
  );
}
