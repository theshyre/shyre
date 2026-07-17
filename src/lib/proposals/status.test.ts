import { describe, it, expect } from "vitest";
import {
  isValidProposalStatusTransition,
  allowedNextProposalStatuses,
} from "./status";

describe("proposal status graph", () => {
  it("allows the forward path draft→sent→viewed→accepted→converted", () => {
    expect(isValidProposalStatusTransition("draft", "sent")).toBe(true);
    expect(isValidProposalStatusTransition("sent", "viewed")).toBe(true);
    expect(isValidProposalStatusTransition("viewed", "accepted")).toBe(true);
    expect(isValidProposalStatusTransition("accepted", "converted")).toBe(true);
  });

  it("allows accept/decline straight from sent (paper sign-off path)", () => {
    expect(isValidProposalStatusTransition("sent", "accepted")).toBe(true);
    expect(isValidProposalStatusTransition("sent", "declined")).toBe(true);
    expect(isValidProposalStatusTransition("viewed", "declined")).toBe(true);
  });

  it("rejects every reverse transition", () => {
    expect(isValidProposalStatusTransition("sent", "draft")).toBe(false);
    expect(isValidProposalStatusTransition("viewed", "sent")).toBe(false);
    expect(isValidProposalStatusTransition("accepted", "viewed")).toBe(false);
    expect(isValidProposalStatusTransition("converted", "accepted")).toBe(false);
  });

  it("terminal states allow nothing", () => {
    for (const terminal of ["declined", "converted", "superseded"]) {
      expect(allowedNextProposalStatuses(terminal)).toEqual([]);
    }
  });

  it("draft cannot skip straight to accepted or converted", () => {
    expect(isValidProposalStatusTransition("draft", "accepted")).toBe(false);
    expect(isValidProposalStatusTransition("draft", "converted")).toBe(false);
  });

  it("supersede is reachable from every pre-decision state only", () => {
    expect(isValidProposalStatusTransition("draft", "superseded")).toBe(true);
    expect(isValidProposalStatusTransition("sent", "superseded")).toBe(true);
    expect(isValidProposalStatusTransition("viewed", "superseded")).toBe(true);
    expect(isValidProposalStatusTransition("accepted", "superseded")).toBe(false);
  });

  it("handles unknown statuses without throwing", () => {
    expect(isValidProposalStatusTransition("bogus", "sent")).toBe(false);
    expect(allowedNextProposalStatuses("bogus")).toEqual([]);
  });
});
