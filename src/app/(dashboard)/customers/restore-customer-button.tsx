"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw, Loader2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { assertActionResult } from "@/lib/action-result";
import { bulkRestoreCustomersAction } from "./actions";

/**
 * Per-row Restore on the Archived view — the post-toast recovery surface the
 * destructive-flow rule promises. Non-destructive: no confirm tier, outcome
 * always lands in a toast.
 */
export function RestoreCustomerButton({
  customerId,
}: {
  customerId: string;
}): React.JSX.Element {
  const t = useTranslations("customers");
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-3 py-1.5 text-caption font-semibold text-content hover:bg-hover disabled:opacity-50"
      onClick={() => {
        startTransition(async () => {
          try {
            const fd = new FormData();
            fd.append("id", customerId);
            await assertActionResult(bulkRestoreCustomersAction(fd));
            toast.push({ kind: "success", message: t("restoredToast") });
          } catch (err) {
            toast.push({
              kind: "error",
              message:
                err instanceof Error ? err.message : t("restoreFailed"),
            });
          }
        });
      }}
    >
      {pending ? (
        <Loader2 size={14} aria-hidden="true" className="animate-spin" />
      ) : (
        <RotateCcw size={14} aria-hidden="true" />
      )}
      {t("restore")}
    </button>
  );
}
