import { describe, it, expect } from "vitest";
import { generateSampleData } from "./generate";

const FIXED_NOW = new Date("2026-04-14T15:00:00Z");

describe("generateSampleData", () => {
  it("is deterministic for the same (now, seed)", () => {
    const a = generateSampleData({ now: FIXED_NOW });
    const b = generateSampleData({ now: FIXED_NOW });
    expect(a).toEqual(b);
  });

  it("produces different entries for different seeds", () => {
    const a = generateSampleData({ now: FIXED_NOW, seed: 1 });
    const b = generateSampleData({ now: FIXED_NOW, seed: 2 });
    expect(a.entries).not.toEqual(b.entries);
  });

  it("returns 4 customers and 6 projects", () => {
    const data = generateSampleData({ now: FIXED_NOW });
    expect(data.customers).toHaveLength(4);
    expect(data.projects).toHaveLength(6);
  });

  // ── Team settings ─────────────────────────────────────────────
  describe("teamSettings", () => {
    it("populates all four visibility / permission fields", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      expect(data.teamSettings).toHaveProperty("rate_visibility");
      expect(data.teamSettings).toHaveProperty("rate_editability");
      expect(data.teamSettings).toHaveProperty("time_entries_visibility");
      expect(data.teamSettings).toHaveProperty(
        "admins_can_set_rate_permissions",
      );
    });

    it("exercises non-default rate + time-entry visibility so the UI surfaces light up", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      expect(data.teamSettings.rate_visibility).not.toBe("owner");
      expect(data.teamSettings.time_entries_visibility).not.toBe("own_only");
    });

    it("enables admin delegation so the owner-delegation flow is demonstrable", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      expect(data.teamSettings.admins_can_set_rate_permissions).toBe(true);
    });
  });

  // ── Team members ──────────────────────────────────────────────
  describe("teamMembers", () => {
    it("generates at least one admin and at least two plain members", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const admins = data.teamMembers.filter((m) => m.role === "admin");
      const members = data.teamMembers.filter((m) => m.role === "member");
      expect(admins.length).toBeGreaterThanOrEqual(1);
      expect(members.length).toBeGreaterThanOrEqual(2);
    });

    it("gives each sample member a per-member default_rate", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const m of data.teamMembers) {
        expect(m.default_rate).toBeGreaterThan(0);
      }
    });

    it("spreads rate_visibility across the four levels to exercise the model", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const levels = new Set(data.teamMembers.map((m) => m.rate_visibility));
      // 'self' is the distinctive member-only level; exercising it proves
      // the UI treats member rates differently from team/project/customer.
      expect(levels.has("self")).toBe(true);
      // At least one member has tight 'owner' default for contrast.
      expect(levels.has("owner")).toBe(true);
    });

    it("gives each member a distinct slug so email generation is stable", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const slugs = new Set(data.teamMembers.map((m) => m.slug));
      expect(slugs.size).toBe(data.teamMembers.length);
    });
  });

  // ── Rate-visibility spread on other tables ────────────────────
  describe("rate visibility across objects", () => {
    it("customers span at least two visibility levels", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const levels = new Set(data.customers.map((c) => c.rate_visibility));
      expect(levels.size).toBeGreaterThanOrEqual(2);
    });

    it("projects span at least two visibility levels", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const levels = new Set(data.projects.map((p) => p.rate_visibility));
      expect(levels.size).toBeGreaterThanOrEqual(2);
    });

    it("at least one project has a non-null time_entries_visibility override", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const overrides = data.projects.filter(
        (p) => p.time_entries_visibility !== null,
      );
      expect(overrides.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Categories ────────────────────────────────────────────────
  describe("category sets + categories", () => {
    it("emits one team-scoped base set and at least one project-scoped extension", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const team = data.categorySets.filter((s) => s.scope === "team");
      const projectScoped = data.categorySets.filter(
        (s) => s.scope === "project",
      );
      expect(team.length).toBe(1);
      expect(projectScoped.length).toBeGreaterThanOrEqual(1);
    });

    it("emits multiple categories per set (no empty sets)", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const s of data.categorySets) {
        const kids = data.categories.filter((c) => c.setName === s.name);
        expect(kids.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("at least one project has baseCategorySet = null (uncategorized)", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const noSet = data.projects.filter((p) => p.baseCategorySet === null);
      expect(noSet.length).toBeGreaterThanOrEqual(1);
    });

    it("all other projects reference a real category set name", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const known = new Set(data.categorySets.map((s) => s.name));
      for (const p of data.projects) {
        if (p.baseCategorySet !== null) {
          expect(known.has(p.baseCategorySet)).toBe(true);
        }
      }
    });

    it("every project-extension set points at a real project name", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const projectNames = new Set(data.projects.map((p) => p.name));
      for (const s of data.categorySets) {
        if (s.scope === "project") {
          expect(s.extendsProjectName).not.toBeNull();
          expect(projectNames.has(s.extendsProjectName as string)).toBe(true);
        }
      }
    });
  });

  // ── Entries ──────────────────────────────────────────────────
  describe("entries", () => {
    it("generates a reasonable number of entries (12 weeks worth)", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      expect(data.entries.length).toBeGreaterThan(150);
      expect(data.entries.length).toBeLessThan(500);
    });

    it("never produces entries in the future", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const e of data.entries) {
        expect(new Date(e.endIso).getTime()).toBeLessThanOrEqual(
          FIXED_NOW.getTime(),
        );
      }
    });

    it("produces chronologically sorted entries", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (let i = 1; i < data.entries.length; i++) {
        expect(
          data.entries[i]!.startIso.localeCompare(data.entries[i - 1]!.startIso),
        ).toBeGreaterThanOrEqual(0);
      }
    });

    it("produces non-zero-duration entries up to 4 hours", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const e of data.entries) {
        const dur =
          new Date(e.endIso).getTime() - new Date(e.startIso).getTime();
        expect(dur).toBeGreaterThan(0);
        expect(dur).toBeLessThanOrEqual(4 * 60 * 60 * 1000);
      }
    });

    it("entries reference valid project indexes", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const e of data.entries) {
        expect(e.projectIndex).toBeGreaterThanOrEqual(0);
        expect(e.projectIndex).toBeLessThan(data.projects.length);
      }
    });

    it("memberIndex is either null (caller) or a real team-member index", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const e of data.entries) {
        if (e.memberIndex !== null) {
          expect(e.memberIndex).toBeGreaterThanOrEqual(0);
          expect(e.memberIndex).toBeLessThan(data.teamMembers.length);
        }
      }
    });

    it("billable entries only appear on rate-bearing projects", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const e of data.entries) {
        if (e.billable) {
          expect(data.projects[e.projectIndex]!.hourly_rate).not.toBeNull();
        }
      }
    });

    it("github_issue is only set for projects with a github_repo", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const e of data.entries) {
        if (e.github_issue !== null) {
          expect(data.projects[e.projectIndex]!.github_repo).not.toBeNull();
        }
      }
    });

    it("entries on uncategorized projects (baseCategorySet = null) never carry a category", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const e of data.entries) {
        const proj = data.projects[e.projectIndex]!;
        if (proj.baseCategorySet === null) {
          expect(e.categoryRef).toBeNull();
        }
      }
    });

    it("when an entry has a categoryRef, the referenced set + category exist", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const e of data.entries) {
        if (e.categoryRef) {
          const set = data.categorySets.find(
            (s) => s.name === e.categoryRef!.setName,
          );
          expect(set).toBeDefined();
          const cat = data.categories.find(
            (c) =>
              c.setName === e.categoryRef!.setName &&
              c.name === e.categoryRef!.categoryName,
          );
          expect(cat).toBeDefined();
        }
      }
    });

    it("skews to weekdays (≥75% Mon–Fri)", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      let weekday = 0;
      let weekend = 0;
      for (const e of data.entries) {
        const day = new Date(e.startIso).getUTCDay();
        if (day === 0 || day === 6) weekend++;
        else weekday++;
      }
      expect(weekday / (weekday + weekend)).toBeGreaterThan(0.75);
    });
  });

  // ── Invoices ─────────────────────────────────────────────────
  describe("invoices", () => {
    it("emits at least one draft and one sent invoice", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const draft = data.invoices.filter((i) => i.status === "draft");
      const sent = data.invoices.filter((i) => i.status === "sent");
      expect(draft.length).toBeGreaterThanOrEqual(1);
      expect(sent.length).toBeGreaterThanOrEqual(1);
    });

    it("every invoice points at a real customer", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const inv of data.invoices) {
        expect(inv.customerIndex).toBeGreaterThanOrEqual(0);
        expect(inv.customerIndex).toBeLessThan(data.customers.length);
      }
    });

    it("each invoice has a distinct invoice_number_suffix", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const suffixes = new Set(
        data.invoices.map((i) => i.invoice_number_suffix),
      );
      expect(suffixes.size).toBe(data.invoices.length);
    });
  });

  // ── Expenses (unchanged) ──────────────────────────────────────
  describe("expenses", () => {
    it("produces a plausible number across 12 months", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      expect(data.expenses.length).toBeGreaterThan(50);
      expect(data.expenses.length).toBeLessThan(250);
    });

    it("never produces expenses dated in the future", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      const todayStr = FIXED_NOW.toISOString().slice(0, 10);
      for (const e of data.expenses) {
        expect(e.incurredOn.localeCompare(todayStr)).toBeLessThanOrEqual(0);
      }
    });

    it("billable expenses reference a real project index", () => {
      const data = generateSampleData({ now: FIXED_NOW });
      for (const e of data.expenses) {
        if (e.billable) {
          expect(e.projectIndex).not.toBeNull();
          expect(e.projectIndex).toBeGreaterThanOrEqual(0);
          expect(e.projectIndex!).toBeLessThan(data.projects.length);
        }
      }
    });
  });
});
