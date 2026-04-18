import { describe, it, expect } from "vitest";
import { AVATAR_PRESETS } from "@theshyre/ui";
import { presetAvatarUrl, resolveAvatarUrl } from "./avatar-preset";

describe("avatar-preset", () => {
  describe("presetAvatarUrl", () => {
    it("returns null for null/undefined/empty user ids", () => {
      expect(presetAvatarUrl(null)).toBeNull();
      expect(presetAvatarUrl(undefined)).toBeNull();
      expect(presetAvatarUrl("")).toBeNull();
    });

    it("returns a preset:<key> string using a key from AVATAR_PRESETS", () => {
      const url = presetAvatarUrl("aaaa-bbbb-cccc-dddd");
      expect(url).toMatch(/^preset:/);
      const key = url!.slice("preset:".length);
      expect(AVATAR_PRESETS.map((p) => p.key)).toContain(key);
    });

    it("is deterministic — same id always hashes to the same preset", () => {
      const id = "user-123-abc";
      const a = presetAvatarUrl(id);
      const b = presetAvatarUrl(id);
      expect(a).toBe(b);
    });

    it("distributes different ids across multiple presets", () => {
      // 50 random-ish ids should cover more than one preset, otherwise
      // the hash is effectively constant and we'd be back to "everyone
      // is the same color".
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const url = presetAvatarUrl(`user-${i}-${i * 31}`);
        if (url) seen.add(url);
      }
      expect(seen.size).toBeGreaterThan(1);
    });
  });

  describe("resolveAvatarUrl", () => {
    it("returns the stored URL when present, regardless of userId", () => {
      expect(resolveAvatarUrl("https://example.com/a.png", "u1")).toBe(
        "https://example.com/a.png",
      );
      expect(resolveAvatarUrl("preset:emerald", "u1")).toBe("preset:emerald");
    });

    it("falls back to a hashed preset when no stored URL", () => {
      const result = resolveAvatarUrl(null, "u1");
      expect(result).toMatch(/^preset:/);
    });

    it("returns null when neither a stored URL nor a user id is known", () => {
      expect(resolveAvatarUrl(null, null)).toBeNull();
      expect(resolveAvatarUrl(undefined, undefined)).toBeNull();
    });

    it("prefers stored URL over the preset fallback", () => {
      expect(resolveAvatarUrl("https://x.com/y.png", "u1")).toBe(
        "https://x.com/y.png",
      );
    });
  });
});
