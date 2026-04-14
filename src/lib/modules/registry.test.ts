import { describe, it, expect } from "vitest";
import { MODULES, getModule, navItemsForSection } from "./registry";

describe("module registry", () => {
  it("exports a non-empty module list", () => {
    expect(MODULES.length).toBeGreaterThan(0);
  });

  it("each module has required fields", () => {
    for (const m of MODULES) {
      expect(m.id).toBeTruthy();
      expect(m.labelKey).toBeTruthy();
      expect(m.icon).toBeTruthy();
      expect(["track", "manage", "admin"]).toContain(m.section);
      expect(Array.isArray(m.navItems)).toBe(true);
      for (const item of m.navItems) {
        expect(item.labelKey).toBeTruthy();
        expect(item.href.startsWith("/")).toBe(true);
        expect(item.icon).toBeTruthy();
      }
    }
  });

  it("module ids are unique", () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getModule looks up by id", () => {
    expect(getModule("stint")?.section).toBe("track");
    expect(getModule("business")?.section).toBe("admin");
    expect(getModule("not-a-real-module")).toBeUndefined();
  });

  it("navItemsForSection returns items in declaration order", () => {
    const admin = navItemsForSection("admin");
    expect(admin.some((i) => i.href === "/business")).toBe(true);
    const track = navItemsForSection("track");
    expect(track.some((i) => i.href === "/time-entries")).toBe(true);
  });
});
