import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * profile/actions.ts has six exported actions. testGithubTokenAction /
 * testJiraCredsAction reach out to third-party APIs and have an
 * auth-gate that's already SAL-14-covered; they're integration-flavored
 * and out of scope here. Coverage here:
 *
 *   - updateUserSettings: jira_base_url must be https (SAL-014 SSRF gate),
 *     date normalization (YYYY-MM-DD or null).
 *   - updateProfile: trivial upsert with display_name + user_id stamp.
 *   - setAvatar: refuses external URLs; accepts preset: and own-folder uploads.
 *   - updatePreferences: every enum field validated against its allow-list.
 */

const fakeUserId = "u-author";

vi.mock("@/lib/safe-action", () => ({
  runSafeAction: async (
    formData: FormData,
    fn: (
      fd: FormData,
      ctx: { supabase: unknown; userId: string },
    ) => Promise<void>,
  ) => {
    await fn(formData, { supabase: mockSupabase(), userId: fakeUserId });
    return { success: true };
  },
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

// avatar URL validator is pure — let the real one run; it's the
// gate we want to exercise on setAvatarAction.
vi.mock("./avatar-url-validator", async () => {
  const actual = await vi.importActual<
    typeof import("./avatar-url-validator")
  >("./avatar-url-validator");
  return actual;
});

const state: {
  upserts: { table: string; rows: unknown }[];
  error: { message: string } | null;
} = { upserts: [], error: null };

function mockSupabase() {
  return {
    from: (table: string) => {
      const op: { kind: "upsert" | null; rows: unknown } = {
        kind: null,
        rows: null,
      };
      const chain: Record<string, unknown> = {
        upsert(rows: unknown) {
          op.kind = "upsert";
          op.rows = rows;
          state.upserts.push({ table, rows });
          return chain;
        },
        then(resolve: (v: { data: null; error: unknown }) => void) {
          resolve({ data: null, error: state.error });
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  setAvatarAction,
  updatePreferencesAction,
  updateProfileAction,
  updateUserSettingsAction,
} from "./actions";

function reset(): void {
  state.upserts = [];
  state.error = null;
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("updateUserSettingsAction", () => {
  beforeEach(reset);

  it("upserts user_settings with user_id stamp + tokens", async () => {
    await updateUserSettingsAction(
      fd({
        github_token: "ghp_xxx",
        github_token_expires_at: "2026-12-31",
        jira_base_url: "https://example.atlassian.net",
        jira_email: "me@example.com",
        jira_api_token: "ATATT-xxx",
        jira_api_token_expires_at: "2026-12-31",
      }),
    );
    const row = state.upserts[0]?.rows as Record<string, unknown>;
    expect(state.upserts[0]?.table).toBe("user_settings");
    expect(row.user_id).toBe(fakeUserId);
    expect(row.github_token).toBe("ghp_xxx");
    expect(row.jira_base_url).toBe("https://example.atlassian.net");
    expect(row.github_token_expires_at).toBe("2026-12-31");
  });

  it("rejects plain http:// Jira base URLs (SAL-014 SSRF gate)", async () => {
    await expect(
      updateUserSettingsAction(
        fd({ jira_base_url: "http://internal-jira.local" }),
      ),
    ).rejects.toThrow(/https/);
    expect(state.upserts).toHaveLength(0);
  });

  it("accepts a valid https Jira base URL", async () => {
    await updateUserSettingsAction(
      fd({ jira_base_url: "https://example.atlassian.net" }),
    );
    expect(state.upserts).toHaveLength(1);
  });

  it("rejects malformed token-expiry date (must be YYYY-MM-DD)", async () => {
    await expect(
      updateUserSettingsAction(
        fd({ github_token_expires_at: "tomorrow" }),
      ),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("normalizes empty token-expiry to null", async () => {
    await updateUserSettingsAction(
      fd({ github_token_expires_at: "" }),
    );
    expect(
      (state.upserts[0]?.rows as Record<string, unknown>)
        .github_token_expires_at,
    ).toBeNull();
  });
});

describe("updateProfileAction", () => {
  beforeEach(reset);

  it("upserts user_profiles with the display_name + user_id stamp", async () => {
    await updateProfileAction(fd({ display_name: "Alice" }));
    expect(state.upserts[0]).toEqual({
      table: "user_profiles",
      rows: { user_id: fakeUserId, display_name: "Alice" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/profile");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
  });

  it("normalizes empty display_name to null", async () => {
    await updateProfileAction(fd({ display_name: "" }));
    expect(
      (state.upserts[0]?.rows as Record<string, unknown>).display_name,
    ).toBeNull();
  });
});

describe("setAvatarAction", () => {
  beforeEach(reset);

  it("accepts preset: URLs", async () => {
    await setAvatarAction(fd({ avatar_url: "preset:emerald" }));
    expect(
      (state.upserts[0]?.rows as Record<string, unknown>).avatar_url,
    ).toBe("preset:emerald");
  });

  it("accepts null/empty avatar_url (clears the avatar)", async () => {
    await setAvatarAction(fd({ avatar_url: "" }));
    expect(
      (state.upserts[0]?.rows as Record<string, unknown>).avatar_url,
    ).toBeNull();
  });

  it("rejects an external http(s) URL (privacy / tracking risk)", async () => {
    await expect(
      setAvatarAction(fd({ avatar_url: "https://evil.example.com/track.png" })),
    ).rejects.toThrow(/preset or an upload to your own/);
  });

  it("rejects a Supabase URL nested under another user's folder", async () => {
    await expect(
      setAvatarAction(
        fd({
          avatar_url:
            "https://example.supabase.co/storage/v1/object/public/avatars/u-other/face.png",
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("updatePreferencesAction", () => {
  beforeEach(reset);

  it("upserts every submitted preference, stamping user_id", async () => {
    await updatePreferencesAction(
      fd({
        preferred_theme: "dark",
        timezone: "America/Los_Angeles",
        locale: "en",
        week_start: "monday",
        time_format: "24h",
        text_size: "regular",
      }),
    );
    const row = state.upserts[0]?.rows as Record<string, unknown>;
    expect(state.upserts[0]?.table).toBe("user_settings");
    expect(row.user_id).toBe(fakeUserId);
    expect(row.preferred_theme).toBe("dark");
    expect(row.timezone).toBe("America/Los_Angeles");
    expect(row.locale).toBe("en");
    expect(row.week_start).toBe("monday");
    expect(row.time_format).toBe("24h");
    expect(row.text_size).toBe("regular");
  });

  it("rejects an invalid theme value", async () => {
    await expect(
      updatePreferencesAction(fd({ preferred_theme: "neon-glow" })),
    ).rejects.toThrow(/Invalid theme/);
  });

  it("rejects an invalid locale", async () => {
    await expect(
      updatePreferencesAction(fd({ locale: "elvish" })),
    ).rejects.toThrow(/Invalid locale/);
  });

  it("rejects an invalid week_start", async () => {
    await expect(
      updatePreferencesAction(fd({ week_start: "tuesday" })),
    ).rejects.toThrow(/Invalid week_start/);
  });

  it("rejects an invalid time_format", async () => {
    await expect(
      updatePreferencesAction(fd({ time_format: "ancient_sundial" })),
    ).rejects.toThrow(/Invalid time_format/);
  });

  it("rejects an invalid text_size", async () => {
    await expect(
      updatePreferencesAction(fd({ text_size: "huge" })),
    ).rejects.toThrow(/Invalid text_size/);
  });

  it("empty preference fields normalize to null (reset to 'auto')", async () => {
    await updatePreferencesAction(
      fd({
        preferred_theme: "",
        timezone: "",
        locale: "",
        week_start: "",
        time_format: "",
        text_size: "",
      }),
    );
    const row = state.upserts[0]?.rows as Record<string, unknown>;
    expect(row.preferred_theme).toBeNull();
    expect(row.timezone).toBeNull();
    expect(row.locale).toBeNull();
    expect(row.week_start).toBeNull();
    expect(row.time_format).toBeNull();
    expect(row.text_size).toBeNull();
  });
});
