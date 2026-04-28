"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { fetchRepo } from "@/lib/github";
import { validateJiraCreds } from "@/lib/jira";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
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

    if (jira_base_url && !/^https:\/\//i.test(jira_base_url)) {
      // Tightened to https only per SAL-014 — plain http would let
      // a saved base URL silently downgrade an SSRF probe.
      throw new Error("Jira base URL must start with https://");
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
 * Authenticated wrapper for the Test-connection actions. Both calls
 * out to third-party APIs server-side using user-supplied credentials,
 * which means an unauthenticated session calling the action endpoint
 * would let an attacker probe GitHub / Jira from our IP. Per
 * SAL-014, every test path requires `auth.getUser()` first.
 */
async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return user.id;
}

/**
 * Test a GitHub PAT by fetching `/user`-equivalent metadata via a
 * known-cheap endpoint. We hit `octocat/Hello-World` (GitHub's
 * public test repo) — the `repos/...` route returns 200 with any
 * valid token regardless of token scope, and 401 on a bad token.
 *
 * Auth-gated, log-on-error. Returns null on success, an error
 * string on failure.
 */
export async function testGithubTokenAction(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  if (!token || !token.trim()) {
    return { ok: false, error: "Token is empty." };
  }
  const { error } = await fetchRepo("octocat/Hello-World", token.trim());
  if (error) {
    if (error.status !== 401 && error.status !== 0) {
      logError(new Error(`testGithubTokenAction: ${error.message}`), {
        userId,
        action: "testGithubTokenAction",
      });
    }
    return { ok: false, error: `${error.status}: ${error.message}` };
  }
  return { ok: true };
}

/**
 * Test Jira creds by hitting `/rest/api/3/myself`. Same shape as
 * testGithubTokenAction. SSRF-protected via the underlying
 * `validateJiraCreds` → `assertSafeOutboundUrl` chain.
 */
export async function testJiraCredsAction(
  baseUrl: string,
  email: string,
  apiToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  if (!baseUrl?.trim() || !email?.trim() || !apiToken?.trim()) {
    return { ok: false, error: "Fill in all three Jira fields." };
  }
  if (!/^https:\/\//i.test(baseUrl)) {
    return { ok: false, error: "Base URL must start with https://" };
  }
  const { ok, error } = await validateJiraCreds({
    baseUrl: baseUrl.trim(),
    email: email.trim(),
    apiToken: apiToken.trim(),
  });
  if (!ok) {
    if (error && error.status !== 401 && error.status !== 0) {
      logError(new Error(`testJiraCredsAction: ${error.message}`), {
        userId,
        action: "testJiraCredsAction",
      });
    }
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
