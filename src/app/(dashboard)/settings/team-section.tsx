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

interface Member {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
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
  currentRole,
  currentUserId,
  members,
  invites,
}: TeamSectionProps): React.JSX.Element {
  const [inviteOpen, setInviteOpen] = useState(false);
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
            className="flex gap-3 items-end border-b border-edge pb-4 mb-4"
          >
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
              Cancel
            </button>
          </form>
        )}

        {/* Members list */}
        <ul className="space-y-2">
          {members.map((member) => {
            const RoleIcon = ROLE_ICONS[member.role] ?? User;
            const roleColor = ROLE_COLORS[member.role] ?? ROLE_COLORS.member;
            const isSelf = member.user_id === currentUserId;
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
                      {member.user_id.slice(0, 8)}...
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
    </div>
  );
}
