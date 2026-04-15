"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";

export async function createGroupAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const teamId = formData.get("team_id") as string;
    const { role } = await validateTeamAccess(teamId);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can create groups.");
    }

    const name = (formData.get("name") as string)?.trim();
    const description = (formData.get("description") as string) || null;
    if (!name) throw new Error("Group name is required.");

    assertSupabaseOk(
      await supabase.from("security_groups").insert({
        team_id: teamId,
        name,
        description,
        created_by: userId,
      })
    );
    revalidatePath("/security-groups");
  }, "createGroupAction") as unknown as void;
}

export async function deleteGroupAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const groupId = formData.get("group_id") as string;
    const teamId = formData.get("team_id") as string;
    const { role } = await validateTeamAccess(teamId);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can delete groups.");
    }

    const { error, count } = await supabase
      .from("security_groups")
      .delete({ count: "exact" })
      .eq("id", groupId)
      .eq("team_id", teamId);

    if (error) throw new Error(error.message);
    if (count === 0) throw new Error("Group not found or permission denied.");

    revalidatePath("/security-groups");
  }, "deleteGroupAction") as unknown as void;
}

export async function addGroupMemberAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const groupId = formData.get("group_id") as string;
    const memberUserId = formData.get("user_id") as string;

    // Verify caller has access to the group's org
    const { data: group, error: groupErr } = await supabase
      .from("security_groups")
      .select("team_id")
      .eq("id", groupId)
      .single();
    if (groupErr || !group) throw new Error("Group not found.");
    const { role } = await validateTeamAccess(group.team_id);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can add group members.");
    }

    assertSupabaseOk(
      await supabase.from("security_group_members").insert({
        group_id: groupId,
        user_id: memberUserId,
        added_by: userId,
      })
    );
    revalidatePath("/security-groups");
  }, "addGroupMemberAction") as unknown as void;
}

export async function removeGroupMemberAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const groupId = formData.get("group_id") as string;
    const memberUserId = formData.get("user_id") as string;

    const { data: group } = await supabase
      .from("security_groups")
      .select("team_id")
      .eq("id", groupId)
      .single();
    if (!group) throw new Error("Group not found.");
    const { role } = await validateTeamAccess(group.team_id);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can remove group members.");
    }

    const { error } = await supabase
      .from("security_group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", memberUserId);
    if (error) throw new Error(error.message);

    revalidatePath("/security-groups");
  }, "removeGroupMemberAction") as unknown as void;
}
