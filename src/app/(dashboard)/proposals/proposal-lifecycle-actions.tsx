"use client";

import type React from "react";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { PackageCheck, RotateCcw, CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { buttonSecondaryClass, buttonGhostClass } from "@/lib/form-styles";
import { InlineCancelButton } from "@/components/InlineCancelButton";
import {
  markProposalDeliveredAction,
  reopenProposalDeliveryAction,
} from "./actions";

/**
 * Owner/admin "mark delivered" + reopen control for a CONVERTED proposal's
 * header. Delivery is a reversible-light state change (a `delivered_at`
 * stamp, not data loss), so it uses an inline arm-then-confirm — NOT a modal
 * — mirroring `ProjectLifecycleActions` (the close-out control this parallels
 * one level up: proposal = the engagement, projects = its phases). The
 * confirm restates the "N of M phases closed out" progress so the author
 * sees whether the whole engagement is done before asserting delivery, but
 * NEVER blocks a partial delivery (an owner may deliver the phases they sold
 * while a later one dangles). Both deliver + reopen pair with an Undo toast.
 * Renders nothing for non-admins (the server action is authoritative; this
 * just hides the affordance).
 *
 * Unlike the effectively-dead try/catch in ProjectLifecycleActions, this
 * checks the returned `ActionResult` — `runSafeAction` resolves an error
 * envelope rather than throwing, so a failed deliver actually surfaces its
 * message instead of a false success toast.
 */
export function ProposalLifecycleActions({
  proposalId,
  delivered,
  deliveryReady,
  deliveredCount,
  deliveredTotal,
  isAdmin,
}: {
  proposalId: string;
  delivered: boolean;
  deliveryReady: boolean;
  deliveredCount: number;
  deliveredTotal: number;
  isAdmin: boolean;
}): React.JSX.Element | null {
  const t = useTranslations("proposals.detail");
  const tc = useTranslations("common");
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!isAdmin) return null;

  function doDeliver(): void {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", proposalId);
      const result = await markProposalDeliveredAction(fd);
      if (!result.success) {
        toast.push({
          kind: "error",
          message: result.error.message ?? t("deliverFailed"),
        });
        return;
      }
      setConfirming(false);
      toast.push({
        kind: "success",
        message: t("deliveredToast"),
        actionLabel: tc("actions.undo"),
        onAction: async () => {
          const undoFd = new FormData();
          undoFd.append("id", proposalId);
          const undo = await reopenProposalDeliveryAction(undoFd);
          toast.push(
            undo.success
              ? { kind: "success", message: t("reopenedToast") }
              : {
                  kind: "error",
                  message: undo.error.message ?? t("reopenFailed"),
                },
          );
        },
      });
    });
  }

  function doReopen(): void {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", proposalId);
      const result = await reopenProposalDeliveryAction(fd);
      toast.push(
        result.success
          ? { kind: "success", message: t("reopenedToast") }
          : {
              kind: "error",
              message: result.error.message ?? t("reopenFailed"),
            },
      );
    });
  }

  if (delivered) {
    return (
      <button
        type="button"
        onClick={doReopen}
        disabled={pending}
        className={`${buttonSecondaryClass} inline-flex items-center gap-1.5`}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {t("reopenDelivery")}
      </button>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`${buttonSecondaryClass} inline-flex items-center gap-1.5`}
      >
        <PackageCheck size={14} aria-hidden="true" />
        {t("markDelivered")}
      </button>
    );
  }

  return (
    <div className="rounded-md border border-info/30 bg-info-soft/40 p-3 space-y-2 max-w-sm">
      {deliveryReady ? (
        <p className="flex items-start gap-1.5 text-caption text-success-text">
          <CheckCircle2 size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{t("deliverReadyPrompt", { total: deliveredTotal })}</span>
        </p>
      ) : (
        <p className="text-caption text-content-secondary">
          {t("deliverPartialPrompt", {
            delivered: deliveredCount,
            total: deliveredTotal,
          })}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={doDeliver}
          disabled={pending}
          className={`${buttonSecondaryClass} inline-flex items-center gap-1.5 text-caption`}
        >
          <PackageCheck size={14} aria-hidden="true" />
          {t("markDeliveredConfirm")}
        </button>
        <InlineCancelButton
          onClick={() => setConfirming(false)}
          className={buttonGhostClass}
          label={tc("actions.cancel")}
        />
      </div>
    </div>
  );
}
