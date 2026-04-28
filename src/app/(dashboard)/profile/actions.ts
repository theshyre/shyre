"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { fetchRepo } from "@/lib/github";
import { validateJiraCreds } from "@/lib/jira";
import { revalidatePath } from "next/cache";
import {
  ALLOWED_THEMES,
  ALLOWED_LOCALES,
  ALLOWED_WEEK_STARTS,
  ALLOWED_TEXT_SIZES,
  ALLOWED_TIME_FORMATS,
} from "./allow-lists";

export async function updateUserSettingsAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const github_token = (formData.get("github_token") as string) || null;
    const jira_base_url = normalizeStr(formData.get("jira_base_url"));
    const jira_email = normalizeStr(formData.get("jira_email"));
    const jira_api_token = (formData.get("jira_api_token") as string) || null;

    if (jira_base_url && !/^https?:\/\//i.test(jira_base_url)) {
      throw new Error("Jira base URL must start with http(s)://");
    }

    assertSupabaseOk(
      await supabase
        .from("user_settings")
        .upsert({
          user_id: userId,
          github_token,
          jira_base_url,
          jira_email,
          jira_api_token,
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

/**
 * Test a GitHub PAT by fetching `/user`-equivalent metadata via a
 * known-cheap endpoint. We hit `octocat/Hello-World` (GitHub's
 * public test repo) — the `repos/...` route returns 200 with any
 * valid token regardless of token scope, and 401 on a bad token.
 *
 * Returns null on success, an error string on failure. The caller
 * is responsible for surfacing the result inline next to the form.
 *
 * Note: NOT wrapped in runSafeAction because we don't need its
 * FormData parsing or revalidatePath — this is a pure RPC.
 */
export async function testGithubTokenAction(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token || !token.trim()) {
    return { ok: false, error: "Token is empty." };
  }
  const { error } = await fetchRepo("octocat/Hello-World", token.trim());
  if (error) {
    return { ok: false, error: `${error.status}: ${error.message}` };
  }
  return { ok: true };
}

/**
 * Test Jira creds by hitting `/rest/api/3/myself`. Same shape as
 * testGithubTokenAction.
 */
export async function testJiraCredsAction(
  baseUrl: string,
  email: string,
  apiToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!baseUrl?.trim() || !email?.trim() || !apiToken?.trim()) {
    return { ok: false, error: "Fill in all three Jira fields." };
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, error: "Base URL must start with http(s)://" };
  }
  const { ok, error } = await validateJiraCreds({
    baseUrl: baseUrl.trim(),
    email: email.trim(),
    apiToken: apiToken.trim(),
  });
  if (!ok) {
    return {
      ok: false,
      error: error ? `${error.status}: ${error.message}` : "Unknown error",
    };
  }
  return { ok: true };
}

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
    const text_size = normalizeStr(formData.get("text_size"));

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
    if (text_size && !ALLOWED_TEXT_SIZES.has(text_size)) {
      throw new Error(`Invalid text_size: ${text_size}`);
    }

    assertSupabaseOk(
      await supabase.from("user_settings").upsert({
        user_id: userId,
        preferred_theme: theme,
        timezone,
        locale,
        week_start,
        time_format,
        text_size,
      }),
    );

    revalidatePath("/profile");
    revalidatePath("/");
  }, "updatePreferencesAction") as unknown as void;
}
