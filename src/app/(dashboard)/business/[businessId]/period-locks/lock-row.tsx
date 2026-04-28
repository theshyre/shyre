"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, Unlock, X } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  labelClass,
  buttonDangerClass,
  buttonGhostClass,
} from "@/lib/form-styles";
import { unlockPeriodAction } from "./actions";

interface Props {
  teamId: string;
  teamName: string;
  periodEnd: string;
  lockedAt: string;
  lockedByDisplayName: string | null;
  notes: string | null;
  showTeam: boolean;
}

export function LockRow({
  teamId,
  teamName,
  periodEnd,
  lockedAt,
  lockedByDisplayName,
  notes,
  showTeam,
}: Props): React.JSX.Element {
  const t = useTranslations("business.periodLocks");
  const [confirming, setConfirming] = useState(false);
  const [confirmValue, setConfirmValue] = useState("");
  const { pending, serverError, handleSubmit } = useFormAction({
    action: unlockPeriodAction,
  });

  const armed = confirmValue.trim().toLowerCase() === "unlock";

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <Lock size={16} className="mt-0.5 text-content-muted" />
        <div className="flex-1 min-w-[200px]">
          <p className="text-body-lg font-semibold text-content">
            {t("lockedThrough", { date: periodEnd })}
          </p>
          {showTeam && (
            <p className="text-caption text-content-secondary">{teamName}</p>
          )}
          <p className="text-caption text-content-muted">
            {t("fields.lockedAt")}: {new Date(lockedAt).toLocaleString()}
            {lockedByDisplayName && (
              <>
                {" · "}
                {t("fields.lockedBy")}: {lockedByDisplayName}
              </>
            )}
          </p>
          {notes && (
            <p className="mt-1 text-caption text-content-secondary">{notes}</p>
          )}
        </div>

        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={buttonGhostClass}
          >
            <Unlock size={14} />
            {t("actions.unlock")}
          </button>
        )}
      </div>

      {confirming && (
        <form
          action={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setConfirming(false);
              setConfirmValue("");
            }
          }}
          className="mt-3 space-y-2 border-t border-edge pt-3"
        >
          <input type="hidden" name="team_id" value={teamId} />
          <input type="hidden" name="period_end" value={periodEnd} />
          <input type="hidden" name="confirm" value={confirmValue} />

          {serverError && (
            <AlertBanner tone="error">{serverError}</AlertBanner>
          )}

          <div>
            <label className={labelClass}>{t("actions.unlockConfirm")}</label>
            <input
              type="text"
              autoFocus
              className={`${inputClass} font-mono`}
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              placeholder="unlock"
            />
          </div>

          <div className="flex items-center gap-2">
            <SubmitButton
              label={t("actions.unlockCta")}
              icon={Unlock}
              pending={pending}
              disabled={!armed}
              className={buttonDangerClass}
            />
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setConfirmValue("");
              }}
              className={buttonGhostClass}
            >
              <X size={14} />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
