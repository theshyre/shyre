"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Share2, Plus, X, Building2 } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
  selectClass,
  labelClass,
} from "@/lib/form-styles";
import {
  addCustomerShareAction,
  removeCustomerShareAction,
  updateShareVisibilityAction,
} from "./sharing-actions";
import { ChangePrimaryFlow } from "./change-primary-flow";

interface Share {
  id: string;
  team_id: string;
  can_see_others_entries: boolean;
  teams: { name: string } | { name: string }[] | null;
}

interface TeamOption {
  id: string;
  name: string;
}

function getTeamName(
  teams: { name: string } | { name: string }[] | null,
): string {
  if (!teams) return "—";
  return Array.isArray(teams) ? teams[0]?.name ?? "—" : teams.name;
}

export function SharingSection({
  customerId,
  primaryTeamId,
  primaryTeamName,
  shares,
  availableTeams,
  userCanAdmin,
  changePrimaryTeams,
  canChangePrimary,
}: {
  customerId: string;
  primaryTeamId: string;
  primaryTeamName: string;
  shares: Share[];
  availableTeams: TeamOption[];
  userCanAdmin: boolean;
  changePrimaryTeams: TeamOption[];
  canChangePrimary: boolean;
}): React.JSX.Element {
  const [addingOrg, setAddingOrg] = useState(false);
  const t = useTranslations("sharing.clientSharing");
  const tc = useTranslations("common");

  const {
    pending: addPending,
    serverError: addError,
    handleSubmit: handleAdd,
  } = useFormAction({
    action: addCustomerShareAction,
    onSuccess: () => setAddingOrg(false),
  });

  // primaryTeamId reserved for future use (permission display)
  void primaryTeamId;

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center gap-3">
        <Share2 size={20} className="text-accent" />
        <h2 className="text-lg font-semibold text-content">{t("title")}</h2>
      </div>

      {/* Primary Org card */}
      <div className="rounded-lg border border-edge bg-surface-raised p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
              <Building2 size={18} className="text-accent" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-content-muted">
                {t("primaryTeam")}
              </p>
              <p className="font-semibold text-content">{primaryTeamName}</p>
            </div>
          </div>
          <ChangePrimaryFlow
            customerId={customerId}
            currentPrimaryTeamName={primaryTeamName}
            availableTeams={changePrimaryTeams}
            canChange={canChangePrimary}
          />
        </div>
      </div>

      {/* Participating teams */}
      <div>
        <p className="text-xs uppercase tracking-wider text-content-muted mb-2">
          {t("participatingTeams")}
        </p>

        {shares.length === 0 ? (
          <p className="text-sm text-content-muted">{t("noParticipants")}</p>
        ) : (
          <ul className="space-y-2">
            {shares.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                customerId={customerId}
                userCanAdmin={userCanAdmin}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Add team */}
      {userCanAdmin && availableTeams.length > 0 && (
        <div>
          {addingOrg ? (
            <form
              action={handleAdd}
              className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3"
            >
              <input type="hidden" name="customer_id" value={customerId} />
              {addError && (
                <AlertBanner tone="error">{addError}</AlertBanner>
              )}
              <div>
                <label className={labelClass}>{t("addTeam")} *</label>
                <select
                  name="team_id"
                  required
                  autoFocus
                  className={selectClass}
                  disabled={addPending}
                  defaultValue=""
                >
                  <option value="">—</option>
                  {availableTeams.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-content">
                <input
                  type="checkbox"
                  name="can_see_others"
                  className="rounded border-edge"
                  disabled={addPending}
                />
                {t("canSeeOtherEntries")}
              </label>
              <div className="flex gap-2">
                <SubmitButton
                  label={t("addTeam")}
                  pending={addPending}
                  icon={Plus}
                />
                <button
                  type="button"
                  onClick={() => setAddingOrg(false)}
                  disabled={addPending}
                  className={buttonSecondaryClass}
                >
                  {tc("actions.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingOrg(true)}
              className={buttonPrimaryClass}
            >
              <Plus size={16} />
              {t("addTeam")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ShareRow({
  share,
  customerId,
  userCanAdmin,
}: {
  share: Share;
  customerId: string;
  userCanAdmin: boolean;
}): React.JSX.Element {
  const t = useTranslations("sharing.clientSharing");

  const {
    pending: visPending,
    handleSubmit: handleVisibility,
  } = useFormAction({ action: updateShareVisibilityAction });

  const {
    pending: removePending,
    serverError: removeError,
    handleSubmit: handleRemove,
  } = useFormAction({ action: removeCustomerShareAction });

  const teamName = getTeamName(share.teams);

  return (
    <li className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 size={16} className="text-content-muted" />
          <div>
            <p className="text-sm font-medium text-content">{teamName}</p>
          </div>
        </div>
        {userCanAdmin && (
          <form action={handleRemove}>
            <input type="hidden" name="share_id" value={share.id} />
            <input type="hidden" name="customer_id" value={customerId} />
            <button
              type="submit"
              disabled={removePending}
              className={buttonGhostClass}
              onClick={(e) => {
                if (!confirm(t("confirmRemove"))) e.preventDefault();
              }}
            >
              <X size={14} />
              <span className="sr-only">{t("removeOrg")}</span>
            </button>
          </form>
        )}
      </div>

      {removeError && (
        <p className="mt-2 text-xs text-error">{removeError}</p>
      )}

      {userCanAdmin && (
        <form
          action={handleVisibility}
          className="mt-2 flex items-center gap-2"
        >
          <input type="hidden" name="share_id" value={share.id} />
          <input type="hidden" name="customer_id" value={customerId} />
          <label className="flex items-center gap-2 text-xs text-content-secondary">
            <input
              type="checkbox"
              name="can_see_others"
              defaultChecked={share.can_see_others_entries}
              disabled={visPending}
              onChange={(e) => {
                e.currentTarget.form?.requestSubmit();
              }}
              className="rounded border-edge"
            />
            {t("canSeeOtherEntries")}
          </label>
        </form>
      )}
    </li>
  );
}
