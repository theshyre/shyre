import { describe, it, expect } from "vitest";
import {
  MODULES,
  PLATFORM_TOOLS,
  SHELL_SURFACES,
  getModule,
  navItemsForSection,
  shellSurfacesForPlacement,
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

  describe("settingsEntries", () => {
    it("every settingsEntries item is a well-formed nav item", () => {
      for (const m of MODULES) {
        for (const item of m.settingsEntries ?? []) {
          expect(item.labelKey).toBeTruthy();
          expect(item.href.startsWith("/")).toBe(true);
          expect(item.icon).toBeTruthy();
        }
      }
    });

    it("Stint contributes Categories and Templates to the settings hub", () => {
      const stint = getModule("stint");
      const hrefs = (stint?.settingsEntries ?? []).map((i) => i.href);
      expect(hrefs).toEqual(["/categories", "/templates"]);
    });

    it("Integrations contributes /settings/integrations to the settings hub with no sidebar presence", () => {
      const integrations = getModule("integrations");
      expect(integrations).toBeDefined();
      // No top-level sidebar entry — reached only via the settings hub.
      expect(integrations?.navItems).toEqual([]);
      expect(
        (integrations?.settingsEntries ?? []).map((i) => i.href),
      ).toEqual(["/settings/integrations"]);
    });

    it("settingsEntries hrefs are unique across all modules", () => {
      const hrefs = MODULES.flatMap((m) =>
        (m.settingsEntries ?? []).map((i) => i.href),
      );
      expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    it("a module with no settingsEntries has no sidebar-nav coupling requirement (navItems can be non-empty independently)", () => {
      // Sanity: modules without settingsEntries (e.g. customers) are
      // untouched by this feature — settingsEntries is purely additive.
      const customers = getModule("customers");
      expect(customers?.settingsEntries).toBeUndefined();
    });
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

    it("navItemsForSection merges modules, shell surfaces, and platform tools", () => {
      const setup = navItemsForSection("setup");
      const hrefs = setup.map((i) => i.href);
      // Module
      expect(hrefs).toContain("/business");
      // Shell surfaces
      expect(hrefs).toContain("/teams");
      expect(hrefs).toContain("/settings");
      // Platform tool
      expect(hrefs).toContain("/import");
    });

    it("setup section preserves the pre-SHELL_SURFACES sidebar order", () => {
      // Representation refactor invariant: moving Teams/Settings out
      // of MODULES must not reorder the rendered sidebar.
      expect(navItemsForSection("setup").map((i) => i.href)).toEqual([
        "/business",
        "/teams",
        "/settings",
        "/import",
      ]);
    });
  });

  describe("shell surfaces", () => {
    it("each surface has a valid placement and complete nav item", () => {
      for (const s of SHELL_SURFACES) {
        expect(s.id).toBeTruthy();
        expect(["track", "manage", "setup", "home", "identity", "system"]).toContain(
          s.placement,
        );
        expect(s.navItem.labelKey).toBeTruthy();
        expect(s.navItem.href.startsWith("/")).toBe(true);
        expect(s.navItem.icon).toBeTruthy();
      }
    });

    it("Teams and Settings are shell surfaces, NOT modules", () => {
      // Architectural invariant: always-on platform pages can't be
      // toggled off and own no vertical domain — registering them in
      // MODULES would dilute what "module" means.
      expect(getModule("teams")).toBeUndefined();
      expect(getModule("settings")).toBeUndefined();
      const ids = SHELL_SURFACES.map((s) => s.id);
      expect(ids).toContain("teams");
      expect(ids).toContain("settings");
    });

    it("always-on chrome (dashboard / profile / docs / system) is registered", () => {
      const byId = new Map(SHELL_SURFACES.map((s) => [s.id, s]));
      expect(byId.get("dashboard")?.navItem.href).toBe("/");
      expect(byId.get("dashboard")?.placement).toBe("home");
      expect(byId.get("profile")?.placement).toBe("identity");
      expect(byId.get("docs")?.placement).toBe("identity");
      expect(byId.get("systemHub")?.navItem.href).toBe("/system");
    });

    it("only the system hub requires system admin", () => {
      for (const s of SHELL_SURFACES) {
        expect(Boolean(s.requiresSystemAdmin)).toBe(s.placement === "system");
      }
    });

    it("shellSurfacesForPlacement filters by placement in declaration order", () => {
      expect(shellSurfacesForPlacement("identity").map((s) => s.id)).toEqual([
        "profile",
        "docs",
      ]);
      expect(shellSurfacesForPlacement("home").map((s) => s.id)).toEqual([
        "dashboard",
      ]);
      expect(shellSurfacesForPlacement("track")).toEqual([]);
    });

    it("ids and hrefs are unique across modules, shell surfaces, and platform tools", () => {
      const ids = [
        ...MODULES.map((m) => m.id),
        ...SHELL_SURFACES.map((s) => s.id),
        ...PLATFORM_TOOLS.map((t) => t.id),
      ];
      expect(new Set(ids).size).toBe(ids.length);
      const hrefs = [
        ...MODULES.flatMap((m) => m.navItems.map((i) => i.href)),
        ...SHELL_SURFACES.map((s) => s.navItem.href),
        ...PLATFORM_TOOLS.map((t) => t.navItem.href),
      ];
      expect(new Set(hrefs).size).toBe(hrefs.length);
    });
  });
});
