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

const RATE_LEVELS = new Set(["owner", "admins", "all_members"]);
const TIME_ENTRIES_LEVELS = new Set([
  "own_only",
  "read_all",
  "read_write_all",
]);

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
    // Branding fields. Empty strings → null so we don't write empty
    // rows the DB CHECK would reject (length 1..50). Brand color is
    // also validated by the schema, but the form may submit it
    // empty when the user clears the picker.
    const wordmark_primary =
      (formData.get("wordmark_primary") as string)?.trim() || null;
    const wordmark_secondary =
      (formData.get("wordmark_secondary") as string)?.trim() || null;
    const brand_color =
      (formData.get("brand_color") as string)?.trim() || null;

    // show_country_on_invoice — checkbox absent from FormData when
    // unchecked. The form always renders this input, so absence
    // means false.
    const show_country_on_invoice =
      formData.get("show_country_on_invoice") === "on";

    const patch: Record<string, unknown> = {
      team_id: teamId,
      business_name,
      business_email,
      business_address,
      business_phone,
      invoice_prefix,
      invoice_next_num,
      tax_rate,
      show_country_on_invoice,
      wordmark_primary,
      wordmark_secondary,
      brand_color,
    };

    // default_payment_terms_days: integer 0..365 inclusive, or null
    // ("Ask each time"). Empty string from the inherit chip → null.
    if (formData.has("default_payment_terms_days")) {
      const raw = (formData.get("default_payment_terms_days") as string).trim();
      patch.default_payment_terms_days =
        raw === "" ? null : Math.max(0, Math.min(365, parseInt(raw, 10) || 0));
    }

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

    // time_entries_visibility: role-check only (owner/admin already
    // passed), no rate-permission gate — this is an operations setting,
    // not a rate-security one.
    if (formData.has("time_entries_visibility")) {
      const level = formData.get("time_entries_visibility") as string;
      if (TIME_ENTRIES_LEVELS.has(level)) {
        patch.time_entries_visibility = level;
      }
    }

    // rate_visibility / rate_editability on team_settings: gated by
    // can_set_rate_permissions (owner always; admin only if the
    // delegation flag is on).
    const wantsRatePermChange =
      formData.has("rate_visibility") || formData.has("rate_editability");
    if (wantsRatePermChange) {
      const { data: canSet } = await supabase.rpc(
        "can_set_rate_permissions",
        { p_team_id: teamId },
      );
      if (canSet) {
        if (formData.has("rate_visibility")) {
          const v = formData.get("rate_visibility") as string;
          if (RATE_LEVELS.has(v)) patch.rate_visibility = v;
        }
        if (formData.has("rate_editability")) {
          const v = formData.get("rate_editability") as string;
          if (RATE_LEVELS.has(v)) patch.rate_editability = v;
        }
      }
    }

    // Delegation flag: owner-only.
    if (
      formData.has("admins_can_set_rate_permissions") &&
      role === "owner"
    ) {
      patch.admins_can_set_rate_permissions =
        formData.get("admins_can_set_rate_permissions") === "on";
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

const TIME_ENTRIES_VISIBILITY = new Set([
  "own_only",
  "read_all",
  "read_write_all",
]);

/**
 * Set the team-level time_entries_visibility config. Per-project
 * overrides live on `projects.time_entries_visibility`
 * (setProjectTimeEntriesVisibilityAction).
 *
 * Owner/admin only — this is a team-operations decision, not a rate-
 * security one, so it doesn't go through the rate-permission
 * delegation flag.
 */
export async function setTeamTimeEntriesVisibilityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    if (!teamId) throw new Error("Team id is required.");

    const { role } = await validateTeamAccess(teamId);
    if (role !== "owner" && role !== "admin") {
      throw new Error(
        "Only owners and admins can change time-entry visibility.",
      );
    }

    const level = formData.get("level") as string;
    if (!TIME_ENTRIES_VISIBILITY.has(level)) {
      throw new Error(
        `Invalid level "${level}". Allowed: own_only, read_all, read_write_all.`,
      );
    }

    assertSupabaseOk(
      await supabase
        .from("team_settings")
        .upsert({ team_id: teamId, time_entries_visibility: level }),
    );

    revalidatePath(`/teams/${teamId}`);
  }, "setTeamTimeEntriesVisibilityAction") as unknown as void;
}
