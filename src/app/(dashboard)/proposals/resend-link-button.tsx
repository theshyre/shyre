"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Loader2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { resendSignLinksAction } from "./actions";

/**
 * Re-issue the outstanding sign link(s) on a sent proposal — the "client
 * lost the email" recovery that previously required a whole New Version.
 * Rotation is server-side (old links revoked first); outcome lands in a
 * toast either way, never a silent no-op.
 */
export function ResendLinkButton({
  proposalId,
}: {
  proposalId: string;
}): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={buttonSecondaryClass}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          try {
            const fd = new FormData();
            fd.set("id", proposalId);
            await assertActionResult(resendSignLinksAction(fd));
            toast.push({ kind: "success", message: t("resendSuccess") });
          } catch (err) {
            toast.push({
              kind: "error",
              message:
                err instanceof Error ? err.message : t("resendFailed"),
            });
          }
        });
      }}
    >
      {pending ? (
        <Loader2 size={16} aria-hidden="true" className="animate-spin" />
      ) : (
        <RefreshCw size={16} aria-hidden="true" />
      )}
      {pending ? t("resending") : t("resendLink")}
    </button>
  );
}
