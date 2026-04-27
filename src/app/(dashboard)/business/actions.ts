"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateBusinessAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { ALLOWED_ENTITY_TYPES } from "./allow-lists";

function blankToNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Update business identity on the businesses table. Authorization
 * runs through `validateBusinessAccess` which checks the highest
 * role the caller holds across all teams in the business — the
 * businesses_update RLS policy enforces the same at the DB layer,
 * this gives a friendlier error message.
 */
export async function updateBusinessIdentityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = formData.get("business_id") as string;

    if (!businessId) {
      throw new Error("business_id is required.");
    }

    const { role } = await validateBusinessAccess(businessId);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can update business identity.");
    }

    const legal_name = blankToNull(formData.get("legal_name"));
    const entity_type = blankToNull(formData.get("entity_type"));
    const tax_id = blankToNull(formData.get("tax_id"));
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
      await supabase
        .from("businesses")
        .update({
          legal_name,
          entity_type,
          tax_id,
          date_incorporated,
          fiscal_year_start,
        })
        .eq("id", businessId),
    );

    revalidatePath("/business");
    revalidatePath(`/business/${businessId}`);
  }, "updateBusinessIdentityAction") as unknown as void;
}
