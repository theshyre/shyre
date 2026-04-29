import { describe, it, expect } from "vitest";
import {
  isOwnerOfEveryTeam,
  ownsAnotherBusiness,
  expectedConfirmName,
} from "./delete-checks";

describe("isOwnerOfEveryTeam", () => {
  it("returns true when caller owns every team in the list", () => {
    expect(
      isOwnerOfEveryTeam(
        ["t1", "t2"],
        [
          { team_id: "t1", role: "owner" },
          { team_id: "t2", role: "owner" },
        ],
      ),
    ).toBe(true);
  });

  it("returns false when caller is admin on one of the teams", () => {
    expect(
      isOwnerOfEveryTeam(
        ["t1", "t2"],
        [
          { team_id: "t1", role: "owner" },
          { team_id: "t2", role: "admin" },
        ],
      ),
    ).toBe(false);
  });

  it("returns false when caller is missing from one of the teams", () => {
    expect(
      isOwnerOfEveryTeam(
        ["t1", "t2"],
        [{ team_id: "t1", role: "owner" }],
      ),
    ).toBe(false);
  });

  it("returns false on empty teamIds — deletes a business with no teams must be refused", () => {
    expect(isOwnerOfEveryTeam([], [])).toBe(false);
  });

  it("ignores extra owner memberships on unrelated teams", () => {
    expect(
      isOwnerOfEveryTeam(
        ["t1"],
        [
          { team_id: "t1", role: "owner" },
          { team_id: "tX", role: "owner" },
        ],
      ),
    ).toBe(true);
  });
});

describe("ownsAnotherBusiness", () => {
  it("returns true when caller owns a team in a different business", () => {
    expect(
      ownsAnotherBusiness(
        [
          { id: "t1", business_id: "bA" },
          { id: "t2", business_id: "bB" },
        ],
        "bA",
      ),
    ).toBe(true);
  });

  it("returns false when caller only owns teams in the business being deleted", () => {
    expect(
      ownsAnotherBusiness(
        [
          { id: "t1", business_id: "bA" },
          { id: "t2", business_id: "bA" },
        ],
        "bA",
      ),
    ).toBe(false);
  });

  it("ignores personal teams (business_id null)", () => {
    expect(
      ownsAnotherBusiness(
        [
          { id: "tPersonal", business_id: null },
          { id: "t1", business_id: "bA" },
        ],
        "bA",
      ),
    ).toBe(false);
  });

  it("returns false on empty input", () => {
    expect(ownsAnotherBusiness([], "bA")).toBe(false);
  });
});

describe("expectedConfirmName", () => {
  it("prefers legal_name when both are set", () => {
    expect(expectedConfirmName("Acme LLC", "acme")).toBe("Acme LLC");
  });

  it("falls back to name when legal_name is null", () => {
    expect(expectedConfirmName(null, "acme")).toBe("acme");
  });

  it("returns empty string when both are null", () => {
    expect(expectedConfirmName(null, null)).toBe("");
  });

  it("treats empty legal_name as a value (does not skip to name)", () => {
    // legal_name is not null here — it's an empty string. The
    // fallback chain uses ?? not ||, so this returns "". The
    // action then refuses because the expected name is empty.
    expect(expectedConfirmName("", "acme")).toBe("");
  });
});
