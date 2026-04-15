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
  proposeTeamShareAction,
  acceptTeamShareAction,
  removeTeamShareAction,
} from "./relationships-actions";

interface TeamShare {
  id: string;
  parent_team_id: string;
  child_team_id: string;
  sharing_level: string;
  accepted_at: string | null;
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

export function RelationshipsSection({
  teamId,
  role,
  parentTeams,
  childTeams,
  availableTeams,
}: {
  teamId: string;
  role: string;
  parentTeams: TeamShare[];
  childTeams: TeamShare[];
  availableTeams: TeamOption[];
}): React.JSX.Element {
  const [proposing, setProposing] = useState(false);
  const t = useTranslations("sharing.teamRelationships");
  const tc = useTranslations("common");

  const canManage = role === "owner" || role === "admin";

  const {
    pending: proposePending,
    serverError: proposeError,
    handleSubmit: handlePropose,
  } = useFormAction({
    action: proposeTeamShareAction,
    onSuccess: () => setProposing(false),
  });

  const hasAny = parentTeams.length + childTeams.length > 0;

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center gap-3">
        <Network size={20} className="text-accent" />
        <h2 className="text-lg font-semibold text-content">{t("title")}</h2>
      </div>

      {!hasAny && <p className="text-sm text-content-muted">{t("noRelationships")}</p>}

      {/* Parent teams (this org is a child of these) */}
      {parentTeams.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-content-muted mb-2">
            {t("parentTeams")}
          </p>
          <ul className="space-y-2">
            {parentTeams.map((s) => (
              <ParentTeamRow
                key={s.id}
                share={s}
                teamId={teamId}
                canManage={canManage}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Child teams (this org is a parent to these) */}
      {childTeams.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-content-muted mb-2">
            {t("childTeams")}
          </p>
          <ul className="space-y-2">
            {childTeams.map((s) => (
              <ChildTeamRow
                key={s.id}
                share={s}
                teamId={teamId}
                canManage={canManage}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Propose new link */}
      {canManage && availableTeams.length > 0 && (
        <div>
          {proposing ? (
            <form
              action={handlePropose}
              className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3"
            >
              <input type="hidden" name="parent_team_id" value={teamId} />
              {proposeError && (
                <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
                  {proposeError}
                </p>
              )}
              <div>
                <label className={labelClass}>{t("childTeams")} *</label>
                <select
                  name="child_team_id"
                  required
                  autoFocus
                  className={selectClass}
                  disabled={proposePending}
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

function ParentTeamRow({
  share,
  teamId,
  canManage,
}: {
  share: TeamShare;
  teamId: string;
  canManage: boolean;
}): React.JSX.Element {
  const t = useTranslations("sharing.teamRelationships");
  const pending_ = share.accepted_at === null;

  const {
    pending: acceptPending,
    serverError: acceptError,
    handleSubmit: handleAccept,
  } = useFormAction({ action: acceptTeamShareAction });

  const {
    pending: removePending,
    serverError: removeError,
    handleSubmit: handleRemove,
  } = useFormAction({ action: removeTeamShareAction });

  const teamName = getTeamName(share.teams);

  return (
    <li className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 size={16} className="text-content-muted" />
          <div>
            <p className="text-sm font-medium text-content">{teamName}</p>
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
              <input type="hidden" name="team_id" value={teamId} />
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
              <input type="hidden" name="team_id" value={teamId} />
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

function ChildTeamRow({
  share,
  teamId,
  canManage,
}: {
  share: TeamShare;
  teamId: string;
  canManage: boolean;
}): React.JSX.Element {
  const t = useTranslations("sharing.teamRelationships");
  const pending_ = share.accepted_at === null;

  const {
    pending: removePending,
    serverError: removeError,
    handleSubmit: handleRemove,
  } = useFormAction({ action: removeTeamShareAction });

  const teamName = getTeamName(share.teams);

  return (
    <li className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 size={16} className="text-content-muted" />
          <div>
            <p className="text-sm font-medium text-content">{teamName}</p>
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
            <input type="hidden" name="team_id" value={teamId} />
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
