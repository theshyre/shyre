"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
import { revalidatePath } from "next/cache";
import { serializeAddress } from "@/lib/schemas/address";

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

export async function updateOrgSettingsAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const orgId = formData.get("organization_id") as string;
    const { role } = await validateOrgAccess(orgId);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can update organization settings.");
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
        .from("organization_settings")
        .upsert({
          organization_id: orgId,
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

    revalidatePath("/settings");
  }, "updateOrgSettingsAction") as unknown as void;
}

export async function updateUserSettingsAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const github_token = (formData.get("github_token") as string) || null;

    assertSupabaseOk(
      await supabase
        .from("user_settings")
        .upsert({
          user_id: userId,
          github_token,
        })
    );

    revalidatePath("/settings");
  }, "updateUserSettingsAction") as unknown as void;
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const display_name = (formData.get("display_name") as string) || null;
    const avatar_url = (formData.get("avatar_url") as string) || null;

    assertSupabaseOk(
      await supabase
        .from("user_profiles")
        .upsert({
          user_id: userId,
          display_name,
          avatar_url,
        })
    );

    revalidatePath("/settings");
    revalidatePath("/");
  }, "updateProfileAction") as unknown as void;
}

const ALLOWED_THEMES = new Set(["system", "light", "dark", "high-contrast"]);
const ALLOWED_LOCALES = new Set(["en", "es"]);
const ALLOWED_WEEK_STARTS = new Set(["monday", "sunday"]);
const ALLOWED_TIME_FORMATS = new Set(["12h", "24h"]);

function normalizeStr(value: FormDataEntryValue | null): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Update per-user preferences: theme, timezone, locale, week_start, time_format.
 * Each field is optional — submitting an empty value resets to "auto" (NULL).
 */
export async function updatePreferencesAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const theme = normalizeStr(formData.get("preferred_theme"));
    const timezone = normalizeStr(formData.get("timezone"));
    const locale = normalizeStr(formData.get("locale"));
    const week_start = normalizeStr(formData.get("week_start"));
    const time_format = normalizeStr(formData.get("time_format"));

    if (theme && !ALLOWED_THEMES.has(theme)) {
      throw new Error(`Invalid theme: ${theme}`);
    }
    if (locale && !ALLOWED_LOCALES.has(locale)) {
      throw new Error(`Invalid locale: ${locale}`);
    }
    if (week_start && !ALLOWED_WEEK_STARTS.has(week_start)) {
      throw new Error(`Invalid week_start: ${week_start}`);
    }
    if (time_format && !ALLOWED_TIME_FORMATS.has(time_format)) {
      throw new Error(`Invalid time_format: ${time_format}`);
    }

    assertSupabaseOk(
      await supabase.from("user_settings").upsert({
        user_id: userId,
        preferred_theme: theme,
        timezone,
        locale,
        week_start,
        time_format,
      }),
    );

    revalidatePath("/settings");
    revalidatePath("/");
  }, "updatePreferencesAction") as unknown as void;
}
