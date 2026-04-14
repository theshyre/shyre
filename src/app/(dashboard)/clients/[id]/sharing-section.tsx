"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Share2, Plus, X, Building2 } from "lucide-react";
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
  addClientShareAction,
  removeClientShareAction,
  updateShareVisibilityAction,
} from "./sharing-actions";
import { ChangePrimaryFlow } from "./change-primary-flow";

interface Share {
  id: string;
  organization_id: string;
  can_see_others_entries: boolean;
  organizations: { name: string } | { name: string }[] | null;
}

interface OrgOption {
  id: string;
  name: string;
}

function getOrgName(
  orgs: { name: string } | { name: string }[] | null,
): string {
  if (!orgs) return "—";
  return Array.isArray(orgs) ? orgs[0]?.name ?? "—" : orgs.name;
}

export function SharingSection({
  clientId,
  primaryOrgId,
  primaryOrgName,
  shares,
  availableOrgs,
  userCanAdmin,
  changePrimaryOrgs,
  canChangePrimary,
}: {
  clientId: string;
  primaryOrgId: string;
  primaryOrgName: string;
  shares: Share[];
  availableOrgs: OrgOption[];
  userCanAdmin: boolean;
  changePrimaryOrgs: OrgOption[];
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
    action: addClientShareAction,
    onSuccess: () => setAddingOrg(false),
  });

  // primaryOrgId reserved for future use (permission display)
  void primaryOrgId;

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
                {t("primaryOrg")}
              </p>
              <p className="font-semibold text-content">{primaryOrgName}</p>
            </div>
          </div>
          <ChangePrimaryFlow
            clientId={clientId}
            currentPrimaryOrgName={primaryOrgName}
            availableOrgs={changePrimaryOrgs}
            canChange={canChangePrimary}
          />
        </div>
      </div>

      {/* Participating orgs */}
      <div>
        <p className="text-xs uppercase tracking-wider text-content-muted mb-2">
          {t("participatingOrgs")}
        </p>

        {shares.length === 0 ? (
          <p className="text-sm text-content-muted">{t("noParticipants")}</p>
        ) : (
          <ul className="space-y-2">
            {shares.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                clientId={clientId}
                userCanAdmin={userCanAdmin}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Add organization */}
      {userCanAdmin && availableOrgs.length > 0 && (
        <div>
          {addingOrg ? (
            <form
              action={handleAdd}
              className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3"
            >
              <input type="hidden" name="client_id" value={clientId} />
              {addError && (
                <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
                  {addError}
                </p>
              )}
              <div>
                <label className={labelClass}>{t("addOrg")} *</label>
                <select
                  name="organization_id"
                  required
                  autoFocus
                  className={selectClass}
                  disabled={addPending}
                  defaultValue=""
                >
                  <option value="">—</option>
                  {availableOrgs.map((o) => (
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
                  label={t("addOrg")}
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
              {t("addOrg")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ShareRow({
  share,
  clientId,
  userCanAdmin,
}: {
  share: Share;
  clientId: string;
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
  } = useFormAction({ action: removeClientShareAction });

  const orgName = getOrgName(share.organizations);

  return (
    <li className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 size={16} className="text-content-muted" />
          <div>
            <p className="text-sm font-medium text-content">{orgName}</p>
          </div>
        </div>
        {userCanAdmin && (
          <form action={handleRemove}>
            <input type="hidden" name="share_id" value={share.id} />
            <input type="hidden" name="client_id" value={clientId} />
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
          <input type="hidden" name="client_id" value={clientId} />
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
