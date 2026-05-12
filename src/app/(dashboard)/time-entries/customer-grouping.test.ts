import { describe, it, expect } from "vitest";
import { groupEntriesByCustomer } from "./customer-grouping";
import type { ProjectOption, TimeEntry } from "./types";

const labels = { internal: "Internal", noCustomer: "No customer" };

function entry(id: string, projectId: string, startIso: string, dur = 60): TimeEntry {
  const end = new Date(new Date(startIso).getTime() + dur * 60_000).toISOString();
  return {
    id,
    team_id: "o1",
    user_id: "u1",
    project_id: projectId,
    description: null,
    start_time: startIso,
    end_time: end,
    duration_min: dur,
    billable: true,
    github_issue: null,
    linked_ticket_provider: null,
    linked_ticket_key: null,
    linked_ticket_url: null,
    linked_ticket_title: null,
    linked_ticket_refreshed_at: null,
    invoiced: false,
    invoice_id: null,
    invoice_number: null,
    category_id: null,
    projects: { id: projectId, name: "—", github_repo: null },
    author: null,
  };
}

const baseProject: Omit<ProjectOption, "id" | "name"> = {
  github_repo: null,
  jira_project_key: null,
  team_id: "o1",
  category_set_id: null,
  require_timestamps: false,
};

describe("groupEntriesByCustomer", () => {
  it("returns an empty array when there are no entries", () => {
    expect(groupEntriesByCustomer([], [], labels)).toEqual([]);
  });

  it("buckets entries by their project's customer", () => {
    const projects: ProjectOption[] = [
      { ...baseProject, id: "p1", name: "P1", customers: { id: "c1", name: "Acme" } },
      { ...baseProject, id: "p2", name: "P2", customers: { id: "c2", name: "Beta" } },
    ];
    const entries = [
      entry("a", "p1", "2026-05-12T09:00:00Z"),
      entry("b", "p1", "2026-05-12T10:00:00Z"),
      entry("c", "p2", "2026-05-12T11:00:00Z"),
    ];
    const groups = groupEntriesByCustomer(entries, projects, labels);
    expect(groups).toHaveLength(2);
    const acme = groups.find((g) => g.customerId === "c1");
    expect(acme?.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(acme?.totalMin).toBe(120);
    expect(groups.find((g) => g.customerId === "c2")?.entries.map((e) => e.id)).toEqual(["c"]);
  });

  it("sorts groups: named customers alpha → Internal → no-customer", () => {
    const projects: ProjectOption[] = [
      { ...baseProject, id: "p-int", name: "Int", is_internal: true },
      { ...baseProject, id: "p-z", name: "Z", customers: { id: "c-z", name: "Zenith" } },
      { ...baseProject, id: "p-none", name: "Orphan" },
      { ...baseProject, id: "p-a", name: "A", customers: { id: "c-a", name: "Apex" } },
    ];
    const entries = [
      entry("a", "p-int", "2026-05-12T09:00:00Z"),
      entry("b", "p-z", "2026-05-12T10:00:00Z"),
      entry("c", "p-none", "2026-05-12T11:00:00Z"),
      entry("d", "p-a", "2026-05-12T12:00:00Z"),
    ];
    const groups = groupEntriesByCustomer(entries, projects, labels);
    expect(groups.map((g) => g.label)).toEqual([
      "Apex",
      "Zenith",
      "Internal",
      "No customer",
    ]);
    expect(groups[2]?.isInternalCustomer).toBe(true);
    expect(groups[3]?.isInternalCustomer).toBe(false);
  });

  it("sorts entries chronologically within each customer group", () => {
    const projects: ProjectOption[] = [
      { ...baseProject, id: "p1", name: "P1", customers: { id: "c1", name: "Acme" } },
    ];
    const entries = [
      entry("late", "p1", "2026-05-12T15:00:00Z"),
      entry("early", "p1", "2026-05-12T09:00:00Z"),
      entry("mid", "p1", "2026-05-12T12:00:00Z"),
    ];
    const groups = groupEntriesByCustomer(entries, projects, labels);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["early", "mid", "late"]);
  });

  it("assigns a railColor on every group (var(--edge) fallback for internal / no-customer)", () => {
    const projects: ProjectOption[] = [
      { ...baseProject, id: "p1", name: "P1", customers: { id: "c1", name: "Acme" } },
      { ...baseProject, id: "p2", name: "P2", is_internal: true },
      { ...baseProject, id: "p3", name: "P3" },
    ];
    const entries = [
      entry("a", "p1", "2026-05-12T09:00:00Z"),
      entry("b", "p2", "2026-05-12T10:00:00Z"),
      entry("c", "p3", "2026-05-12T11:00:00Z"),
    ];
    const groups = groupEntriesByCustomer(entries, projects, labels);
    for (const g of groups) {
      expect(g.railColor).toBeTruthy();
    }
    expect(groups[1]?.railColor).toBe("var(--edge)");
    expect(groups[2]?.railColor).toBe("var(--edge)");
  });
});
