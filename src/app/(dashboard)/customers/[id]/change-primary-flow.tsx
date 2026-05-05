"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRightLeft } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  buttonSecondaryClass,
  buttonGhostClass,
  selectClass,
  labelClass,
} from "@/lib/form-styles";
import { changePrimaryTeamAction } from "./change-primary-actions";

interface TeamOption {
  id: string;
  name: string;
}

export function ChangePrimaryFlow({
  customerId,
  currentPrimaryTeamName,
  availableTeams,
  canChange,
}: {
  customerId: string;
  currentPrimaryTeamName: string;
  availableTeams: TeamOption[];
  canChange: boolean;
}): React.JSX.Element | null {
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState("");
  const t = useTranslations("sharing.changePrimary");
  const tc = useTranslations("common");

  const { pending, serverError, handleSubmit } = useFormAction({
    action: changePrimaryTeamAction,
    onSuccess: () => {
      setConfirming(false);
      setSelected("");
    },
  });

  if (!canChange) return null;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`${buttonGhostClass} text-caption`}
      >
        <ArrowRightLeft size={12} />
        {t("title")}
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="rounded-lg border border-warning/30 bg-warning-soft/30 p-4 space-y-3"
    >
      <input type="hidden" name="customer_id" value={customerId} />

      <div>
        <p className="text-body-lg font-semibold text-content">{t("title")}</p>
        <p className="mt-1 text-body-lg text-content-secondary">{t("warning")}</p>
        <p className="mt-2 text-caption text-content-muted">{t("consequence")}</p>
      </div>

      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}

      <div>
        <label htmlFor="cp-new-team" className={labelClass}>
          {currentPrimaryTeamName} →
        </label>
        <select
          id="cp-new-team"
          name="new_team_id"
          required
          autoFocus
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className={selectClass}
          disabled={pending}
        >
          <option value="">—</option>
          {availableTeams.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <SubmitButton
          label={t("confirmTransfer")}
          pending={pending}
          icon={ArrowRightLeft}
          disabled={!selected}
        />
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setSelected("");
          }}
          disabled={pending}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
