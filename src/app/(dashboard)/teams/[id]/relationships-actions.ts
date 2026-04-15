"use server";

import { runSafeAction } from "@/lib/safe-action";
import { revalidatePath } from "next/cache";

export async function proposeTeamShareAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const parentTeamId = formData.get("parent_team_id") as string;
      const childTeamId = formData.get("child_team_id") as string;
      const sharingLevel = formData.get("sharing_level") as string;

      if (!parentTeamId) throw new Error("Parent team is required.");
      if (!childTeamId) throw new Error("Child team is required.");
      if (!sharingLevel) throw new Error("Sharing level is required.");

      const { error } = await supabase.rpc("propose_team_share", {
        p_parent_team_id: parentTeamId,
        p_child_team_id: childTeamId,
        p_sharing_level: sharingLevel,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/teams/${parentTeamId}`);
      revalidatePath(`/teams/${childTeamId}`);
    },
    "proposeTeamShareAction",
  ) as unknown as void;
}

export async function acceptTeamShareAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const shareId = formData.get("share_id") as string;
      const teamId = formData.get("org_id") as string;
      if (!shareId) throw new Error("Share ID is required.");

      const { error } = await supabase.rpc("accept_team_share", {
        p_share_id: shareId,
      });
      if (error) throw new Error(error.message);

      if (teamId) revalidatePath(`/teams/${teamId}`);
    },
    "acceptTeamShareAction",
  ) as unknown as void;
}

export async function removeTeamShareAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const shareId = formData.get("share_id") as string;
      const teamId = formData.get("org_id") as string;
      if (!shareId) throw new Error("Share ID is required.");

      const { error } = await supabase
        .from("team_shares")
        .delete()
        .eq("id", shareId);
      if (error) throw new Error(error.message);

      if (teamId) revalidatePath(`/teams/${teamId}`);
    },
    "removeTeamShareAction",
  ) as unknown as void;
}
