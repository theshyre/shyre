"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Network, Plus, X, Check, Building2 } from "lucide-react";
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
  proposeOrgShareAction,
  acceptOrgShareAction,
  removeOrgShareAction,
} from "./relationships-actions";

interface OrgShare {
  id: string;
  parent_org_id: string;
  child_org_id: string;
  sharing_level: string;
  accepted_at: string | null;
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

export function RelationshipsSection({
  orgId,
  role,
  parentOrgs,
  childOrgs,
  availableOrgs,
}: {
  orgId: string;
  role: string;
  parentOrgs: OrgShare[];
  childOrgs: OrgShare[];
  availableOrgs: OrgOption[];
}): React.JSX.Element {
  const [proposing, setProposing] = useState(false);
  const t = useTranslations("sharing.orgRelationships");
  const tc = useTranslations("common");

  const canManage = role === "owner" || role === "admin";

  const {
    pending: proposePending,
    serverError: proposeError,
    handleSubmit: handlePropose,
  } = useFormAction({
    action: proposeOrgShareAction,
    onSuccess: () => setProposing(false),
  });

  const hasAny = parentOrgs.length + childOrgs.length > 0;

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center gap-3">
        <Network size={20} className="text-accent" />
        <h2 className="text-lg font-semibold text-content">{t("title")}</h2>
      </div>

      {!hasAny && <p className="text-sm text-content-muted">{t("noRelationships")}</p>}

      {/* Parent orgs (this org is a child of these) */}
      {parentOrgs.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-content-muted mb-2">
            {t("parentOrgs")}
          </p>
          <ul className="space-y-2">
            {parentOrgs.map((s) => (
              <ParentOrgRow
                key={s.id}
                share={s}
                orgId={orgId}
                canManage={canManage}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Child orgs (this org is a parent to these) */}
      {childOrgs.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-content-muted mb-2">
            {t("childOrgs")}
          </p>
          <ul className="space-y-2">
            {childOrgs.map((s) => (
              <ChildOrgRow
                key={s.id}
                share={s}
                orgId={orgId}
                canManage={canManage}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Propose new link */}
      {canManage && availableOrgs.length > 0 && (
        <div>
          {proposing ? (
            <form
              action={handlePropose}
              className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3"
            >
              <input type="hidden" name="parent_org_id" value={orgId} />
              {proposeError && (
                <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
                  {proposeError}
                </p>
              )}
              <div>
                <label className={labelClass}>{t("childOrgs")} *</label>
                <select
                  name="child_org_id"
                  required
                  autoFocus
                  className={selectClass}
                  disabled={proposePending}
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
              <div>
                <label className={labelClass}>{t("sharingLevel")} *</label>
                <select
                  name="sharing_level"
                  required
                  className={selectClass}
                  disabled={proposePending}
                  defaultValue="clients_read"
                >
                  <option value="clients_read">
                    {t("levels.clients_read")}
                  </option>
                  <option value="clients_participate">
                    {t("levels.clients_participate")}
                  </option>
                </select>
              </div>
              <div className="flex gap-2">
                <SubmitButton
                  label={t("propose")}
                  pending={proposePending}
                  icon={Plus}
                />
                <button
                  type="button"
                  onClick={() => setProposing(false)}
                  disabled={proposePending}
                  className={buttonSecondaryClass}
                >
                  {tc("actions.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setProposing(true)}
              className={buttonPrimaryClass}
            >
              <Plus size={16} />
              {t("propose")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ParentOrgRow({
  share,
  orgId,
  canManage,
}: {
  share: OrgShare;
  orgId: string;
  canManage: boolean;
}): React.JSX.Element {
  const t = useTranslations("sharing.orgRelationships");
  const pending_ = share.accepted_at === null;

  const {
    pending: acceptPending,
    serverError: acceptError,
    handleSubmit: handleAccept,
  } = useFormAction({ action: acceptOrgShareAction });

  const {
    pending: removePending,
    serverError: removeError,
    handleSubmit: handleRemove,
  } = useFormAction({ action: removeOrgShareAction });

  const orgName = getOrgName(share.organizations);

  return (
    <li className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 size={16} className="text-content-muted" />
          <div>
            <p className="text-sm font-medium text-content">{orgName}</p>
            <p className="text-xs text-content-muted">
              {t(
                `levels.${share.sharing_level as "clients_read" | "clients_participate"}`,
              )}
            </p>
          </div>
          {pending_ && (
            <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
              {t("pending")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {pending_ && canManage && (
            <form action={handleAccept}>
              <input type="hidden" name="share_id" value={share.id} />
              <input type="hidden" name="org_id" value={orgId} />
              <SubmitButton
                label={t("accept")}
                pending={acceptPending}
                icon={Check}
                className={buttonSecondaryClass}
              />
            </form>
          )}
          {canManage && (
            <form action={handleRemove}>
              <input type="hidden" name="share_id" value={share.id} />
              <input type="hidden" name="org_id" value={orgId} />
              <button
                type="submit"
                disabled={removePending}
                className={buttonGhostClass}
              >
                <X size={14} />
              </button>
            </form>
          )}
        </div>
      </div>
      {pending_ && (
        <p className="mt-1 text-xs text-content-muted">{t("pendingParent")}</p>
      )}
      {(acceptError || removeError) && (
        <p className="mt-2 text-xs text-error">{acceptError || removeError}</p>
      )}
    </li>
  );
}

function ChildOrgRow({
  share,
  orgId,
  canManage,
}: {
  share: OrgShare;
  orgId: string;
  canManage: boolean;
}): React.JSX.Element {
  const t = useTranslations("sharing.orgRelationships");
  const pending_ = share.accepted_at === null;

  const {
    pending: removePending,
    serverError: removeError,
    handleSubmit: handleRemove,
  } = useFormAction({ action: removeOrgShareAction });

  const orgName = getOrgName(share.organizations);

  return (
    <li className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 size={16} className="text-content-muted" />
          <div>
            <p className="text-sm font-medium text-content">{orgName}</p>
            <p className="text-xs text-content-muted">
              {t(
                `levels.${share.sharing_level as "clients_read" | "clients_participate"}`,
              )}
            </p>
          </div>
          {pending_ && (
            <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
              {t("pending")}
            </span>
          )}
        </div>
        {canManage && (
          <form action={handleRemove}>
            <input type="hidden" name="share_id" value={share.id} />
            <input type="hidden" name="org_id" value={orgId} />
            <button
              type="submit"
              disabled={removePending}
              className={buttonGhostClass}
            >
              <X size={14} />
            </button>
          </form>
        )}
      </div>
      {pending_ && (
        <p className="mt-1 text-xs text-content-muted">{t("pendingChild")}</p>
      )}
      {removeError && <p className="mt-2 text-xs text-error">{removeError}</p>}
    </li>
  );
}
