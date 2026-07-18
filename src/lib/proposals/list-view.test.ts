import { describe, it, expect } from "vitest";
import {
  PROPOSAL_STATUS_FILTERS,
  parseProposalStatusFilter,
  proposalFilterStatuses,
  daysSinceIsoDate,
  isProposalExpired,
  summarizeOutstandingProposals,
  displayProposalTotal,
} from "./list-view";

describe("parseProposalStatusFilter", () => {
  it("accepts every declared filter value", () => {
    for (const f of PROPOSAL_STATUS_FILTERS) {
      expect(parseProposalStatusFilter(f)).toBe(f);
    }
  });

  it("falls back to all for unknown, empty, and missing values", () => {
    expect(parseProposalStatusFilter("bogus")).toBe("all");
    expect(parseProposalStatusFilter("")).toBe("all");
    expect(parseProposalStatusFilter(undefined)).toBe("all");
    // Raw DB statuses that are not buckets must not leak through.
    expect(parseProposalStatusFilter("viewed")).toBe("all");
    expect(parseProposalStatusFilter("superseded")).toBe("all");
  });

  it("takes the first value of an array param", () => {
    expect(parseProposalStatusFilter(["draft", "sent"])).toBe("draft");
  });
});

describe("proposalFilterStatuses", () => {
  it("returns null (no constraint) for all", () => {
    expect(proposalFilterStatuses("all")).toBeNull();
  });

  it("folds viewed into the sent bucket", () => {
    expect(proposalFilterStatuses("sent")).toEqual(["sent", "viewed"]);
  });

  it("folds superseded + converted into history", () => {
    expect(proposalFilterStatuses("history")).toEqual([
      "superseded",
      "converted",
    ]);
  });

  it("maps single-status buckets to themselves", () => {
    expect(proposalFilterStatuses("draft")).toEqual(["draft"]);
    expect(proposalFilterStatuses("accepted")).toEqual(["accepted"]);
    expect(proposalFilterStatuses("declined")).toEqual(["declined"]);
  });
});

describe("daysSinceIsoDate", () => {
  it("computes whole days between two dates", () => {
    expect(daysSinceIsoDate("2026-07-10", "2026-07-16")).toBe(6);
    expect(daysSinceIsoDate("2026-07-16", "2026-07-16")).toBe(0);
  });

  it("crosses month and year boundaries", () => {
    expect(daysSinceIsoDate("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysSinceIsoDate("2026-06-30", "2026-07-01")).toBe(1);
  });

  it("returns null for null, malformed, or future dates", () => {
    expect(daysSinceIsoDate(null, "2026-07-16")).toBeNull();
    expect(daysSinceIsoDate("not-a-date", "2026-07-16")).toBeNull();
    expect(daysSinceIsoDate("2026-07-16", "garbage")).toBeNull();
    expect(daysSinceIsoDate("2026-07-20", "2026-07-16")).toBeNull();
  });
});

describe("isProposalExpired", () => {
  it("is true for sent/viewed past valid_until", () => {
    expect(isProposalExpired("sent", "2026-07-15", "2026-07-16")).toBe(true);
    expect(isProposalExpired("viewed", "2026-07-15", "2026-07-16")).toBe(true);
  });

  it("is false on the valid_until day itself (still valid)", () => {
    expect(isProposalExpired("sent", "2026-07-16", "2026-07-16")).toBe(false);
  });

  it("is false without a valid_until", () => {
    expect(isProposalExpired("sent", null, "2026-07-16")).toBe(false);
  });

  it("never fires for non-in-flight statuses", () => {
    for (const status of [
      "draft",
      "accepted",
      "declined",
      "converted",
      "superseded",
    ]) {
      expect(isProposalExpired(status, "2020-01-01", "2026-07-16")).toBe(false);
    }
  });
});

describe("summarizeOutstandingProposals", () => {
  it("counts and sums only sent + viewed rows", () => {
    const result = summarizeOutstandingProposals([
      { status: "sent", total: 4950 },
      { status: "viewed", total: 1200.5 },
      { status: "draft", total: 999 },
      { status: "accepted", total: 999 },
      { status: "declined", total: 999 },
    ]);
    expect(result).toEqual({ count: 2, total: 6150.5 });
  });

  it("returns zeros for an empty or all-settled list", () => {
    expect(summarizeOutstandingProposals([])).toEqual({ count: 0, total: 0 });
    expect(
      summarizeOutstandingProposals([{ status: "converted", total: 10 }]),
    ).toEqual({ count: 0, total: 0 });
  });

  it("re-rounds float-addition noise to cents", () => {
    const result = summarizeOutstandingProposals([
      { status: "sent", total: 0.1 },
      { status: "sent", total: 0.2 },
    ]);
    expect(result.total).toBe(0.3);
  });
});

describe("displayProposalTotal", () => {
  it("prefers accepted_total for accepted and converted rows", () => {
    expect(displayProposalTotal("accepted", 5000, 3000)).toBe(3000);
    expect(displayProposalTotal("converted", 5000, 3000)).toBe(3000);
  });

  it("falls back to the full total when accepted_total is null", () => {
    expect(displayProposalTotal("accepted", 5000, null)).toBe(5000);
  });

  it("ignores accepted_total for other statuses", () => {
    expect(displayProposalTotal("sent", 5000, 3000)).toBe(5000);
    expect(displayProposalTotal("draft", 5000, 3000)).toBe(5000);
  });

  it("honors a legitimate zero accepted_total", () => {
    expect(displayProposalTotal("accepted", 5000, 0)).toBe(0);
  });
});
