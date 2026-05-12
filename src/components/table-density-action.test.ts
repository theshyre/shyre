import { describe, it, expect, vi, beforeEach } from "vitest";

const { runSafeActionMock, upsertMock, fromMock, assertSupabaseOkMock } =
  vi.hoisted(() => {
    const upsert = vi.fn();
    const from = vi.fn((_table: string) => ({ upsert }));
    return {
      runSafeActionMock: vi.fn(
        async (
          fd: FormData,
          fn: (
            fd: FormData,
            ctx: {
              supabase: { from: typeof from };
              userId: string;
            },
          ) => Promise<void>,
          _name: string,
        ) => {
          // Pretend we're inside the safe-action wrap: hand the inner
          // fn a stub supabase + userId so it can exercise the upsert.
          await fn(fd, { supabase: { from }, userId: "u-1" });
        },
      ),
      upsertMock: upsert,
      fromMock: from,
      assertSupabaseOkMock: vi.fn(),
    };
  });

vi.mock("@/lib/safe-action", () => ({
  runSafeAction: (...args: unknown[]) =>
    runSafeActionMock(...(args as Parameters<typeof runSafeActionMock>)),
}));

vi.mock("@/lib/errors", () => ({
  assertSupabaseOk: (r: unknown) => assertSupabaseOkMock(r),
}));

import { updateTableDensityAction } from "./table-density-action";

describe("updateTableDensityAction", () => {
  beforeEach(() => {
    runSafeActionMock.mockClear();
    upsertMock.mockClear();
    fromMock.mockClear();
    assertSupabaseOkMock.mockClear();
    upsertMock.mockResolvedValue({ error: null });
  });

  it("upserts user_settings with the chosen density", async () => {
    const fd = new FormData();
    fd.set("table_density", "compact");
    await updateTableDensityAction(fd);
    expect(fromMock).toHaveBeenCalledWith("user_settings");
    expect(upsertMock).toHaveBeenCalledWith(
      { user_id: "u-1", table_density: "compact" },
      { onConflict: "user_id" },
    );
    expect(assertSupabaseOkMock).toHaveBeenCalled();
  });

  it.each(["compact", "regular", "comfortable"] as const)(
    "accepts the allowed density value %s",
    async (d) => {
      const fd = new FormData();
      fd.set("table_density", d);
      await updateTableDensityAction(fd);
      expect(upsertMock).toHaveBeenCalledWith(
        { user_id: "u-1", table_density: d },
        { onConflict: "user_id" },
      );
    },
  );

  it("trims whitespace before checking the allow-list", async () => {
    const fd = new FormData();
    fd.set("table_density", "  regular  ");
    await updateTableDensityAction(fd);
    expect(upsertMock).toHaveBeenCalledWith(
      { user_id: "u-1", table_density: "regular" },
      { onConflict: "user_id" },
    );
  });

  it("throws on an off-allowlist density (defense against typos / tampering)", async () => {
    const fd = new FormData();
    fd.set("table_density", "ultra-comfortable");
    await expect(updateTableDensityAction(fd)).rejects.toThrow(
      /Invalid table_density/,
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("throws when table_density is missing from the form data", async () => {
    const fd = new FormData();
    await expect(updateTableDensityAction(fd)).rejects.toThrow(
      /Invalid table_density/,
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("propagates Supabase errors via assertSupabaseOk", async () => {
    assertSupabaseOkMock.mockImplementationOnce(() => {
      throw new Error("RLS denied");
    });
    const fd = new FormData();
    fd.set("table_density", "regular");
    await expect(updateTableDensityAction(fd)).rejects.toThrow(/RLS denied/);
  });
});
