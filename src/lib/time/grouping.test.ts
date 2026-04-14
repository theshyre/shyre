import { describe, it, expect } from "vitest";
import { groupEntries, type GroupableEntry } from "./grouping";

const projects = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
];

const categories = [
  { id: "c1", name: "Feature", color: "#3b82f6", sort_order: 10 },
  { id: "c2", name: "Bug fix", color: "#ef4444", sort_order: 20 },
];

const ctx = {
  projects,
  categories,
  uncategorizedLabel: "Uncategorized",
};

function entry(
  id: string,
  opts: {
    project?: string;
    category?: string | null;
    start: Date;
    min?: number;
    billable?: boolean;
  },
): GroupableEntry {
  const duration = opts.min ?? 60;
  const end = new Date(opts.start.getTime() + duration * 60 * 1000);
  return {
    id,
    project_id: opts.project ?? "p1",
    category_id: opts.category === undefined ? null : opts.category,
    start_time: opts.start.toISOString(),
    end_time: end.toISOString(),
    duration_min: duration,
    billable: opts.billable ?? true,
  };
}

describe("groupEntries", () => {
  describe("by day", () => {
    it("buckets entries into date groups and computes totals", () => {
      const e1 = entry("e1", { start: new Date(2026, 3, 13, 9) });
      const e2 = entry("e2", { start: new Date(2026, 3, 13, 14), min: 30 });
      const e3 = entry("e3", { start: new Date(2026, 3, 15, 10) });
      const groups = groupEntries([e1, e2, e3], "day", ctx);
      expect(groups).toHaveLength(2);
      expect(groups[0]?.entries).toHaveLength(2);
      expect(groups[0]?.totalMin).toBe(90);
      expect(groups[1]?.entries).toHaveLength(1);
    });

    it("sorts groups chronologically", () => {
      const older = entry("a", { start: new Date(2026, 3, 10) });
      const newer = entry("b", { start: new Date(2026, 3, 20) });
      const groups = groupEntries([newer, older], "day", ctx);
      expect(groups[0]?.entries[0]?.id).toBe("a");
      expect(groups[1]?.entries[0]?.id).toBe("b");
    });

    it("sorts entries within a day chronologically", () => {
      const later = entry("later", { start: new Date(2026, 3, 13, 14) });
      const earlier = entry("earlier", { start: new Date(2026, 3, 13, 9) });
      const [group] = groupEntries([later, earlier], "day", ctx);
      expect(group?.entries.map((e) => e.id)).toEqual(["earlier", "later"]);
    });
  });

  describe("by category", () => {
    it("buckets by category and respects sort_order", () => {
      const e1 = entry("e1", { category: "c2", start: new Date(2026, 3, 13, 9) });
      const e2 = entry("e2", { category: "c1", start: new Date(2026, 3, 13, 10) });
      const groups = groupEntries([e1, e2], "category", ctx);
      expect(groups[0]?.label).toBe("Feature");
      expect(groups[1]?.label).toBe("Bug fix");
    });

    it("puts uncategorized last", () => {
      const e1 = entry("e1", { category: "c1", start: new Date(2026, 3, 13, 9) });
      const e2 = entry("e2", { category: null, start: new Date(2026, 3, 13, 10) });
      const groups = groupEntries([e1, e2], "category", ctx);
      expect(groups[0]?.label).toBe("Feature");
      expect(groups[1]?.label).toBe("Uncategorized");
    });

    it("only emits uncategorized when some entries lack a category", () => {
      const e1 = entry("e1", { category: "c1", start: new Date(2026, 3, 13, 9) });
      const groups = groupEntries([e1], "category", ctx);
      expect(groups).toHaveLength(1);
    });

    it("sums billable minutes separately", () => {
      const e1 = entry("e1", { category: "c1", start: new Date(2026, 3, 13, 9), billable: true, min: 60 });
      const e2 = entry("e2", { category: "c1", start: new Date(2026, 3, 13, 10), billable: false, min: 30 });
      const [group] = groupEntries([e1, e2], "category", ctx);
      expect(group?.totalMin).toBe(90);
      expect(group?.billableMin).toBe(60);
    });

    it("attaches color from the category definition", () => {
      const e1 = entry("e1", { category: "c1", start: new Date(2026, 3, 13, 9) });
      const [group] = groupEntries([e1], "category", ctx);
      expect(group?.color).toBe("#3b82f6");
    });
  });

  describe("by project", () => {
    it("buckets by project and sorts A..Z", () => {
      const a = entry("a", { project: "p2", start: new Date(2026, 3, 13, 9) });
      const b = entry("b", { project: "p1", start: new Date(2026, 3, 13, 10) });
      const groups = groupEntries([a, b], "project", ctx);
      expect(groups[0]?.label).toBe("Alpha");
      expect(groups[1]?.label).toBe("Beta");
    });

    it("falls back to '—' for unknown project", () => {
      const e = entry("e", { project: "ghost", start: new Date(2026, 3, 13, 9) });
      const [group] = groupEntries([e], "project", ctx);
      expect(group?.label).toBe("—");
    });
  });
});
