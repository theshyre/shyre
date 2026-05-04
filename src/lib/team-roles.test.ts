import { describe, it, expect } from "vitest";
import { isTeamAdmin } from "./team-roles";

describe("isTeamAdmin", () => {
  it("returns true for owner", () => {
    expect(isTeamAdmin("owner")).toBe(true);
  });
  it("returns true for admin", () => {
    expect(isTeamAdmin("admin")).toBe(true);
  });
  it("returns false for member", () => {
    expect(isTeamAdmin("member")).toBe(false);
  });
});
