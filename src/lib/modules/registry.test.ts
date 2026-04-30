import { describe, it, expect } from "vitest";
import {
  MODULES,
  PLATFORM_TOOLS,
  getModule,
  navItemsForSection,
} from "./registry";

describe("module registry", () => {
  it("exports a non-empty module list", () => {
    expect(MODULES.length).toBeGreaterThan(0);
  });

  it("each module has required fields", () => {
    for (const m of MODULES) {
      expect(m.id).toBeTruthy();
      expect(m.labelKey).toBeTruthy();
      expect(m.icon).toBeTruthy();
      expect(["track", "manage", "setup"]).toContain(m.section);
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
    expect(getModule("business")?.section).toBe("setup");
    expect(getModule("not-a-real-module")).toBeUndefined();
  });

  it("navItemsForSection returns items in declaration order", () => {
    const setup = navItemsForSection("setup");
    expect(setup.some((i) => i.href === "/business")).toBe(true);
    const track = navItemsForSection("track");
    expect(track.some((i) => i.href === "/time-entries")).toBe(true);
  });

  describe("platform tools", () => {
    it("Import is registered as a platform tool in the setup section", () => {
      const importTool = PLATFORM_TOOLS.find((t) => t.id === "import");
      expect(importTool).toBeDefined();
      expect(importTool?.section).toBe("setup");
      expect(importTool?.navItem.href).toBe("/import");
    });

    it("Import is NOT registered as a module — it cross-cuts multiple verticals", () => {
      // Architectural invariant: Import writes into Stint, Business,
      // future Invoicing, and Customers. Modeling it as a module would
      // relax the meaning of "module" and invite the next platform tool
      // to follow the same pattern.
      expect(MODULES.find((m) => m.id === "import")).toBeUndefined();
    });

    it("navItemsForSection merges modules and platform tools", () => {
      const setup = navItemsForSection("setup");
      const hrefs = setup.map((i) => i.href);
      // Modules
      expect(hrefs).toContain("/business");
      expect(hrefs).toContain("/settings");
      // Platform tool
      expect(hrefs).toContain("/import");
    });
  });
});
