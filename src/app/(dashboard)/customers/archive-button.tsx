"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { archiveCustomerAction } from "./actions";
import { useToast } from "@/components/Toast";

/**
 * Inline-confirmed "archive customer" button. Archive is the
 * destructive flow for a multi-entity row (a customer carries
 * projects + time + invoices), so per `forms-and-buttons.md` it
 * needs the typed-`delete` confirm rather than a native
 * `confirm()` dialog.
 */
export function ArchiveButton({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}): React.JSX.Element {
  const t = useTranslations("customers");
  const toast = useToast();
  const [, startTransition] = useTransition();

  const onConfirm = (): void => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", customerId);
      try {
        await archiveCustomerAction(formData);
      } catch (err) {
        // archiveCustomerAction issues a Next.js redirect on success
        // which surfaces as a thrown NEXT_REDIRECT — let it propagate.
        const isRedirect =
          err instanceof Error && err.message.includes("NEXT_REDIRECT");
        if (isRedirect) throw err;
        toast.push({
          kind: "error",
          message: t("archiveFailed"),
        });
      }
    });
  };

  return (
    <InlineDeleteRowConfirm
      ariaLabel={t("archiveAria", { name: customerName })}
      onConfirm={onConfirm}
      summary={customerName}
    />
  );
}
