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
    const rateStr = formData.get("default_rate") as string;
    const default_rate = rateStr ? parseFloat(rateStr) : 0;
    const invoice_prefix = (formData.get("invoice_prefix") as string) || "INV";
    const numStr = formData.get("invoice_next_num") as string;
    const invoice_next_num = numStr ? parseInt(numStr, 10) : 1;
    const taxStr = formData.get("tax_rate") as string;
    const tax_rate = taxStr ? parseFloat(taxStr) : 0;

    assertSupabaseOk(
      await supabase
        .from("team_settings")
        .upsert({
          team_id: teamId,
          business_name,
          business_email,
          business_address,
          business_phone,
          default_rate,
          invoice_prefix,
          invoice_next_num,
          tax_rate,
        })
    );

    revalidatePath(`/teams/${teamId}`);
  }, "updateTeamSettingsAction") as unknown as void;
}
