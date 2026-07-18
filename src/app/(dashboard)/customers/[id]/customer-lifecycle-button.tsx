"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Moon, RotateCcw, Loader2 } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import {
  deactivateCustomerAction,
  reactivateCustomerAction,
} from "../actions";

/**
 * Detail-header lifecycle verb (project-lifecycle-actions precedent —
 * lifecycle lives in the header, never as a save-gated form field).
 * Non-destructive → no confirm tier; Undo rides the toast. The tooltip
 * carries the inactive-vs-archive microcopy so the two states can't blur.
 */
export function CustomerLifecycleButton({
  customerId,
  inactive,
}: {
  customerId: string;
  inactive: boolean;
}): React.JSX.Element {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function run(action: "deactivate" | "reactivate"): void {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("id", customerId);
        await assertActionResult(
          action === "deactivate"
            ? deactivateCustomerAction(fd)
            : reactivateCustomerAction(fd),
        );
        toast.push({
          kind: "success",
          message: t(
            action === "deactivate"
              ? "bulkDeactivatedToast"
              : "bulkReactivatedToast",
            { count: 1 },
          ),
          ...(action === "deactivate"
            ? {
                actionLabel: tc("actions.undo"),
                onAction: async () => {
                  const undoFd = new FormData();
                  undoFd.append("id", customerId);
                  await reactivateCustomerAction(undoFd);
                },
              }
            : {}),
        });
      } catch (err) {
        toast.push({
          kind: "error",
          message:
            err instanceof Error ? err.message : t("deactivateFailed"),
        });
      }
    });
  }

  const button = (
    <button
      type="button"
      className={buttonSecondaryClass}
      disabled={pending}
      onClick={() => run(inactive ? "reactivate" : "deactivate")}
    >
      {pending ? (
        <Loader2 size={16} aria-hidden="true" className="animate-spin" />
      ) : inactive ? (
        <RotateCcw size={16} aria-hidden="true" />
      ) : (
        <Moon size={16} aria-hidden="true" />
      )}
      {inactive ? t("reactivate") : t("markInactive")}
    </button>
  );

  return inactive ? (
    button
  ) : (
    <Tooltip label={t("lifecycleHint")}>{button}</Tooltip>
  );
}
