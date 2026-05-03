"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { buttonPrimaryClass } from "@/lib/form-styles";
import { SendInvoiceModal } from "./send-invoice-modal";

/**
 * Top-right primary action on the invoice detail page. Opens the
 * Send Invoice modal. Demoted state when email isn't configured —
 * the modal still opens (it's the right place to surface the
 * setup CTA), just with the warning banner up top.
 */
export function SendInvoiceButton(
  props: React.ComponentProps<typeof SendInvoiceModal> extends infer P
    ? Omit<P & { open: boolean; onClose: () => void }, "open" | "onClose">
    : never,
): React.JSX.Element {
  const t = useTranslations("messaging.send");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonPrimaryClass}
      >
        <Send size={14} />
        {t("openButton")}
      </button>
      <SendInvoiceModal
        open={open}
        onClose={() => setOpen(false)}
        {...props}
      />
    </>
  );
}
