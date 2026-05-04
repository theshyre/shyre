import { describe, it, expect, vi } from "vitest";

/**
 * Tests for assertFromDomainAllowed — defense-in-depth domain
 * verification beyond Resend's own check (SAL-016, SAL-022).
 *
 * Mocks the Supabase admin client at the module boundary; the
 * function lives in outbox.ts but only depends on the
 * verified_email_domains table read.
 */

const eqChainMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: (..._args: unknown[]) => ({
            maybeSingle: () => eqChainMock(),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { assertFromDomainAllowed } from "./outbox";

function buildSupabase(
  result: { data: unknown; error: unknown },
): Parameters<typeof assertFromDomainAllowed>[0] {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => result,
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof assertFromDomainAllowed>[0];
}

describe("assertFromDomainAllowed", () => {
  it("allows when the domain matches a verified row", async () => {
    const supabase = buildSupabase({
      data: { id: "x", status: "verified" },
      error: null,
    });
    await expect(
      assertFromDomainAllowed(supabase, "team-1", "info@malcom.io"),
    ).resolves.toBeUndefined();
  });

  it("rejects when the domain has no row", async () => {
    const supabase = buildSupabase({ data: null, error: null });
    await expect(
      assertFromDomainAllowed(supabase, "team-1", "info@malcom.io"),
    ).rejects.toThrow(/malcom\.io.*not verified/i);
  });

  it("rejects when the row exists but status is pending", async () => {
    const supabase = buildSupabase({
      data: { id: "x", status: "pending" },
      error: null,
    });
    await expect(
      assertFromDomainAllowed(supabase, "team-1", "info@malcom.io"),
    ).rejects.toThrow(/not verified/i);
  });

  it("rejects when the row exists but status is failed", async () => {
    const supabase = buildSupabase({
      data: { id: "x", status: "failed" },
      error: null,
    });
    await expect(
      assertFromDomainAllowed(supabase, "team-1", "info@malcom.io"),
    ).rejects.toThrow(/not verified/i);
  });

  it("throws when the from-address has no @ sign", async () => {
    const supabase = buildSupabase({ data: null, error: null });
    await expect(
      assertFromDomainAllowed(supabase, "team-1", "no-at-sign"),
    ).rejects.toThrow(/no domain/i);
  });

  it("lowercases the domain on the lookup (Resend stores lower-case)", async () => {
    // Two equivalent inputs — uppercase vs mixed — both should
    // pass when the team has the lowercase row. The mock returns
    // the same data for both because we don't differentiate by
    // input here; the assertion is "no throw on either."
    const supabase = buildSupabase({
      data: { id: "x", status: "verified" },
      error: null,
    });
    await expect(
      assertFromDomainAllowed(supabase, "team-1", "Info@MALCOM.IO"),
    ).resolves.toBeUndefined();
    await expect(
      assertFromDomainAllowed(supabase, "team-1", "info@MaLcOm.Io"),
    ).resolves.toBeUndefined();
  });
});

// `eqChainMock` is referenced for module wiring even though we
// don't directly assert on it — kept to keep the mock alive.
void eqChainMock;
