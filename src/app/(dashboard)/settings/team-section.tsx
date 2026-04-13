"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Users,
  UserPlus,
  Building2,
  Crown,
  ShieldCheck,
  User,
  X,
  Clock,
  Mail,
  AlertTriangle,
  LogOut,
  Trash2,
} from "lucide-react";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDangerClass,
} from "@/lib/form-styles";
import {
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  updateOrgNameAction,
} from "./team-actions";
import { leaveOrgAction, deleteOrgAction } from "../organizations/actions";

interface Member {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  user_profiles: { display_name: string | null }[] | { display_name: string | null } | null;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

interface TeamSectionProps {
  orgName: string;
  orgId: string;
  isPersonalOrg: boolean;
  currentRole: string;
  currentUserId: string;
  members: Member[];
  invites: Invite[];
}

const ROLE_ICONS: Record<string, typeof Crown> = {
  owner: Crown,
  admin: ShieldCheck,
  member: User,
};

const ROLE_COLORS: Record<string, string> = {
  owner: "text-warning bg-warning-soft",
  admin: "text-accent bg-accent-soft",
  member: "text-content-muted bg-surface-inset",
};

export function TeamSection({
  orgName,
  orgId,
  isPersonalOrg,
  currentRole,
  currentUserId,
  members,
  invites,
}: TeamSectionProps): React.JSX.Element {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const tc = useTranslations("common");
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  return (
    <div className="mt-8 space-y-6">
      {/* Organization name */}
      {currentRole === "owner" && (
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              Organization
            </h2>
          </div>
          <form action={updateOrgNameAction} className="flex gap-3 items-end">
            <input type="hidden" name="org_id" value={orgId} />
            <div className="flex-1">
              <label className={labelClass}>Organization Name</label>
              <input
                name="org_name"
                required
                defaultValue={orgName}
                className={inputClass}
              />
            </div>
            <button type="submit" className={buttonSecondaryClass}>
              Rename
            </button>
          </form>
        </section>
      )}

      {/* Team members */}
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              Team Members
            </h2>
          </div>
          {isAdmin && (
            <button
              onClick={() => setInviteOpen(!inviteOpen)}
              className={buttonPrimaryClass}
            >
              <UserPlus size={16} />
              Invite
            </button>
          )}
        </div>

        {/* Invite form */}
        {inviteOpen && isAdmin && (
          <form
            action={async (formData) => {
              await inviteMemberAction(formData);
              setInviteOpen(false);
            }}
            className="flex gap-3 items-end border-b border-edge pb-4 mb-4 flex-wrap"
          >
            <input type="hidden" name="org_id" value={orgId} />
            <div className="flex-1">
              <label className={labelClass}>Email</label>
              <input
                name="email"
                type="email"
                required
                placeholder="colleague@example.com"
                className={inputClass}
              />
            </div>
            <div className="w-32">
              <label className={labelClass}>Role</label>
              <select name="role" className={selectClass}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button type="submit" className={buttonPrimaryClass}>
              <Mail size={16} />
              Send
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className={buttonSecondaryClass}
            >
              {tc("actions.cancel")}
            </button>
          </form>
        )}

        {/* Members list */}
        <ul className="space-y-2">
          {members.map((member) => {
            const RoleIcon = ROLE_ICONS[member.role] ?? User;
            const roleColor = ROLE_COLORS[member.role] ?? ROLE_COLORS.member;
            const isSelf = member.user_id === currentUserId;
            const profileRaw = member.user_profiles;
            const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
            const displayName = profile && typeof profile === "object" && "display_name" in profile
              ? (profile as { display_name: string | null }).display_name
              : null;

            return (
              <li
                key={member.id}
                className="flex items-center justify-between rounded-lg border border-edge px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${roleColor}`}
                  >
                    <RoleIcon size={14} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-content">
                      {displayName ?? member.user_id.slice(0, 8) + "..."}
                      {isSelf && (
                        <span className="ml-2 text-xs text-content-muted">
                          (you)
                        </span>
                      )}
                    </p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${roleColor}`}
                    >
                      <RoleIcon size={10} />
                      {member.role}
                    </span>
                  </div>
                </div>
                {isAdmin && !isSelf && member.role !== "owner" && (
                  <form action={removeMemberAction}>
                    <input type="hidden" name="org_id" value={orgId} />
                    <input type="hidden" name="member_id" value={member.id} />
                    <input
                      type="hidden"
                      name="member_user_id"
                      value={member.user_id}
                    />
                    <button
                      type="submit"
                      className={buttonDangerClass}
                      onClick={(e) => {
                        if (!confirm("Remove this member?")) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <X size={14} />
                      Remove
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="mt-4 pt-4 border-t border-edge">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-content-muted mb-2">
              Pending Invites
            </h3>
            <ul className="space-y-2">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center justify-between rounded-lg border border-edge border-dashed px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-inset">
                      <Clock size={14} className="text-content-muted" />
                    </div>
                    <div>
                      <p className="text-sm text-content">{invite.email}</p>
                      <p className="text-xs text-content-muted">
                        {invite.role} · expires{" "}
                        {new Date(invite.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {isAdmin && (
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="org_id" value={orgId} />
                      <input
                        type="hidden"
                        name="invite_id"
                        value={invite.id}
                      />
                      <button type="submit" className={buttonDangerClass}>
                        <X size={14} />
                        Revoke
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Danger Zone: Leave / Delete Org */}
      {!isPersonalOrg && (
        <section className="rounded-lg border border-error/30 bg-surface-raised p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={18} className="text-error" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-error">
              {tc("org.dangerZone")}
            </h2>
          </div>

          {/* Leave org (non-owners, or owners with multiple owners) */}
          {currentRole !== "owner" && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-content">
                  {tc("org.leave")}
                </p>
                <p className="text-xs text-content-muted">
                  You will lose access to all data in this organization.
                </p>
              </div>
              <form action={leaveOrgAction}>
                <input type="hidden" name="org_id" value={orgId} />
                <button
                  type="submit"
                  className={buttonDangerClass}
                  onClick={(e) => {
                    if (!confirm(tc("org.leaveConfirm", { name: orgName }))) {
                      e.preventDefault();
                    }
                  }}
                >
                  <LogOut size={16} />
                  {tc("org.leave")}
                </button>
              </form>
            </div>
          )}

          {/* Delete org (owners only) */}
          {currentRole === "owner" && (
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-content">
                    {tc("org.delete")}
                  </p>
                  <p className="text-xs text-content-muted">
                    This will permanently delete all data, members, and settings.
                  </p>
                </div>
                <button
                  onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
                  className={buttonDangerClass}
                >
                  <Trash2 size={16} />
                  {tc("org.delete")}
                </button>
              </div>

              {showDeleteConfirm && (
                <form
                  action={deleteOrgAction}
                  className="mt-3 rounded-lg border border-error/30 bg-error-soft p-4 space-y-3"
                >
                  <input type="hidden" name="org_id" value={orgId} />
                  <p className="text-sm text-content">
                    {tc("org.deleteConfirm", { name: orgName })}
                  </p>
                  <input
                    name="confirm_name"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={orgName}
                    className={inputClass}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={deleteConfirmName !== orgName}
                      className={`${buttonDangerClass} disabled:opacity-30`}
                    >
                      <Trash2 size={14} />
                      Permanently Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteConfirmName("");
                      }}
                      className={buttonSecondaryClass}
                    >
                      {tc("actions.cancel")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
