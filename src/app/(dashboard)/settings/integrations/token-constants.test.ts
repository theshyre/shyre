import { describe, it, expect } from "vitest";
import {
  DEFAULT_TOKEN_TTL_DAYS as libDefault,
  MAX_TOKEN_TTL_DAYS as libMax,
} from "@/lib/integrations/tokens";
import {
  DEFAULT_TOKEN_TTL_DAYS,
  MAX_TOKEN_TTL_DAYS,
  TOKEN_TTL_PRESETS,
} from "./token-constants";

describe("token-constants", () => {
  it("mirrors the server-only lib's TTL values exactly", () => {
    // token-constants can't import the server-only module (client
    // components consume it), so the numbers are duplicated — this
    // parity check is what keeps them honest.
    expect(DEFAULT_TOKEN_TTL_DAYS).toBe(libDefault);
    expect(MAX_TOKEN_TTL_DAYS).toBe(libMax);
  });

  it("offers the default as a preset and never exceeds the max", () => {
    expect(TOKEN_TTL_PRESETS).toContain(DEFAULT_TOKEN_TTL_DAYS);
    for (const preset of TOKEN_TTL_PRESETS) {
      expect(preset).toBeGreaterThan(0);
      expect(preset).toBeLessThanOrEqual(MAX_TOKEN_TTL_DAYS);
    }
    // Sorted ascending, no duplicates — the select renders them as-is.
    const sorted = [...TOKEN_TTL_PRESETS].sort((a, b) => a - b);
    expect(TOKEN_TTL_PRESETS).toEqual(sorted);
    expect(new Set(TOKEN_TTL_PRESETS).size).toBe(TOKEN_TTL_PRESETS.length);
  });
});
