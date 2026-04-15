"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  UserPlus,
  X,
} from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  labelClass,
  textareaClass,
  selectClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
} from "@/lib/form-styles";
import type { TeamListItem } from "@/lib/team-context";
import {
  createGroupAction,
  deleteGroupAction,
  addGroupMemberAction,
  removeGroupMemberAction,
} from "./actions";

interface Group {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface GroupMember {
  group_id: string;
  user_id: string;
  user_profiles:
    | { display_name: string | null }[]
    | { display_name: string | null }
    | null;
}

interface TeamMember {
  team_id: string;
  user_id: string;
  user_profiles:
    | { display_name: string | null }[]
    | { display_name: string | null }
    | null;
}

function getDisplayName(
  profile:
    | { display_name: string | null }[]
    | { display_name: string | null }
    | null,
): string | null {
  const p = Array.isArray(profile) ? profile[0] : profile;
  return p?.display_name ?? null;
}

export function SecurityGroupsSection({
  teams,
  groups,
  groupMembers,
  teamMembers,
}: {
  teams: TeamListItem[];
  groups: Group[];
  groupMembers: GroupMember[];
  teamMembers: TeamMember[];
}): React.JSX.Element {
  const [creating, setCreating] = useState(false);
  const t = useTranslations("sharing.securityGroups");
  const tc = useTranslations("common");

  const { pending, serverError, handleSubmit } = useFormAction({
    action: createGroupAction,
    onSuccess: () => setCreating(false),
  });

  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => setCreating(true), []),
    enabled: !creating,
  });

  const teamNameById = new Map(teams.map((o) => [o.id, o.name]));

  const membersByGroup = new Map<string, GroupMember[]>();
  for (const m of groupMembers) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m);
    membersByGroup.set(m.group_id, list);
  }

  return (
    <div className="mt-6 space-y-4">
      {creating ? (
        <form
          action={handleSubmit}
          className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3"
        >
          {serverError && (
            <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
              {serverError}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>{t("fields.name")} *</label>
              <input
                name="name"
                required
                autoFocus
                className={inputClass}
                disabled={pending}
              />
            </div>
            <div>
              <label className={labelClass}>{t("fields.team")} *</label>
              <select
                name="team_id"
                required
                className={selectClass}
                disabled={pending || teams.length === 1}
                defaultValue={teams[0]?.id ?? ""}
              >
                {teams.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>{t("fields.description")}</label>
            <textarea
              name="description"
              rows={2}
              className={textareaClass}
              disabled={pending}
            />
          </div>
          <div className="flex gap-2">
            <SubmitButton
              label={t("create")}
              pending={pending}
              icon={ShieldCheck}
            />
            <button
              type="button"
              onClick={() => setCreating(false)}
              disabled={pending}
              className={buttonSecondaryClass}
            >
              {tc("actions.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className={buttonPrimaryClass}
        >
          <Plus size={16} />
          {t("create")}
          <kbd className={kbdClass}>N</kbd>
        </button>
      )}

      {groups.length === 0 && !creating ? (
        <p className="text-sm text-content-muted">{t("noGroups")}</p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const members = membersByGroup.get(group.id) ?? [];
            const teamName = teamNameById.get(group.team_id) ?? "—";
            return (
              <GroupCard
                key={group.id}
                group={group}
                teamName={teamName}
                members={members}
                teamMembers={teamMembers.filter(
                  (m) => m.team_id === group.team_id,
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  teamName,
  members,
  teamMembers,
}: {
  group: Group;
  teamName: string;
  members: GroupMember[];
  teamMembers: TeamMember[];
}): React.JSX.Element {
  const [addingMember, setAddingMember] = useState(false);
  const t = useTranslations("sharing.securityGroups");
  const tc = useTranslations("common");

  const {
    pending: deletePending,
    serverError: deleteError,
    handleSubmit: handleDelete,
  } = useFormAction({ action: deleteGroupAction });

  const {
    pending: addPending,
    serverError: addError,
    handleSubmit: handleAdd,
  } = useFormAction({
    action: addGroupMemberAction,
    onSuccess: () => setAddingMember(false),
  });

  const memberUserIds = new Set(members.map((m) => m.user_id));
  const addableMembers = teamMembers.filter(
    (om) => !memberUserIds.has(om.user_id),
  );

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
            <ShieldCheck size={18} className="text-accent" />
          </div>
          <div>
            <p className="font-semibold text-content">{group.name}</p>
            <p className="text-xs text-content-muted">
              {teamName} · {t("memberCount", { count: members.length })}
            </p>
            {group.description && (
              <p className="text-sm text-content-secondary mt-1">
                {group.description}
              </p>
            )}
          </div>
        </div>
        <form action={handleDelete}>
          <input type="hidden" name="group_id" value={group.id} />
          <input
            type="hidden"
            name="team_id"
            value={group.team_id}
          />
          <button
            type="submit"
            disabled={deletePending}
            className={buttonGhostClass}
            onClick={(e) => {
              if (!confirm(t("confirmDelete"))) e.preventDefault();
            }}
          >
            <Trash2 size={14} />
          </button>
        </form>
      </div>

      {deleteError && (
        <p className="mt-2 text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {deleteError}
        </p>
      )}

      <div className="mt-3 border-t border-edge pt-3">
        {members.length > 0 ? (
          <ul className="space-y-1">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="flex items-center justify-between rounded px-2 py-1 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Users size={14} className="text-content-muted" />
                  <span className="text-content">
                    {getDisplayName(m.user_profiles) ??
                      m.user_id.slice(0, 8) + "..."}
                  </span>
                </span>
                <RemoveMemberButton
                  groupId={group.id}
                  userId={m.user_id}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-content-muted">{t("noMembers")}</p>
        )}

        {addingMember ? (
          <form action={handleAdd} className="mt-3 flex gap-2 items-end">
            <input type="hidden" name="group_id" value={group.id} />
            <div className="flex-1">
              <label className={labelClass}>{t("addMember")}</label>
              <select
                name="user_id"
                required
                autoFocus
                className={selectClass}
                disabled={addPending}
              >
                <option value="">—</option>
                {addableMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {getDisplayName(m.user_profiles) ??
                      m.user_id.slice(0, 8) + "..."}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton
              label={t("addMember")}
              pending={addPending}
              icon={UserPlus}
              className={buttonSecondaryClass}
            />
            <button
              type="button"
              onClick={() => setAddingMember(false)}
              disabled={addPending}
              className={buttonSecondaryClass}
            >
              {tc("actions.cancel")}
            </button>
          </form>
        ) : (
          addableMembers.length > 0 && (
            <button
              onClick={() => setAddingMember(true)}
              className={`${buttonGhostClass} mt-2 text-xs`}
            >
              <UserPlus size={12} />
              {t("addMember")}
            </button>
          )
        )}

        {addError && (
          <p className="mt-2 text-xs text-error">{addError}</p>
        )}
      </div>
    </div>
  );
}

function RemoveMemberButton({
  groupId,
  userId,
}: {
  groupId: string;
  userId: string;
}): React.JSX.Element {
  const { pending, handleSubmit } = useFormAction({
    action: removeGroupMemberAction,
  });

  return (
    <form action={handleSubmit}>
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="user_id" value={userId} />
      <button
        type="submit"
        disabled={pending}
        className="text-content-muted hover:text-error transition-colors p-1"
      >
        <X size={12} />
      </button>
    </form>
  );
}
