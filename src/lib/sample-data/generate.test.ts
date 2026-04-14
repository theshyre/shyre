import { describe, it, expect } from "vitest";
import { generateSampleData } from "./generate";

const FIXED_NOW = new Date("2026-04-14T15:00:00Z");

describe("generateSampleData", () => {
  it("is deterministic for the same (now, seed)", () => {
    const a = generateSampleData({ now: FIXED_NOW });
    const b = generateSampleData({ now: FIXED_NOW });
    expect(a).toEqual(b);
  });

  it("produces different output for different seeds", () => {
    const a = generateSampleData({ now: FIXED_NOW, seed: 1 });
    const b = generateSampleData({ now: FIXED_NOW, seed: 2 });
    // Customers + projects are fixed; only entries vary.
    expect(a.entries).not.toEqual(b.entries);
  });

  it("returns 4 customers and 6 projects", () => {
    const data = generateSampleData({ now: FIXED_NOW });
    expect(data.customers).toHaveLength(4);
    expect(data.projects).toHaveLength(6);
  });

  it("generates a reasonable number of entries (12 weeks worth)", () => {
    const data = generateSampleData({ now: FIXED_NOW });
    // ~18-32 per week × 12 weeks, minus future-clipped ones.
    expect(data.entries.length).toBeGreaterThan(150);
    expect(data.entries.length).toBeLessThan(500);
  });

  it("never produces entries in the future", () => {
    const data = generateSampleData({ now: FIXED_NOW });
    for (const e of data.entries) {
      expect(new Date(e.endIso).getTime()).toBeLessThanOrEqual(FIXED_NOW.getTime());
    }
  });

  it("produces entries chronologically sorted", () => {
    const data = generateSampleData({ now: FIXED_NOW });
    for (let i = 1; i < data.entries.length; i++) {
      expect(
        data.entries[i]!.startIso.localeCompare(data.entries[i - 1]!.startIso),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("produces non-zero-duration entries", () => {
    const data = generateSampleData({ now: FIXED_NOW });
    for (const e of data.entries) {
      const dur = new Date(e.endIso).getTime() - new Date(e.startIso).getTime();
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

  it("non-billable entries may appear on any project; billable entries only on rate-bearing projects", () => {
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

  it("produces a plausible number of expenses across 12 months", () => {
    const data = generateSampleData({ now: FIXED_NOW });
    // 12 months × ~6-16/month, minus future-clipped = ~70-190
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

  it("skews to weekdays", () => {
    const data = generateSampleData({ now: FIXED_NOW });
    let weekday = 0;
    let weekend = 0;
    for (const e of data.entries) {
      const day = new Date(e.startIso).getUTCDay();
      if (day === 0 || day === 6) weekend++;
      else weekday++;
    }
    // Weights are 5:5:5:5:4 weekdays vs 1:1 weekend → weekday fraction ≥ 80%
    expect(weekday / (weekday + weekend)).toBeGreaterThan(0.75);
  });
});
