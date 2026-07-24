import { describe, it, expect } from "vitest";

import { isoDatetimeOffset } from "./iso-datetime";

describe("isoDatetimeOffset", () => {
  it("accepts the RFC-3339 colon offset unchanged", () => {
    expect(isoDatetimeOffset.parse("2026-07-24T07:01:00-07:00")).toBe(
      "2026-07-24T07:01:00-07:00",
    );
    expect(isoDatetimeOffset.parse("2026-07-24T07:01:00+05:30")).toBe(
      "2026-07-24T07:01:00+05:30",
    );
  });

  it("accepts and normalizes the bare ISO 8601 offset (`date +%z` form)", () => {
    // The whole point: -0700 → -07:00 rather than a VALIDATION_ERROR.
    expect(isoDatetimeOffset.parse("2026-07-24T07:01:00-0700")).toBe(
      "2026-07-24T07:01:00-07:00",
    );
    expect(isoDatetimeOffset.parse("2026-07-24T02:31:00+0530")).toBe(
      "2026-07-24T02:31:00+05:30",
    );
  });

  it("accepts Z (UTC) and fractional seconds", () => {
    expect(isoDatetimeOffset.parse("2026-07-24T14:01:00Z")).toBe(
      "2026-07-24T14:01:00Z",
    );
    expect(isoDatetimeOffset.parse("2026-07-24T07:01:00.123-0700")).toBe(
      "2026-07-24T07:01:00.123-07:00",
    );
  });

  it("still requires an offset — a naive datetime is rejected", () => {
    expect(isoDatetimeOffset.safeParse("2026-07-24T07:01:00").success).toBe(
      false,
    );
  });

  it("rejects non-datetime and non-string input", () => {
    expect(isoDatetimeOffset.safeParse("not-a-date").success).toBe(false);
    expect(isoDatetimeOffset.safeParse("").success).toBe(false);
    expect(isoDatetimeOffset.safeParse(1234).success).toBe(false);
    // A bare 2-digit offset is not a valid ISO offset and stays rejected.
    expect(isoDatetimeOffset.safeParse("2026-07-24T07:01:00-07").success).toBe(
      false,
    );
  });

  it("composes with .optional() — undefined passes, a present value still validates", () => {
    const optional = isoDatetimeOffset.optional();
    expect(optional.parse(undefined)).toBeUndefined();
    expect(optional.parse("2026-07-24T07:01:00-0700")).toBe(
      "2026-07-24T07:01:00-07:00",
    );
    expect(optional.safeParse("nope").success).toBe(false);
  });
});
