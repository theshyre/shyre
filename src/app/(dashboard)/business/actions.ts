"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";

const ALLOWED_ENTITY_TYPES = new Set([
  "sole_prop",
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "nonprofit",
  "other",
]);

function blankToNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Update business identity on organization_settings (upsert).
 * Owner/admin only — matches updateTeamSettingsAction's authorization model.
 */
export async function updateBusinessIdentityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const { role } = await validateTeamAccess(teamId);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can update business identity.");
    }

    const legal_name = blankToNull(formData.get("legal_name"));
    const entity_type = blankToNull(formData.get("entity_type"));
    const tax_id = blankToNull(formData.get("tax_id"));
    const state_registration_id = blankToNull(
      formData.get("state_registration_id"),
    );
    const registered_state = blankToNull(formData.get("registered_state"));
    const date_incorporated = blankToNull(formData.get("date_incorporated"));
    const fiscal_year_start = blankToNull(formData.get("fiscal_year_start"));

    if (entity_type && !ALLOWED_ENTITY_TYPES.has(entity_type)) {
      throw new Error(`Invalid entity_type: ${entity_type}`);
    }
    if (
      fiscal_year_start &&
      !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(fiscal_year_start)
    ) {
      throw new Error("fiscal_year_start must be MM-DD");
    }

    assertSupabaseOk(
      await supabase.from("team_settings").upsert({
        team_id: teamId,
        legal_name,
        entity_type,
        tax_id,
        state_registration_id,
        registered_state,
        date_incorporated,
        fiscal_year_start,
      }),
    );

    revalidatePath("/business");
    revalidatePath("/business");
  }, "updateBusinessIdentityAction") as unknown as void;
}
