"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateBusinessAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ALLOWED_ENTITY_TYPES } from "./allow-lists";
import {
  isOwnerOfEveryTeam,
  ownsAnotherBusiness,
  expectedConfirmName,
} from "./delete-checks";
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

    // Only touch the private table when at least one of its fields
    // was actually edited. Bookkeeper finding #5: the
    // unconditional UPDATE generated a no-op
    // business_identity_private_history row on every save of
    // legal_name / entity_type, polluting the timeline with
    // phantom changes that diff to nothing.
    const { data: existingPrivate } = await supabase
      .from("business_identity_private")
      .select("tax_id, date_incorporated, fiscal_year_start")
      .eq("business_id", businessId)
      .maybeSingle();
    const privateChanged =
      !existingPrivate ||
      (existingPrivate.tax_id ?? null) !== tax_id ||
      (existingPrivate.date_incorporated ?? null) !== date_incorporated ||
      (existingPrivate.fiscal_year_start ?? null) !== fiscal_year_start;

    if (privateChanged) {
      assertSupabaseOk(
        await supabase
          .from("business_identity_private")
          .update({ tax_id, date_incorporated, fiscal_year_start })
          .eq("business_id", businessId),
      );
    }

    revalidatePath("/business");
    revalidatePath(`/business/${businessId}`);
  }, "updateBusinessIdentityAction") as unknown as void;
}

/**
 * Delete a business. Cascades through the business's children
 * (state registrations, identity_private, business_people, etc.)
 * via FK CASCADE, but `teams.business_id` is ON DELETE RESTRICT,
 * so every team under the business must be deleted first. We do
 * that here in a single action, after a typed-name confirmation.
 *
 * Refusal preconditions, in order:
 *   1. Caller must be `owner` of every team in the business — an
 *      admin on one team but member on another can't delete the
 *      whole business out from under them.
 *   2. Caller must own at least one OTHER business — refusing to
 *      orphan the actor mirrors deleteTeamAction's last-team
 *      check. Without this, deleting your last business strands
 *      you on /business with no way to create a new one (the
 *      "create business" flow goes through team creation).
 *
 * Confirmation: typed string must match `legal_name` if set,
 * otherwise the seeded `name`. Both come back from the same
 * select to avoid a round trip.
 */
export async function deleteBusinessAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = formData.get("business_id") as string;
    const confirmName = formData.get("confirm_name") as string;
    if (!businessId) throw new Error("business_id is required.");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // Pull business + every team in it + caller's role on each
    // team, in two queries. The role check is the strict gate
    // (owner of EVERY team), the name check is the confirm gate.
    const { data: business } = await supabase
      .from("businesses")
      .select("id, name, legal_name")
      .eq("id", businessId)
      .maybeSingle();
    if (!business) {
      throw new Error("Business not found or access denied.");
    }

    const { data: teamsInBiz } = await supabase
      .from("teams")
      .select("id")
      .eq("business_id", businessId);
    const teamIds = (teamsInBiz ?? []).map((row) => row.id as string);
    if (teamIds.length === 0) {
      // No teams = orphan business with no membership granting
      // visibility. Shouldn't happen in healthy data, but if it
      // does the caller can't have authorization either, and the
      // RLS check below will refuse the delete anyway.
      throw new Error("This business has no teams to delete from.");
    }

    const { data: callerMemberships } = await supabase
      .from("team_members")
      .select("team_id, role")
      .eq("user_id", user.id)
      .in("team_id", teamIds);
    if (
      !isOwnerOfEveryTeam(
        teamIds,
        (callerMemberships ?? []).map((m) => ({
          team_id: m.team_id as string,
          role: m.role as string,
        })),
      )
    ) {
      throw new Error(
        "You must be the owner of every team in this business to delete it.",
      );
    }

    // Refuse to orphan: caller must own at least one team in
    // ANOTHER business. Counts only teams in DIFFERENT
    // businesses, so a multi-team owner with all teams in the
    // current business is still blocked. Personal teams
    // (`is_personal=true`) have no business_id and are filtered
    // out by ownsAnotherBusiness.
    const { data: otherOwnerships } = await supabase
      .from("team_members")
      .select("teams!inner(id, business_id)")
      .eq("user_id", user.id)
      .eq("role", "owner");
    const ownerTeams = (otherOwnerships ?? []).flatMap((row) => {
      const team = row.teams as
        | { id: string; business_id: string | null }
        | { id: string; business_id: string | null }[]
        | null;
      const t = Array.isArray(team) ? team[0] : team;
      return t ? [{ id: t.id, business_id: t.business_id }] : [];
    });
    if (!ownsAnotherBusiness(ownerTeams, businessId)) {
      throw new Error(
        "You can't delete your only business. Create another business first.",
      );
    }

    // Typed-name confirmation. legal_name is the user's chosen
    // string when set; otherwise we fall back to the seeded
    // `name` column (same chain as the layout header).
    const expected = expectedConfirmName(
      (business.legal_name as string | null) ?? null,
      (business.name as string | null) ?? null,
    );
    if (!expected || confirmName.trim() !== expected) {
      throw new Error(
        "Business name does not match. Deletion cancelled.",
      );
    }

    // Cascade: delete teams first (their children CASCADE via
    // team_id FKs), then the business (its children CASCADE via
    // business_id FKs). Sequential, not parallel — the
    // teams.business_id RESTRICT must clear before the business
    // delete can run.
    for (const teamId of teamIds) {
      assertSupabaseOk(
        await supabase.from("teams").delete().eq("id", teamId),
      );
    }
    assertSupabaseOk(
      await supabase.from("businesses").delete().eq("id", businessId),
    );

    revalidatePath("/business");
    revalidatePath("/teams");
    revalidatePath("/");
    redirect("/business");
  }, "deleteBusinessAction") as unknown as void;
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
