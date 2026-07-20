import { describe, it, expect } from "vitest";
import {
  ALLOWED_THEMES,
  ALLOWED_LOCALES,
  ALLOWED_WEEK_STARTS,
  ALLOWED_TEXT_SIZES,
  ALLOWED_TIME_FORMATS,
} from "./allow-lists";

// Constraint ↔ allow-list parity with the SQL CHECK constraints is
// enforced centrally by src/__tests__/db-parity.test.ts; this covers
// the membership semantics the profile server action relies on.
describe("ALLOWED_THEMES", () => {
  it("accepts every known theme", () => {
    for (const t of [
      "system",
      "light",
      "dark",
      "high-contrast",
      "warm",
      "malcom",
    ]) {
      expect(ALLOWED_THEMES.has(t)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(ALLOWED_THEMES.has("neon")).toBe(false);
    expect(ALLOWED_THEMES.has("")).toBe(false);
  });
});

describe("ALLOWED_LOCALES", () => {
  it("accepts en and es only", () => {
    expect(ALLOWED_LOCALES.has("en")).toBe(true);
    expect(ALLOWED_LOCALES.has("es")).toBe(true);
    expect(ALLOWED_LOCALES.has("fr")).toBe(false);
  });
});

describe("ALLOWED_WEEK_STARTS", () => {
  it("accepts monday and sunday only", () => {
    expect(ALLOWED_WEEK_STARTS.has("monday")).toBe(true);
    expect(ALLOWED_WEEK_STARTS.has("sunday")).toBe(true);
    expect(ALLOWED_WEEK_STARTS.has("tuesday")).toBe(false);
  });
});

describe("ALLOWED_TEXT_SIZES", () => {
  it("accepts compact, regular, large", () => {
    expect(ALLOWED_TEXT_SIZES.has("compact")).toBe(true);
    expect(ALLOWED_TEXT_SIZES.has("regular")).toBe(true);
    expect(ALLOWED_TEXT_SIZES.has("large")).toBe(true);
    expect(ALLOWED_TEXT_SIZES.has("huge")).toBe(false);
  });
});

describe("ALLOWED_TIME_FORMATS", () => {
  it("accepts 12h and 24h only", () => {
    expect(ALLOWED_TIME_FORMATS.has("12h")).toBe(true);
    expect(ALLOWED_TIME_FORMATS.has("24h")).toBe(true);
    expect(ALLOWED_TIME_FORMATS.has("military")).toBe(false);
  });
});
