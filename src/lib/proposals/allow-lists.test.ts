import { describe, it, expect } from "vitest";
import {
  PROPOSAL_STATUSES,
  ALLOWED_PROPOSAL_STATUSES,
  TERMINAL_PROPOSAL_STATUSES,
  isProposalEditable,
  isProposalDeletable,
  isProposalDeliverable,
  DEPOSIT_TYPES,
  ALLOWED_DEPOSIT_TYPES,
} from "./allow-lists";

describe("proposal allow-lists", () => {
  it("exposes the seven lifecycle statuses in order", () => {
    expect(PROPOSAL_STATUSES).toEqual([
      "draft",
      "sent",
      "viewed",
      "accepted",
      "declined",
      "converted",
      "superseded",
    ]);
    expect(ALLOWED_PROPOSAL_STATUSES).toEqual(new Set(PROPOSAL_STATUSES));
  });

  it("marks terminal statuses that accept no further transitions", () => {
    expect([...TERMINAL_PROPOSAL_STATUSES].sort()).toEqual([
      "converted",
      "declined",
      "superseded",
    ]);
  });

  it("only a draft is editable", () => {
    expect(isProposalEditable("draft")).toBe(true);
    for (const s of ["sent", "viewed", "accepted", "declined", "converted", "superseded"]) {
      expect(isProposalEditable(s)).toBe(false);
    }
    expect(isProposalEditable(null)).toBe(false);
    expect(isProposalEditable(undefined)).toBe(false);
  });

  it("draft and superseded are deletable; audit-record statuses are not", () => {
    expect(isProposalDeletable("draft")).toBe(true);
    expect(isProposalDeletable("superseded")).toBe(true);
    for (const s of ["sent", "viewed", "accepted", "declined", "converted"]) {
      expect(isProposalDeletable(s)).toBe(false);
    }
    expect(isProposalDeletable(null)).toBe(false);
    expect(isProposalDeletable(undefined)).toBe(false);
  });

  it("only an undelivered converted proposal is deliverable", () => {
    expect(isProposalDeliverable("converted", false)).toBe(true);
    // Already delivered → not deliverable again (bulk skips it).
    expect(isProposalDeliverable("converted", true)).toBe(false);
    for (const s of ["draft", "sent", "viewed", "accepted", "declined", "superseded"]) {
      expect(isProposalDeliverable(s, false)).toBe(false);
    }
    expect(isProposalDeliverable(null, false)).toBe(false);
    expect(isProposalDeliverable(undefined, false)).toBe(false);
  });

  it("deletable and deliverable are disjoint (no row is both)", () => {
    // The two bulk actions can coexist because their eligibility never overlaps.
    for (const s of PROPOSAL_STATUSES) {
      expect(isProposalDeletable(s) && isProposalDeliverable(s, false)).toBe(false);
    }
  });

  it("exposes the deposit types", () => {
    expect(DEPOSIT_TYPES).toEqual(["none", "percent", "amount"]);
    expect(ALLOWED_DEPOSIT_TYPES).toEqual(new Set(["none", "percent", "amount"]));
  });
});
