"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateBusinessAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ALLOWED_ENTITY_TYPES } from "./allow-lists";
import {
  mergeIdentityHistoryRows,
  type IdentityHistoryEntry,
  type RawBusinessHistoryRow,
  type RawRegistrationHistoryRow,
} from "./identity-history-types";

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

    // Display fields stay on businesses; sensitive identity goes to
    // the role-gated child table per SAL-012.
    assertSupabaseOk(
      await supabase
        .from("businesses")
        .update({ legal_name, entity_type })
        .eq("id", businessId),
    );

    assertSupabaseOk(
      await supabase
        .from("business_identity_private")
        .update({ tax_id, date_incorporated, fiscal_year_start })
        .eq("business_id", businessId),
    );

    revalidatePath("/business");
    revalidatePath(`/business/${businessId}`);
  }, "updateBusinessIdentityAction") as unknown as void;
}

/** Read the merged identity-change timeline for a business — every
 *  row in `businesses_history` and `business_state_registrations_history`
 *  for this business, sorted newest-first.
 *
 *  RLS gates per-row visibility: bh_select and bsrh_select both
 *  require owner|admin role on the business, so non-admins get an
 *  empty result rather than an error. */
export async function getBusinessIdentityHistoryAction(
  businessId: string,
  options?: { limit?: number; offset?: number },
): Promise<{ history: IdentityHistoryEntry[]; hasMore: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const limit = options?.limit ?? 200;
  const offset = options?.offset ?? 0;

  // Fan out — businesses + registrations history, both filtered to
  // this business. Pull `limit + 1` from each so the merged result
  // can decide whether to surface "load more" without a count query.
  const fetchSize = limit + 1;
  const [businessRes, privateRes, regsRes] = await Promise.all([
    supabase
      .from("businesses_history")
      .select(
        "id, operation, changed_at, changed_by_user_id, previous_state",
      )
      .eq("business_id", businessId)
      .order("changed_at", { ascending: false })
      .range(0, fetchSize - 1),
    supabase
      .from("business_identity_private_history")
      .select(
        "id, operation, changed_at, changed_by_user_id, previous_state",
      )
      .eq("business_id", businessId)
      .order("changed_at", { ascending: false })
      .range(0, fetchSize - 1),
    supabase
      .from("business_state_registrations_history")
      .select(
        "id, registration_id, operation, changed_at, changed_by_user_id, previous_state",
      )
      .eq("business_id", businessId)
      .order("changed_at", { ascending: false })
      .range(0, fetchSize - 1),
  ]);
  if (businessRes.error) throw businessRes.error;
  if (privateRes.error) throw privateRes.error;
  if (regsRes.error) throw regsRes.error;

  // Resolve a label for the live business row (legal_name) so
  // entries can show "Acme LLC — entity_type changed".
  const { data: liveBiz } = await supabase
    .from("businesses")
    .select("legal_name")
    .eq("id", businessId)
    .maybeSingle();
  const liveBusinessName =
    (liveBiz?.legal_name as string | null) ?? "Business";

  const merged = mergeIdentityHistoryRows({
    businessRows: (businessRes.data ?? []) as RawBusinessHistoryRow[],
    privateRows: (privateRes.data ?? []) as RawBusinessHistoryRow[],
    registrationRows: (regsRes.data ?? []) as RawRegistrationHistoryRow[],
    liveBusinessName,
  });
  const trimmed = merged.slice(offset, offset + limit);
  const hasMore = merged.length > offset + limit;

  // Bulk lookup actor display names across both tables.
  const actorIds = Array.from(
    new Set(
      trimmed
        .map((e) => e.changedBy.userId)
        .filter((id): id is string => id !== null),
    ),
  );
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", actorIds);
    const nameById = new Map<string, string | null>();
    for (const p of profiles ?? []) {
      nameById.set(
        p.user_id as string,
        (p.display_name as string | null) ?? null,
      );
    }
    for (const e of trimmed) {
      if (e.changedBy.userId) {
        e.changedBy.displayName =
          nameById.get(e.changedBy.userId) ?? null;
      }
    }
  }

  return { history: trimmed, hasMore };
}
