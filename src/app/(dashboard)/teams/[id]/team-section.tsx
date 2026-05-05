"use client";

import { useState, useTransition } from "react";
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
import { AlertBanner, formatDate } from "@theshyre/ui";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDangerClass,
} from "@/lib/form-styles";
import { isTeamAdmin, type TeamRole } from "@/lib/team-roles";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { useToast } from "@/components/Toast";
import {
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  transferOwnershipAction,
  updateMemberRoleAction,
  updateTeamNameAction,
} from "./team-actions";
import { leaveTeamAction, deleteTeamAction } from "../actions";

interface Member {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  /** Shell accounts are imported anchors for historical time entries
   *  — real auth.users rows that can't sign in. Set true when
   *  user_profiles.is_shell is true. UIs render them distinctly and
   *  exclude them from invite suggestions / rename actions. */
  is_shell?: boolean;
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
  teamName: string;
  teamId: string;
  isPersonalOrg: boolean;
  currentRole: TeamRole;
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
  teamName,
  teamId,
  isPersonalOrg,
  currentRole,
  currentUserId,
  members,
  invites,
}: TeamSectionProps): React.JSX.Element {
  const [inviteOpen, setInviteOpen] = useState(false);
  const tc = useTranslations("common");
  const toast = useToast();
  const [, startTransition] = useTransition();
  const isAdmin = isTeamAdmin(currentRole);

  const removeMember = (memberId: string, memberUserId: string): void => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("team_id", teamId);
      fd.set("member_id", memberId);
      fd.set("member_user_id", memberUserId);
      try {
        await removeMemberAction(fd);
      } catch (err) {
        const isRedirect =
          err instanceof Error && err.message.includes("NEXT_REDIRECT");
        if (isRedirect) throw err;
        toast.push({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Couldn't remove member.",
        });
      }
    });
  };

  const updateRole = (memberId: string, newRole: "admin" | "member"): void => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("team_id", teamId);
      fd.set("member_id", memberId);
      fd.set("new_role", newRole);
      try {
        await updateMemberRoleAction(fd);
        toast.push({ kind: "success", message: "Role updated." });
      } catch (err) {
        const isRedirect =
          err instanceof Error && err.message.includes("NEXT_REDIRECT");
        if (isRedirect) throw err;
        toast.push({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Couldn't update role.",
        });
      }
    });
  };

  // A team without an owner is a data-integrity issue — every team
  // should have exactly one. Surface it so ownership-transfer flows
  // don't silently operate on broken state.
  const hasOwner = members.some((m) => m.role === "owner");

  return (
    <div className="mt-8 space-y-6">
      {/* Team name */}
      {currentRole === "owner" && (
        <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={18} className="text-accent" />
            <h2 className="text-body-lg font-semibold uppercase tracking-wider text-content-muted">
              Team
            </h2>
          </div>
          <form action={updateTeamNameAction} className="flex gap-3 items-end">
            <input type="hidden" name="team_id" value={teamId} />
            <div className="flex-1">
              <label className={labelClass}>Team Name</label>
              <input
                name="team_name"
                required
                defaultValue={teamName}
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
            <h2 className="text-body-lg font-semibold uppercase tracking-wider text-content-muted">
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
            <input type="hidden" name="team_id" value={teamId} />
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

        {/* No-owner warning: should never happen in healthy data, but if
            the trigger failed or an owner was removed manually, surface it. */}
        {!hasOwner && (
          <div className="flex items-start gap-2 rounded-lg border border-error/40 bg-error-soft px-3 py-2 text-body text-error">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              This team has no owner. Contact support — transferring
              ownership is blocked until this is resolved.
            </span>
          </div>
        )}

        {/* Members list */}
        <ul className="space-y-2">
          {members.map((member) => {
            const RoleIcon = ROLE_ICONS[member.role] ?? User;
            const roleColor = ROLE_COLORS[member.role] ?? ROLE_COLORS.member;
            const isSelf = member.user_id === currentUserId;
            const isOwner = member.role === "owner";
            const profileRaw = member.user_profiles;
            const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
            const displayName = profile && typeof profile === "object" && "display_name" in profile
              ? (profile as { display_name: string | null }).display_name
              : null;

            return (
              <li
                key={member.id}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                  isOwner ? "border-warning/40 bg-warning-soft/30" : "border-edge"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${roleColor}`}
                  >
                    <RoleIcon size={14} />
                  </div>
                  <div>
                    <p className="text-body-lg font-medium text-content">
                      {displayName ?? member.user_id.slice(0, 8) + "..."}
                      {isSelf && (
                        <span className="ml-2 text-caption text-content-muted">
                          (you)
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${roleColor}`}
                      >
                        <RoleIcon size={10} />
                        {isOwner ? "Team owner" : member.role}
                      </span>
                      {member.is_shell && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-[10px] font-medium text-content-muted border border-edge-muted">
                          Imported · no login
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {isAdmin && !isSelf && member.role !== "owner" && (
                  <div className="flex items-center gap-2">
                    {/* Role flip. Owner can promote and demote; admins
                        can only demote other admins (the RPC enforces
                        the asymmetry — promote-to-admin is owner-only).
                        Hidden when the only valid transition would be
                        forbidden, so a non-owner viewing a `member`
                        sees no dropdown at all. */}
                    {(currentRole === "owner" ||
                      member.role === "admin") && (
                      <label className="sr-only" htmlFor={`role-${member.id}`}>
                        Change role for {displayName ?? "member"}
                      </label>
                    )}
                    {(currentRole === "owner" ||
                      member.role === "admin") && (
                      <select
                        id={`role-${member.id}`}
                        value={member.role}
                        onChange={(e) =>
                          updateRole(
                            member.id,
                            e.target.value as "admin" | "member",
                          )
                        }
                        className={selectClass}
                        aria-label={`Role: ${member.role}`}
                      >
                        {/* Owner sees both options; admin viewing
                            another admin sees only "member" (demote)
                            because they can't keep the row at admin
                            without re-promoting. */}
                        {currentRole === "owner" && (
                          <option value="admin">admin</option>
                        )}
                        {currentRole !== "owner" &&
                          member.role === "admin" && (
                            <option value="admin">admin</option>
                          )}
                        <option value="member">member</option>
                      </select>
                    )}
                    <InlineDeleteRowConfirm
                      ariaLabel={`Remove ${displayName ?? "member"}`}
                      onConfirm={() => removeMember(member.id, member.user_id)}
                      summary={displayName ?? member.user_id.slice(0, 8)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="mt-4 pt-4 border-t border-edge">
            <h3 className="text-caption font-semibold uppercase tracking-wider text-content-muted mb-2">
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
                      <p className="text-body-lg text-content">{invite.email}</p>
                      <p className="text-caption text-content-muted">
                        {invite.role} · expires{" "}
                        {formatDate(invite.expires_at)}
                      </p>
                    </div>
                  </div>
                  {isAdmin && (
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="team_id" value={teamId} />
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
            <h2 className="text-body-lg font-semibold uppercase tracking-wider text-error">
              {tc("team.dangerZone")}
            </h2>
          </div>

          {/* Leave org (non-owners, or owners with multiple owners) */}
          {currentRole !== "owner" && (
            <LeaveTeamFlow teamId={teamId} teamName={teamName} />
          )}

          {/* Transfer ownership (owners only). Sits ABOVE delete so a
              departing owner sees this safer option first. */}
          {currentRole === "owner" && (
            <TransferOwnershipFlow
              teamId={teamId}
              members={members}
              currentUserId={currentUserId}
            />
          )}

          {/* Delete org (owners only) */}
          {currentRole === "owner" && (
            <DeleteTeamFlow teamId={teamId} teamName={teamName} />
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Leave org with confirmation flow.
 * Hides original button when confirming.
 */
function LeaveTeamFlow({
  teamId,
  teamName,
}: {
  teamId: string;
  teamName: string;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const tc = useTranslations("common");
  const { pending, serverError, handleSubmit } = useFormAction({
    action: leaveTeamAction,
  });

  if (!confirming) {
    return (
      <div className="flex items-center justify-between">
        <div>
          <p className="text-body-lg font-medium text-content">{tc("team.leave")}</p>
          <p className="text-caption text-content-muted">
            You will lose access to all data in this team.
          </p>
        </div>
        <button
          onClick={() => setConfirming(true)}
          className={buttonDangerClass}
        >
          <LogOut size={16} />
          {tc("team.leave")}
        </button>
      </div>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="rounded-lg border border-error/30 bg-error-soft p-4 space-y-3"
    >
      <input type="hidden" name="team_id" value={teamId} />
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <p className="text-body-lg text-content">
        {tc("team.leaveConfirm", { name: teamName })}
      </p>
      <div className="flex gap-2">
        <SubmitButton
          label={tc("team.leave")}
          pending={pending}
          icon={LogOut}
          className="inline-flex items-center gap-2 rounded-lg bg-error px-4 py-2 text-body-lg font-medium text-content-inverse hover:opacity-90 disabled:opacity-50 transition-colors"
        />
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * Owner-only flow to hand the team off to another member. The owner
 * is demoted to admin atomically with the target's promotion to
 * owner — no transient zero-owner / two-owner state. Typed-name
 * confirmation matches the destructive-flow rubric.
 */
function TransferOwnershipFlow({
  teamId,
  members,
  currentUserId,
}: {
  teamId: string;
  members: Member[];
  currentUserId: string;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [newOwnerUserId, setNewOwnerUserId] = useState("");
  const [confirmName, setConfirmName] = useState("");

  // Eligible recipients: every member except the current owner and
  // shell accounts (which can't sign in to act on the team).
  const candidates = members.filter(
    (m) =>
      m.user_id !== currentUserId &&
      m.role !== "owner" &&
      !m.is_shell,
  );

  // Pull each candidate's display_name once so the confirm step can
  // compare typed input case-insensitively.
  function nameFor(m: Member): string {
    const profileRaw = m.user_profiles;
    const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
    return profile && typeof profile === "object" && "display_name" in profile
      ? ((profile as { display_name: string | null }).display_name ?? "")
      : "";
  }

  const target = candidates.find((m) => m.user_id === newOwnerUserId) ?? null;
  const expectedName = target ? nameFor(target) : "";
  const canSubmit =
    target !== null &&
    expectedName.length > 0 &&
    confirmName.trim().toLowerCase() === expectedName.trim().toLowerCase();

  function onSubmit(): void {
    if (!canSubmit || !target) return;
    setServerError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("team_id", teamId);
      fd.set("new_owner_user_id", target.user_id);
      fd.set("confirm_name", confirmName);
      try {
        await transferOwnershipAction(fd);
        // Action issues a redirect via revalidatePath; no toast
        // needed — the page re-renders with the new role.
      } catch (err) {
        const isRedirect =
          err instanceof Error && err.message.includes("NEXT_REDIRECT");
        if (isRedirect) throw err;
        setServerError(
          err instanceof Error ? err.message : "Couldn't transfer ownership.",
        );
      }
    });
  }

  if (!confirming) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-body-lg font-medium text-content">Transfer ownership</p>
          <p className="text-caption text-content-muted">
            Hand the team off to another member. You become an admin.
          </p>
        </div>
        <button
          type="button"
          disabled={candidates.length === 0}
          onClick={() => setConfirming(true)}
          className={buttonDangerClass}
        >
          <Crown size={16} />
          Transfer
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft/30 p-4 space-y-3">
      {serverError && <AlertBanner tone="error">{serverError}</AlertBanner>}
      <p className="text-body-lg text-content">
        Pick the member who will become the new owner, then type their
        name to confirm. You will be demoted to admin in the same step.
      </p>
      <div>
        <label htmlFor="transfer-target" className={labelClass}>
          New owner
        </label>
        <select
          id="transfer-target"
          value={newOwnerUserId}
          onChange={(e) => {
            setNewOwnerUserId(e.target.value);
            setConfirmName("");
          }}
          className={selectClass}
        >
          <option value="">Pick a member…</option>
          {candidates.map((m) => (
            <option key={m.id} value={m.user_id}>
              {nameFor(m) || m.user_id.slice(0, 8) + "…"}
            </option>
          ))}
        </select>
      </div>
      {target && expectedName && (
        <div>
          <label htmlFor="transfer-confirm" className={labelClass}>
            Type <span className="font-mono">{expectedName}</span> to confirm
          </label>
          <input
            id="transfer-confirm"
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            className={inputClass}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setNewOwnerUserId("");
            setConfirmName("");
            setServerError(null);
          }}
          className={buttonSecondaryClass}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={buttonDangerClass}
        >
          <Crown size={16} />
          Transfer ownership
        </button>
      </div>
    </div>
  );
}

/**
 * Delete org with typed-name confirmation.
 * Hides original button when confirm form is shown.
 */
function DeleteTeamFlow({
  teamId,
  teamName,
}: {
  teamId: string;
  teamName: string;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState("");
  const tc = useTranslations("common");
  const { pending, serverError, handleSubmit } = useFormAction({
    action: deleteTeamAction,
  });

  if (!confirming) {
    return (
      <div className="flex items-center justify-between">
        <div>
          <p className="text-body-lg font-medium text-content">
            {tc("team.delete")}
          </p>
          <p className="text-caption text-content-muted">
            This will permanently delete all data, members, and settings.
          </p>
        </div>
        <button
          onClick={() => setConfirming(true)}
          className={buttonDangerClass}
        >
          <Trash2 size={16} />
          {tc("team.delete")}
        </button>
      </div>
    );
  }

  const canDelete = typedName === teamName && !pending;

  return (
    <form
      action={handleSubmit}
      className="rounded-lg border border-error/30 bg-error-soft p-4 space-y-3"
    >
      <input type="hidden" name="team_id" value={teamId} />
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <p className="text-body-lg text-content">
        {tc("team.deleteConfirm", { name: teamName })}
      </p>
      <input
        name="confirm_name"
        value={typedName}
        onChange={(e) => setTypedName(e.target.value)}
        placeholder={teamName}
        className={inputClass}
        autoFocus
        disabled={pending}
      />
      <div className="flex gap-2">
        <SubmitButton
          label="Permanently Delete"
          pending={pending}
          icon={Trash2}
          disabled={!canDelete}
          className="inline-flex items-center gap-2 rounded-lg bg-error px-4 py-2 text-body-lg font-medium text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        />
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setTypedName("");
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
