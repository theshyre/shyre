import { describe, it, expect } from "vitest";
import {
  expandProjectFilter,
  countSubProjects,
} from "./expand-filter";

const leaf = (id: string) => ({ id, parent_project_id: null });
const child = (id: string, parent: string) => ({
  id,
  parent_project_id: parent,
});

describe("expandProjectFilter", () => {
  it("returns just the selected id when the project has no children (leaf)", () => {
    const projects = [leaf("alpha"), leaf("beta"), leaf("gamma")];
    expect(expandProjectFilter(projects, "beta")).toEqual(["beta"]);
  });

  it("returns parent + children when selecting a parent project", () => {
    const projects = [
      leaf("engagement"),
      child("phase-1", "engagement"),
      child("phase-2", "engagement"),
    ];
    expect(expandProjectFilter(projects, "engagement").sort()).toEqual([
      "engagement",
      "phase-1",
      "phase-2",
    ]);
  });

  it("does NOT include sibling parents' children", () => {
    const projects = [
      leaf("engagement-a"),
      child("phase-a1", "engagement-a"),
      leaf("engagement-b"),
      child("phase-b1", "engagement-b"),
    ];
    expect(expandProjectFilter(projects, "engagement-a").sort()).toEqual([
      "engagement-a",
      "phase-a1",
    ]);
  });

  it("returns just the child when selecting a leaf with a parent (no rollup down — leaves have no descendants)", () => {
    const projects = [
      leaf("engagement"),
      child("phase-1", "engagement"),
      child("phase-2", "engagement"),
    ];
    expect(expandProjectFilter(projects, "phase-1")).toEqual(["phase-1"]);
  });

  it("treats an unknown selected id as a leaf — passes it through so .in() still works", () => {
    const projects = [leaf("a"), leaf("b")];
    expect(expandProjectFilter(projects, "ghost-id")).toEqual(["ghost-id"]);
  });

  it("handles an empty projects list (nothing to expand into)", () => {
    expect(expandProjectFilter([], "anything")).toEqual(["anything"]);
  });

  it("preserves the parent's id at index 0 — caller can rely on selectedId being first", () => {
    const projects = [
      leaf("engagement"),
      child("phase-1", "engagement"),
      child("phase-2", "engagement"),
    ];
    const result = expandProjectFilter(projects, "engagement");
    expect(result[0]).toBe("engagement");
  });
});

describe("countSubProjects", () => {
  it("returns 0 for a leaf project", () => {
    expect(countSubProjects([leaf("a")], "a")).toBe(0);
  });

  it("returns the count of direct children for a parent", () => {
    const projects = [
      leaf("engagement"),
      child("phase-1", "engagement"),
      child("phase-2", "engagement"),
      child("phase-3", "engagement"),
    ];
    expect(countSubProjects(projects, "engagement")).toBe(3);
  });

  it("only counts direct children, not siblings of the selected project", () => {
    const projects = [
      leaf("engagement-a"),
      child("phase-a1", "engagement-a"),
      leaf("engagement-b"),
      child("phase-b1", "engagement-b"),
    ];
    expect(countSubProjects(projects, "engagement-a")).toBe(1);
  });
});
