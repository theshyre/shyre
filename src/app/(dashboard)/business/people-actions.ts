"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  readPersonFields,
  requiredString,
} from "./people-form-parse";

type SBClient = import("@supabase/supabase-js").SupabaseClient;

async function assertBusinessAdmin(
  supabase: SBClient,
  businessId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("user_business_role", {
    business_id: businessId,
  });
  if (error) throw error;
  if (data !== "owner" && data !== "admin") {
    throw new Error(
      "Only owners and admins of a team in this business can manage people.",
    );
  }
}

function revalidateBusiness(businessId: string): void {
  revalidatePath("/business");
  revalidatePath(`/business/${businessId}`);
}

export async function createPersonAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    await assertBusinessAdmin(supabase, businessId);

    const fields = readPersonFields(formData);

    assertSupabaseOk(
      await supabase.from("business_people").insert({
        business_id: businessId,
        ...fields,
      }),
    );

    revalidateBusiness(businessId);
  }, "createPersonAction") as unknown as void;
}

export async function updatePersonAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const personId = requiredString(formData, "person_id");
    await assertBusinessAdmin(supabase, businessId);

    const fields = readPersonFields(formData);

    assertSupabaseOk(
      await supabase
        .from("business_people")
        .update(fields)
        .eq("id", personId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "updatePersonAction") as unknown as void;
}

export async function deletePersonAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const personId = requiredString(formData, "person_id");
    await assertBusinessAdmin(supabase, businessId);

    assertSupabaseOk(
      await supabase
        .from("business_people")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", personId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "deletePersonAction") as unknown as void;
}

export interface PersonHistoryEntry {
  id: string;
  operation: "UPDATE" | "DELETE";
  changedAt: string;
  changedBy: {
    userId: string | null;
    displayName: string | null;
    email: string | null;
  };
  previousState: Record<string, unknown>;
}

/** Read the change history for a person. RLS gates this — owner/admin
 *  of the business sees everything, the linked user sees only their
 *  own history. Read-only, so no runSafeAction wrapping (that's for
 *  mutations); plain auth check + Supabase query is enough. */
export async function getPersonHistoryAction(
  personId: string,
): Promise<{ history: PersonHistoryEntry[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const { data: rows, error } = await supabase
    .from("business_people_history")
    .select("id, operation, changed_at, changed_by_user_id, previous_state")
    .eq("business_person_id", personId)
    .order("changed_at", { ascending: false });
  if (error) throw error;

  const actorIds = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => r.changed_by_user_id as string | null)
        .filter((id): id is string => id !== null),
    ),
  );
  const profilesById = new Map<string, { display_name: string | null }>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const p of profiles ?? []) {
      profilesById.set(p.user_id as string, {
        display_name: (p.display_name as string | null) ?? null,
      });
    }
  }

  const history: PersonHistoryEntry[] = (rows ?? []).map((r) => {
    const actorId = (r.changed_by_user_id as string | null) ?? null;
    const profile = actorId ? profilesById.get(actorId) : null;
    return {
      id: r.id as string,
      operation: r.operation as "UPDATE" | "DELETE",
      changedAt: r.changed_at as string,
      changedBy: {
        userId: actorId,
        displayName: profile?.display_name ?? null,
        email: null,
      },
      previousState:
        (r.previous_state as Record<string, unknown> | null) ?? {},
    };
  });

  return { history };
}

export interface BusinessPersonHistoryEntry extends PersonHistoryEntry {
  /** Person this entry is about. We resolve the live row to a current
   *  display name where possible; if the person has been hard-deleted
   *  (rare today; soft delete is the path) we fall back to the
   *  legal_name captured in `previousState`. */
  personId: string;
  personDisplayName: string;
}

/** Read every change entry across every person in a business, in
 *  reverse-chronological order. Used by /business/[businessId]/people/
 *  history to give bookkeepers a single timeline of HR changes. RLS
 *  on bph_select gates per-row visibility — owner/admin sees the
 *  whole business; other users see only their own entries. */
export async function getBusinessPeopleHistoryAction(
  businessId: string,
  options?: { limit?: number; offset?: number },
): Promise<{ history: BusinessPersonHistoryEntry[]; hasMore: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  // Pull one extra row to know whether there's more — cheaper than a
  // separate count() and good enough for "Load more" pagination.
  const { data: rows, error } = await supabase
    .from("business_people_history")
    .select(
      "id, business_person_id, operation, changed_at, changed_by_user_id, previous_state",
    )
    .eq("business_id", businessId)
    .order("changed_at", { ascending: false })
    .range(offset, offset + limit);
  if (error) throw error;

  const trimmed = (rows ?? []).slice(0, limit);
  const hasMore = (rows ?? []).length > limit;

  // Bulk lookups: actor display names + live person display names.
  const actorIds = Array.from(
    new Set(
      trimmed
        .map((r) => r.changed_by_user_id as string | null)
        .filter((id): id is string => id !== null),
    ),
  );
  const personIds = Array.from(
    new Set(trimmed.map((r) => r.business_person_id as string)),
  );

  const [profilesRes, peopleRes] = await Promise.all([
    actorIds.length > 0
      ? supabase
          .from("user_profiles")
          .select("user_id, display_name")
          .in("user_id", actorIds)
      : Promise.resolve({ data: [] }),
    personIds.length > 0
      ? supabase
          .from("business_people")
          .select("id, legal_name, preferred_name")
          .in("id", personIds)
      : Promise.resolve({ data: [] }),
  ]);

  const actorNameById = new Map<string, string | null>();
  for (const p of profilesRes.data ?? []) {
    actorNameById.set(
      p.user_id as string,
      (p.display_name as string | null) ?? null,
    );
  }
  const personNameById = new Map<string, string>();
  for (const p of peopleRes.data ?? []) {
    const preferred = (p.preferred_name as string | null) ?? null;
    const legal = (p.legal_name as string | null) ?? "";
    personNameById.set(p.id as string, preferred ?? legal);
  }

  const history: BusinessPersonHistoryEntry[] = trimmed.map((r) => {
    const actorId = (r.changed_by_user_id as string | null) ?? null;
    const personId = r.business_person_id as string;
    const previousState =
      (r.previous_state as Record<string, unknown> | null) ?? {};
    // Live name first; fall back to the legal_name in the snapshot
    // (the row was hard-deleted so the live join is empty).
    const personDisplayName =
      personNameById.get(personId) ??
      (typeof previousState.legal_name === "string"
        ? (previousState.legal_name as string)
        : "Unknown person");

    return {
      id: r.id as string,
      personId,
      personDisplayName,
      operation: r.operation as "UPDATE" | "DELETE",
      changedAt: r.changed_at as string,
      changedBy: {
        userId: actorId,
        displayName: actorId ? (actorNameById.get(actorId) ?? null) : null,
        email: null,
      },
      previousState,
    };
  });

  return { history, hasMore };
}
