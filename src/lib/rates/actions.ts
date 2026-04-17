"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";

/**
 * Rate-permission server actions.
 *
 * These control who can change `rate_visibility` and `rate_editability`
 * on the four rate-bearing objects (team_settings, projects, customers,
 * team_members). That authority is owner-only by default; owners may
 * delegate to admins via `toggleRatePermissionDelegationAction`.
 *
 * Changing the rate VALUE is a separate concern (Phase 2c:
 * setProjectRateAction, setCustomerRateAction, setTeamRateAction,
 * setMemberRateAction), gated by the rate_editability column.
 */

type ObjectType = "team" | "project" | "customer" | "member";
const THREE_LEVEL = new Set(["owner", "admins", "all_members"]);
const FOUR_LEVEL = new Set(["owner", "admins", "self", "all_members"]);

async function resolveTeamIdForObject(
  supabase: SupabaseClient,
  objectType: ObjectType,
  objectId: string,
): Promise<string> {
  if (objectType === "team") return objectId;
  const table =
    objectType === "project"
      ? "projects"
      : objectType === "customer"
        ? "customers"
        : "team_members";
  const { data } = await supabase
    .from(table)
    .select("team_id")
    .eq("id", objectId)
    .single();
  const teamId = (data as { team_id?: string } | null)?.team_id;
  if (!teamId) {
    throw new Error(`Object ${objectType}:${objectId} not found.`);
  }
  return teamId;
}

function targetTableFor(objectType: ObjectType): string {
  switch (objectType) {
    case "team":
      return "team_settings";
    case "project":
      return "projects";
    case "customer":
      return "customers";
    case "member":
      return "team_members";
  }
}

function idColumnFor(objectType: ObjectType): string {
  return objectType === "team" ? "team_id" : "id";
}

function validateLevel(objectType: ObjectType, level: string): void {
  const allowed = objectType === "member" ? FOUR_LEVEL : THREE_LEVEL;
  if (!allowed.has(level)) {
    throw new Error(
      `Invalid level "${level}" for ${objectType}. Allowed: ${Array.from(
        allowed,
      ).join(", ")}.`,
    );
  }
}

/**
 * Toggle the team's delegation flag. Owner-only — admins cannot grant
 * themselves permission-setting power.
 *
 * FormData: team_id, enabled ("true" | "false")
 */
export async function toggleRatePermissionDelegationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    if (!teamId) throw new Error("team_id is required.");

    const { role } = await validateTeamAccess(teamId);
    if (role !== "owner") {
      throw new Error(
        "Only the owner can delegate rate-permission authority.",
      );
    }

    const enabled = (formData.get("enabled") as string) === "true";

    assertSupabaseOk(
      await supabase
        .from("team_settings")
        .upsert({
          team_id: teamId,
          admins_can_set_rate_permissions: enabled,
        }),
    );

    revalidatePath(`/teams/${teamId}`);
  }, "toggleRatePermissionDelegationAction") as unknown as void;
}

/**
 * Set rate_visibility on an object.
 *
 * FormData: object_type (team|project|customer|member), object_id, level
 */
export async function setRateVisibilityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const objectType = formData.get("object_type") as ObjectType;
    const objectId = formData.get("object_id") as string;
    const level = formData.get("level") as string;
    if (!objectType || !objectId || !level) {
      throw new Error("object_type, object_id, and level are required.");
    }
    validateLevel(objectType, level);

    const teamId = await resolveTeamIdForObject(supabase, objectType, objectId);

    const { data: canSet } = await supabase.rpc("can_set_rate_permissions", {
      p_team_id: teamId,
    });
    if (!canSet) {
      throw new Error(
        "Not authorized to change rate permissions on this team.",
      );
    }

    assertSupabaseOk(
      await supabase
        .from(targetTableFor(objectType))
        .update({ rate_visibility: level })
        .eq(idColumnFor(objectType), objectId),
    );

    revalidatePath(`/teams/${teamId}`);
  }, "setRateVisibilityAction") as unknown as void;
}

/**
 * Set rate_editability on an object. Same gating as visibility.
 *
 * FormData: object_type, object_id, level
 */
export async function setRateEditabilityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const objectType = formData.get("object_type") as ObjectType;
    const objectId = formData.get("object_id") as string;
    const level = formData.get("level") as string;
    if (!objectType || !objectId || !level) {
      throw new Error("object_type, object_id, and level are required.");
    }
    validateLevel(objectType, level);

    const teamId = await resolveTeamIdForObject(supabase, objectType, objectId);

    const { data: canSet } = await supabase.rpc("can_set_rate_permissions", {
      p_team_id: teamId,
    });
    if (!canSet) {
      throw new Error(
        "Not authorized to change rate permissions on this team.",
      );
    }

    assertSupabaseOk(
      await supabase
        .from(targetTableFor(objectType))
        .update({ rate_editability: level })
        .eq(idColumnFor(objectType), objectId),
    );

    revalidatePath(`/teams/${teamId}`);
  }, "setRateEditabilityAction") as unknown as void;
}
