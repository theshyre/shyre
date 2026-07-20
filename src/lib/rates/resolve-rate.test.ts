import { describe, it, expect } from "vitest";
import { resolveRate, type RateCascadeInput } from "./resolve-rate";

function input(overrides: Partial<RateCascadeInput> = {}): RateCascadeInput {
  return {
    projectRate: null,
    customerRate: null,
    memberRate: null,
    teamDefaultRate: null,
    ...overrides,
  };
}

describe("resolveRate", () => {
  it("prefers the project rate over every other level", () => {
    expect(
      resolveRate(
        input({
          projectRate: 200,
          customerRate: 150,
          memberRate: 100,
          teamDefaultRate: 50,
        }),
      ),
    ).toBe(200);
  });

  it("falls through to the customer rate when the project has none", () => {
    expect(
      resolveRate(
        input({ customerRate: 150, memberRate: 100, teamDefaultRate: 50 }),
      ),
    ).toBe(150);
  });

  it("falls through to the member rate when project + customer have none", () => {
    expect(
      resolveRate(input({ memberRate: 100, teamDefaultRate: 50 })),
    ).toBe(100);
  });

  it("falls through to the team default when nothing else resolves", () => {
    expect(resolveRate(input({ teamDefaultRate: 50 }))).toBe(50);
  });

  it("returns null when no level in the cascade resolves", () => {
    expect(resolveRate(input())).toBeNull();
  });

  it("treats a masked rate (NULL from a _v view) identically to an absent one — falls through", () => {
    // A project with rate_visibility='owner' masks hourly_rate to NULL
    // for a member viewer. That's indistinguishable from "no project
    // rate configured" at this layer by design (see module docblock);
    // the cascade correctly falls through to the customer's rate,
    // which might be visible to this same viewer.
    expect(
      resolveRate(input({ projectRate: null, customerRate: 120 })),
    ).toBe(120);
  });

  it("treats a zero rate as a real, resolved value — not falsy-fallthrough", () => {
    // 0 is a legitimate configured rate (e.g. pro bono work billed at
    // $0/hr but still tracked). `!= null` must not treat 0 as absent.
    expect(resolveRate(input({ projectRate: 0, customerRate: 150 }))).toBe(0);
    expect(resolveRate(input({ customerRate: 0, memberRate: 80 }))).toBe(0);
    expect(resolveRate(input({ memberRate: 0, teamDefaultRate: 40 }))).toBe(0);
    expect(resolveRate(input({ teamDefaultRate: 0 }))).toBe(0);
  });

  it("stops at the first resolved level even when lower levels are also set", () => {
    expect(
      resolveRate(input({ customerRate: 150, memberRate: 100 })),
    ).toBe(150);
  });
});
