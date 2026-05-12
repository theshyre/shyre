import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * resolveSegmentLabel maps a dynamic-breadcrumb key + id to a
 * human-readable label by looking up the named entity via Supabase.
 * Each resolver is a thin maybeSingle call; the public dispatcher
 * just picks the right one. Failure modes:
 *
 *   - empty id → null without DB roundtrip
 *   - RLS / not found / fetch error → null (graceful fallback so
 *     the renderer can show a generic segment instead of crashing)
 *   - missing name field on the row → null
 */

const mockMaybeSingle = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  }),
}));

import { resolveSegmentLabel } from "./resolvers";

describe("resolveSegmentLabel", () => {
  beforeEach(() => {
    mockMaybeSingle.mockReset();
  });

  it.each([
    ["businessName", "b-1", { name: "Acme LLC" }, "Acme LLC"],
    ["teamName", "t-1", { name: "Acme Engineering" }, "Acme Engineering"],
    ["customerName", "c-1", { name: "EyeReg Consulting" }, "EyeReg Consulting"],
    ["projectName", "p-1", { name: "AVDR Spike" }, "AVDR Spike"],
  ] as const)(
    "%s returns the entity's name on a hit",
    async (key, id, row, expected) => {
      mockMaybeSingle.mockResolvedValue({ data: row, error: null });
      const label = await resolveSegmentLabel(key, id);
      expect(label).toBe(expected);
    },
  );

  it("invoiceNumber returns the invoice_number field, not 'name'", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { invoice_number: "INV-2026-144" },
      error: null,
    });
    const label = await resolveSegmentLabel("invoiceNumber", "i-1");
    expect(label).toBe("INV-2026-144");
  });

  it("returns null on empty id (no DB call)", async () => {
    expect(await resolveSegmentLabel("businessName", "")).toBeNull();
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it("returns null when the row is not found (RLS-hidden or 404)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await resolveSegmentLabel("teamName", "t-nope")).toBeNull();
  });

  it("returns null on fetch error (network / RLS rejection)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "RLS rejected" },
    });
    expect(await resolveSegmentLabel("teamName", "t-1")).toBeNull();
  });

  it("returns null when the row exists but the name field is missing/null", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { name: null }, error: null });
    expect(await resolveSegmentLabel("customerName", "c-1")).toBeNull();
  });

  it("returns null when invoice row has no invoice_number", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { invoice_number: null },
      error: null,
    });
    expect(await resolveSegmentLabel("invoiceNumber", "i-1")).toBeNull();
  });
});
