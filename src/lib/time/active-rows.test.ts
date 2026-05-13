import { describe, it, expect } from "vitest";
import {
  DEFAULT_ACTIVE_WINDOW_DAYS,
  defaultSince,
  isSource,
  getActiveRows,
} from "./active-rows";

describe("DEFAULT_ACTIVE_WINDOW_DAYS", () => {
  it("is 14 (persona-converged value)", () => {
    expect(DEFAULT_ACTIVE_WINDOW_DAYS).toBe(14);
  });
});

describe("defaultSince", () => {
  it("returns a date 14 days before the anchor", () => {
    const now = new Date("2026-05-13T12:00:00.000Z");
    const since = defaultSince(now);
    expect(since.getTime()).toBe(
      now.getTime() - 14 * 24 * 60 * 60 * 1000,
    );
  });
});

describe("isSource", () => {
  it("matches a single-source row", () => {
    expect(isSource("pinned", "pinned")).toBe(true);
    expect(isSource("recent", "pinned")).toBe(false);
  });

  it("matches a comma-joined source set", () => {
    expect(isSource("pinned,recent", "pinned")).toBe(true);
    expect(isSource("pinned,recent", "recent")).toBe(true);
    expect(isSource("pinned,recent", "team_default")).toBe(false);
  });

  it("does NOT match a substring prefix (regression guard)", () => {
    // "pin" is not "pinned" — splitting on comma avoids the false
    // positive a naive includes() would produce.
    expect(isSource("pin,recent", "pinned")).toBe(false);
  });

  it("handles all three documented sources", () => {
    expect(isSource("pinned,recent,team_default", "team_default")).toBe(true);
    expect(isSource("team_default", "team_default")).toBe(true);
  });
});

describe("getActiveRows (RPC wrapper)", () => {
  it("calls stint_active_rows with the right param shape", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const supabase = {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return { data: [], error: null };
      },
    } as unknown as Parameters<typeof getActiveRows>[0];
    await getActiveRows(supabase, "team-1", "user-1", new Date("2026-04-01"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      fn: "stint_active_rows",
      args: {
        p_team_id: "team-1",
        p_user_id: "user-1",
        p_since: "2026-04-01T00:00:00.000Z",
      },
    });
  });

  it("maps snake_case RPC columns to camelCase", async () => {
    const supabase = {
      rpc: async () => ({
        data: [
          {
            project_id: "p-1",
            category_id: "c-1",
            source: "pinned,recent",
            last_activity_at: "2026-05-12T09:00:00.000Z",
          },
          {
            project_id: "p-2",
            category_id: null,
            source: "team_default",
            last_activity_at: "2026-05-01T00:00:00.000Z",
          },
        ],
        error: null,
      }),
    } as unknown as Parameters<typeof getActiveRows>[0];
    const rows = await getActiveRows(supabase, "t", "u");
    expect(rows).toEqual([
      {
        projectId: "p-1",
        categoryId: "c-1",
        source: "pinned,recent",
        lastActivityAt: "2026-05-12T09:00:00.000Z",
      },
      {
        projectId: "p-2",
        categoryId: null,
        source: "team_default",
        lastActivityAt: "2026-05-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns [] on RPC error (soft-fail: row set is augmentation, not primary)", async () => {
    const supabase = {
      rpc: async () => ({
        data: null,
        error: { message: "permission denied" },
      }),
    } as unknown as Parameters<typeof getActiveRows>[0];
    const rows = await getActiveRows(supabase, "t", "u");
    expect(rows).toEqual([]);
  });

  it("returns [] when the RPC returns null data with no error", async () => {
    const supabase = {
      rpc: async () => ({ data: null, error: null }),
    } as unknown as Parameters<typeof getActiveRows>[0];
    const rows = await getActiveRows(supabase, "t", "u");
    expect(rows).toEqual([]);
  });
});
