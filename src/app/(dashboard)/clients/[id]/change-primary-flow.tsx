"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRightLeft } from "lucide-react";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  buttonSecondaryClass,
  buttonGhostClass,
  selectClass,
  labelClass,
} from "@/lib/form-styles";
import { changePrimaryOrgAction } from "./change-primary-actions";

interface OrgOption {
  id: string;
  name: string;
}

export function ChangePrimaryFlow({
  clientId,
  currentPrimaryOrgName,
  availableOrgs,
  canChange,
}: {
  clientId: string;
  currentPrimaryOrgName: string;
  availableOrgs: OrgOption[];
  canChange: boolean;
}): React.JSX.Element | null {
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState("");
  const t = useTranslations("sharing.changePrimary");
  const tc = useTranslations("common");

  const { pending, serverError, handleSubmit } = useFormAction({
    action: changePrimaryOrgAction,
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
        className={`${buttonGhostClass} text-xs`}
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
      <input type="hidden" name="client_id" value={clientId} />

      <div>
        <p className="text-sm font-semibold text-content">{t("title")}</p>
        <p className="mt-1 text-sm text-content-secondary">{t("warning")}</p>
        <p className="mt-2 text-xs text-content-muted">{t("consequence")}</p>
      </div>

      {serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {serverError}
        </p>
      )}

      <div>
        <label className={labelClass}>
          {currentPrimaryOrgName} →
        </label>
        <select
          name="new_org_id"
          required
          autoFocus
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className={selectClass}
          disabled={pending}
        >
          <option value="">—</option>
          {availableOrgs.map((o) => (
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
