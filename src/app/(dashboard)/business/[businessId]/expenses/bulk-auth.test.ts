import { describe, it, expect } from "vitest";
import { filterAuthorizedExpenseIds } from "./bulk-auth";

const rows = [
  { id: "e1", team_id: "tA", user_id: "alice" },
  { id: "e2", team_id: "tA", user_id: "bob" },
  { id: "e3", team_id: "tB", user_id: "alice" },
  { id: "e4", team_id: "tB", user_id: "carol" },
];

describe("filterAuthorizedExpenseIds", () => {
  it("returns rows authored by the caller regardless of role", () => {
    const roles = new Map([["tA", "member"], ["tB", "member"]]);
    expect(
      filterAuthorizedExpenseIds(rows, "alice", roles),
    ).toEqual(["e1", "e3"]);
  });

  it("includes every row in a team where caller is owner", () => {
    const roles = new Map([["tA", "owner"], ["tB", "member"]]);
    expect(
      filterAuthorizedExpenseIds(rows, "alice", roles),
    ).toEqual(["e1", "e2", "e3"]);
  });

  it("admin role is also authorized for every row in their team", () => {
    const roles = new Map([["tA", "admin"], ["tB", "admin"]]);
    expect(
      filterAuthorizedExpenseIds(rows, "alice", roles),
    ).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("members can only mutate their own rows", () => {
    const roles = new Map([["tA", "member"], ["tB", "member"]]);
    expect(
      filterAuthorizedExpenseIds(rows, "bob", roles),
    ).toEqual(["e2"]);
  });

  it("missing role for a team defaults to member (not authorized for non-author)", () => {
    const roles = new Map([["tA", "owner"]]);
    expect(
      filterAuthorizedExpenseIds(rows, "bob", roles),
    ).toEqual(["e1", "e2"]);
  });

  it("returns empty when no rows match", () => {
    const roles = new Map([["tA", "member"], ["tB", "member"]]);
    expect(
      filterAuthorizedExpenseIds(rows, "stranger", roles),
    ).toEqual([]);
  });

  it("preserves input order in the output", () => {
    const reordered = [rows[3]!, rows[0]!, rows[2]!, rows[1]!];
    const roles = new Map([["tA", "owner"], ["tB", "owner"]]);
    expect(
      filterAuthorizedExpenseIds(reordered, "alice", roles),
    ).toEqual(["e4", "e1", "e3", "e2"]);
  });
});
