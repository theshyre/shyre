import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMaybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "user_settings") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          maybeSingle: () => mockMaybeSingle(),
        }),
      };
    },
  }),
}));

import { getUserSettings } from "./user-settings";

beforeEach(() => {
  mockMaybeSingle.mockReset();
});

describe("getUserSettings", () => {
  it("returns nulls across the board when no row exists", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    const settings = await getUserSettings();
    expect(settings).toEqual({
      preferredTheme: null,
      preferredTextSize: null,
      preferredDensity: null,
      timezone: null,
    });
  });

  it("maps the four columns through to camelCase fields", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        preferred_theme: "dark",
        text_size: "medium",
        table_density: "compact",
        timezone: "America/Los_Angeles",
      },
    });
    const settings = await getUserSettings();
    expect(settings).toEqual({
      preferredTheme: "dark",
      preferredTextSize: "medium",
      preferredDensity: "compact",
      timezone: "America/Los_Angeles",
    });
  });

  it("preserves nulls on a partial row", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        preferred_theme: null,
        text_size: null,
        table_density: null,
        timezone: "UTC",
      },
    });
    const settings = await getUserSettings();
    expect(settings.timezone).toBe("UTC");
    expect(settings.preferredTheme).toBeNull();
    expect(settings.preferredTextSize).toBeNull();
    expect(settings.preferredDensity).toBeNull();
  });
});
