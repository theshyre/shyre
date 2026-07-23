import { describe, it, expect } from "vitest";

import { resolveProjectInheritance } from "./inherit";

interface Row {
  id: string;
  parent_project_id: string | null;
  category_set_id: string | null;
  extension_category_set_id: string | null;
  default_category_id?: string | null;
  jira_project_key: string | null;
  name?: string;
}

const umbrella: Row = {
  id: "u1",
  parent_project_id: null,
  category_set_id: "cs-consulting",
  extension_category_set_id: "cs-u1-ext",
  default_category_id: "cat-eng",
  jira_project_key: "AE",
  name: "AVDR eClinical",
};

describe("resolveProjectInheritance", () => {
  it("a set-less child inherits the parent's whole category vocabulary (base + extension + default) and jira key", () => {
    const child: Row = {
      id: "c1",
      parent_project_id: "u1",
      category_set_id: null,
      extension_category_set_id: null,
      default_category_id: null,
      jira_project_key: null,
      name: "Basic dependency upgrades",
    };
    const [, resolved] = resolveProjectInheritance([umbrella, child]);
    expect(resolved).toMatchObject({
      category_set_id: "cs-consulting",
      extension_category_set_id: "cs-u1-ext",
      default_category_id: "cat-eng",
      jira_project_key: "AE",
    });
  });

  it("a child with its OWN base set keeps its whole vocabulary — no parent mixing", () => {
    const child: Row = {
      id: "c2",
      parent_project_id: "u1",
      category_set_id: "cs-own",
      extension_category_set_id: null,
      default_category_id: null,
      jira_project_key: null,
    };
    const [, resolved] = resolveProjectInheritance([umbrella, child]);
    expect(resolved?.category_set_id).toBe("cs-own");
    expect(resolved?.extension_category_set_id).toBeNull();
    expect(resolved?.default_category_id).toBeNull();
    // Jira inheritance is independent of the category vocabulary.
    expect(resolved?.jira_project_key).toBe("AE");
  });

  it("an explicit child jira key overrides the parent's", () => {
    const child: Row = {
      id: "c3",
      parent_project_id: "u1",
      category_set_id: null,
      extension_category_set_id: null,
      jira_project_key: "SUB",
    };
    const [, resolved] = resolveProjectInheritance([umbrella, child]);
    expect(resolved?.jira_project_key).toBe("SUB");
  });

  it("top-level projects and children of absent parents pass through unchanged", () => {
    const orphan: Row = {
      id: "c4",
      parent_project_id: "gone",
      category_set_id: null,
      extension_category_set_id: null,
      jira_project_key: null,
    };
    const rows = resolveProjectInheritance([umbrella, orphan]);
    expect(rows[0]).toEqual(umbrella);
    expect(rows[1]).toEqual(orphan);
  });

  it("does not mutate the input rows", () => {
    const child: Row = {
      id: "c5",
      parent_project_id: "u1",
      category_set_id: null,
      extension_category_set_id: null,
      jira_project_key: null,
    };
    resolveProjectInheritance([umbrella, child]);
    expect(child.category_set_id).toBeNull();
    expect(child.jira_project_key).toBeNull();
  });

  it("keeps a child's own extension set while inheriting the parent's base set", () => {
    const child: Row = {
      id: "c6",
      parent_project_id: "u1",
      category_set_id: null,
      extension_category_set_id: "cs-c6-ext",
      default_category_id: null,
      jira_project_key: null,
    };
    const [, resolved] = resolveProjectInheritance([umbrella, child]);
    expect(resolved?.category_set_id).toBe("cs-consulting");
    expect(resolved?.extension_category_set_id).toBe("cs-c6-ext");
  });
});
