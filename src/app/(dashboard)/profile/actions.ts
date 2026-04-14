"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { revalidatePath } from "next/cache";

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

    revalidatePath("/profile");
  }, "updateUserSettingsAction") as unknown as void;
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const display_name = (formData.get("display_name") as string) || null;

    assertSupabaseOk(
      await supabase
        .from("user_profiles")
        .upsert({
          user_id: userId,
          display_name,
        })
    );

    revalidatePath("/profile");
    revalidatePath("/");
  }, "updateProfileAction") as unknown as void;
}

/**
 * Update just the avatar_url on user_profiles. Called by the AvatarPicker
 * when the user selects a preset or finishes uploading an image.
 */
export async function setAvatarAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const raw = (formData.get("avatar_url") as string) || "";
    const avatar_url = raw.trim() === "" ? null : raw.trim();

    // Minimal validation: preset:* tokens or http(s) URLs only.
    if (avatar_url && !avatar_url.startsWith("preset:")) {
      if (!/^https?:\/\//.test(avatar_url)) {
        throw new Error("Avatar URL must be http(s) or a preset.");
      }
    }

    assertSupabaseOk(
      await supabase
        .from("user_profiles")
        .upsert({
          user_id: userId,
          avatar_url,
        })
    );
    revalidatePath("/profile");
    revalidatePath("/");
  }, "setAvatarAction") as unknown as void;
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

    revalidatePath("/profile");
    revalidatePath("/");
  }, "updatePreferencesAction") as unknown as void;
}
