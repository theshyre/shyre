"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
} from "@/lib/form-styles";
import { lockPeriodAction } from "./actions";

interface Props {
  teamOptions: Array<{ id: string; name: string }>;
}

export function LockPeriodForm({ teamOptions }: Props): React.JSX.Element {
  const t = useTranslations("business.periodLocks");
  const tc = useTranslations("common");
  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: lockPeriodAction,
  });

  const showTeam = teamOptions.length > 1;

  return (
    <form
      action={handleSubmit}
      className="rounded-lg border border-edge bg-surface-raised p-5 space-y-3"
    >
      {serverError && <AlertBanner tone="error">{serverError}</AlertBanner>}

      <p className="text-caption text-content-muted">{t("newLockHint")}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        {showTeam && (
          <div>
            <label htmlFor="period-locks-lock-period-form-team" className={labelClass}>{t("fields.team")}</label>
            <select id="period-locks-lock-period-form-team"
              name="team_id"
              defaultValue={teamOptions[0]?.id}
              className={selectClass}
              required
            >
              {teamOptions.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {!showTeam && (
          <input
            type="hidden"
            name="team_id"
            value={teamOptions[0]?.id ?? ""}
          />
        )}

        <div>
          <label htmlFor="period-locks-lock-period-form-periodEnd" className={labelClass}>{t("fields.periodEnd")}</label>
          <input id="period-locks-lock-period-form-periodEnd"
            name="period_end"
            type="date"
            className={inputClass}
            required
          />
        </div>

        <div className={showTeam ? "" : "sm:col-span-2"}>
          <label htmlFor="period-locks-lock-period-form-notes" className={labelClass}>{t("fields.notes")}</label>
          <input id="period-locks-lock-period-form-notes" name="notes" type="text" className={inputClass} />
        </div>
      </div>

      <div>
        <SubmitButton
          label={t("newLock")}
          icon={Lock}
          pending={pending}
          success={success}
          successMessage={tc("actions.saved")}
          className={buttonPrimaryClass}
        />
      </div>
    </form>
  );
}
