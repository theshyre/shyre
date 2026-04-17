"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { serializeAddress } from "@/lib/schemas/address";

/**
 * Org-admin actions only. Per-user actions (profile, preferences, integrations)
 * live in /profile/actions.ts.
 */

function extractAddress(formData: FormData, prefix: string): string | null {
  const address = {
    street: (formData.get(`${prefix}.street`) as string) || "",
    street2: (formData.get(`${prefix}.street2`) as string) || "",
    city: (formData.get(`${prefix}.city`) as string) || "",
    state: (formData.get(`${prefix}.state`) as string) || "",
    postalCode: (formData.get(`${prefix}.postalCode`) as string) || "",
    country: (formData.get(`${prefix}.country`) as string) || "",
  };
  return serializeAddress(address);
}

export async function updateTeamSettingsAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const { role } = await validateTeamAccess(teamId);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can update team settings.");
    }

    const business_name = (formData.get("business_name") as string) || null;
    const business_email = (formData.get("business_email") as string) || null;
    const business_address = extractAddress(formData, "business_address");
    const business_phone = (formData.get("business_phone") as string) || null;
    const invoice_prefix = (formData.get("invoice_prefix") as string) || "INV";
    const numStr = formData.get("invoice_next_num") as string;
    const invoice_next_num = numStr ? parseInt(numStr, 10) : 1;
    const taxStr = formData.get("tax_rate") as string;
    const tax_rate = taxStr ? parseFloat(taxStr) : 0;

    const patch: Record<string, unknown> = {
      team_id: teamId,
      business_name,
      business_email,
      business_address,
      business_phone,
      invoice_prefix,
      invoice_next_num,
      tax_rate,
    };

    // Guardrail: only include default_rate in the upsert if rate_editability
    // allows this caller. Role is already owner/admin here, but
    // rate_editability = 'owner' would block an admin from changing the
    // team's default rate. setTeamRateAction is the dedicated setter.
    if (formData.has("default_rate")) {
      const { data: canSet } = await supabase.rpc("can_set_team_rate", {
        p_team_id: teamId,
      });
      if (canSet) {
        const rateStr = formData.get("default_rate") as string;
        patch.default_rate = rateStr ? parseFloat(rateStr) : 0;
      }
    }

    assertSupabaseOk(
      await supabase.from("team_settings").upsert(patch),
    );

    revalidatePath(`/teams/${teamId}`);
  }, "updateTeamSettingsAction") as unknown as void;
}

export async function setTeamRateAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    if (!teamId) throw new Error("Team id is required.");

    const { data: canSet } = await supabase.rpc("can_set_team_rate", {
      p_team_id: teamId,
    });
    if (!canSet) {
      throw new Error("Not authorized to set this team's default rate.");
    }

    const rateStr = formData.get("default_rate") as string;
    const default_rate = rateStr ? parseFloat(rateStr) : 0;

    assertSupabaseOk(
      await supabase
        .from("team_settings")
        .upsert({ team_id: teamId, default_rate }),
    );

    revalidatePath(`/teams/${teamId}`);
  }, "setTeamRateAction") as unknown as void;
}
