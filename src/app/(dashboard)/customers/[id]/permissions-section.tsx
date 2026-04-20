"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Plus, X, User, Users } from "lucide-react";
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
  grantPermissionAction,
  revokePermissionAction,
} from "./permissions-actions";

type PermissionLevel = "viewer" | "contributor" | "admin";
type PrincipalType = "user" | "group";

interface Permission {
  id: string;
  principal_type: PrincipalType;
  principal_id: string;
  permission_level: PermissionLevel;
  principal_name: string;
}

interface PrincipalOption {
  type: PrincipalType;
  id: string;
  name: string;
  teamName: string;
}

const LEVEL_BADGE: Record<PermissionLevel, string> = {
  admin:
    "inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning",
  contributor:
    "inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent",
  viewer:
    "inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-xs font-medium text-content-muted",
};

export function PermissionsSection({
  customerId,
  permissions,
  availablePrincipals,
  userCanAdmin,
}: {
  customerId: string;
  permissions: Permission[];
  availablePrincipals: PrincipalOption[];
  userCanAdmin: boolean;
}): React.JSX.Element {
  const [granting, setGranting] = useState(false);
  const t = useTranslations("sharing.clientSharing");
  const tc = useTranslations("common");

  const {
    pending: grantPending,
    serverError: grantError,
    handleSubmit: handleGrant,
  } = useFormAction({
    action: grantPermissionAction,
    onSuccess: () => setGranting(false),
  });

  const userPrincipals = availablePrincipals.filter((p) => p.type === "user");
  const groupPrincipals = availablePrincipals.filter(
    (p) => p.type === "group",
  );

  // Build a set of already-granted keys to filter available principals.
  const grantedKeys = new Set(
    permissions.map((p) => `${p.principal_type}:${p.principal_id}`),
  );
  const filterGranted = (list: PrincipalOption[]) =>
    list.filter((p) => !grantedKeys.has(`${p.type}:${p.id}`));

  const availableUsers = filterGranted(userPrincipals);
  const availableGroups = filterGranted(groupPrincipals);
  const hasAvailable = availableUsers.length + availableGroups.length > 0;

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center gap-3">
        <KeyRound size={20} className="text-accent" />
        <h2 className="text-lg font-semibold text-content">
          {t("permissions")}
        </h2>
      </div>

      {permissions.length === 0 ? (
        <p className="text-sm text-content-muted">{t("noPermissions")}</p>
      ) : (
        <ul className="space-y-2">
          {permissions.map((perm) => (
            <PermissionRow
              key={perm.id}
              perm={perm}
              customerId={customerId}
              userCanAdmin={userCanAdmin}
            />
          ))}
        </ul>
      )}

      {userCanAdmin && hasAvailable && (
        <div>
          {granting ? (
            <form
              action={handleGrant}
              className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3"
            >
              <input type="hidden" name="customer_id" value={customerId} />
              {grantError && (
                <AlertBanner tone="error">{grantError}</AlertBanner>
              )}
              <div>
                <label className={labelClass}>{t("principal")} *</label>
                <select
                  name="principal"
                  required
                  autoFocus
                  className={selectClass}
                  disabled={grantPending}
                  defaultValue=""
                >
                  <option value="">—</option>
                  {availableUsers.length > 0 && (
                    <optgroup label="Users">
                      {availableUsers.map((p) => (
                        <option key={`user:${p.id}`} value={`user:${p.id}`}>
                          {p.name} ({p.teamName})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {availableGroups.length > 0 && (
                    <optgroup label="Groups">
                      {availableGroups.map((p) => (
                        <option key={`group:${p.id}`} value={`group:${p.id}`}>
                          {p.name} ({p.teamName})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className={labelClass}>{t("permissionLevel")} *</label>
                <select
                  name="permission_level"
                  required
                  className={selectClass}
                  disabled={grantPending}
                  defaultValue="viewer"
                >
                  <option value="viewer">{t("levels.viewer")}</option>
                  <option value="contributor">
                    {t("levels.contributor")}
                  </option>
                  <option value="admin">{t("levels.admin")}</option>
                </select>
              </div>
              <div className="flex gap-2">
                <SubmitButton
                  label={t("grantPermission")}
                  pending={grantPending}
                  icon={Plus}
                />
                <button
                  type="button"
                  onClick={() => setGranting(false)}
                  disabled={grantPending}
                  className={buttonSecondaryClass}
                >
                  {tc("actions.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setGranting(true)}
              className={buttonPrimaryClass}
            >
              <Plus size={16} />
              {t("grantPermission")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PermissionRow({
  perm,
  customerId,
  userCanAdmin,
}: {
  perm: Permission;
  customerId: string;
  userCanAdmin: boolean;
}): React.JSX.Element {
  const t = useTranslations("sharing.clientSharing");

  const {
    pending,
    serverError,
    handleSubmit,
  } = useFormAction({ action: revokePermissionAction });

  const Icon = perm.principal_type === "group" ? Users : User;

  return (
    <li className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon size={16} className="text-content-muted" />
          <div>
            <p className="text-sm font-medium text-content">
              {perm.principal_name}
            </p>
            <p className="text-xs text-content-muted">
              {perm.principal_type === "group" ? "Group" : "User"}
            </p>
          </div>
          <span className={LEVEL_BADGE[perm.permission_level]}>
            {t(`levels.${perm.permission_level}`)}
          </span>
        </div>
        {userCanAdmin && (
          <form action={handleSubmit}>
            <input type="hidden" name="permission_id" value={perm.id} />
            <input type="hidden" name="customer_id" value={customerId} />
            <button
              type="submit"
              disabled={pending}
              className={buttonGhostClass}
              onClick={(e) => {
                if (!confirm(t("confirmRevoke"))) e.preventDefault();
              }}
            >
              <X size={14} />
              <span className="sr-only">{t("revoke")}</span>
            </button>
          </form>
        )}
      </div>
      {serverError && (
        <p className="mt-2 text-xs text-error">{serverError}</p>
      )}
    </li>
  );
}
