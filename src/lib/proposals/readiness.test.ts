import { describe, it, expect } from "vitest";
import { proposalSendReadiness, isProposalSendable } from "./readiness";

const completeItem = {
  title: "Discovery",
  fixedPrice: 1000,
  phases: [],
};

describe("proposalSendReadiness", () => {
  it("returns no blockers for a complete, sendable draft", () => {
    const issues = proposalSendReadiness({
      title: "Website rebuild",
      signerContactId: "contact-1",
      items: [completeItem],
    });
    expect(issues).toEqual([]);
    expect(
      isProposalSendable({
        title: "Website rebuild",
        signerContactId: "contact-1",
        items: [completeItem],
      }),
    ).toBe(true);
  });

  it("flags a missing title", () => {
    const keys = proposalSendReadiness({
      title: "",
      signerContactId: "contact-1",
      items: [completeItem],
    }).map((i) => i.key);
    expect(keys).toContain("titleMissing");
  });

  it("treats a whitespace-only title as missing", () => {
    const keys = proposalSendReadiness({
      title: "   ",
      signerContactId: "contact-1",
      items: [completeItem],
    }).map((i) => i.key);
    expect(keys).toContain("titleMissing");
  });

  it("flags no line items", () => {
    const keys = proposalSendReadiness({
      title: "Named",
      signerContactId: "contact-1",
      items: [],
    }).map((i) => i.key);
    expect(keys).toContain("itemsRequired");
  });

  it("flags a missing signer contact", () => {
    const keys = proposalSendReadiness({
      title: "Named",
      signerContactId: null,
      items: [completeItem],
    }).map((i) => i.key);
    expect(keys).toContain("signerMissing");
  });

  it("surfaces a phase-sum mismatch with expected/actual params (delegated to the domain rule)", () => {
    const issues = proposalSendReadiness({
      title: "Named",
      signerContactId: "contact-1",
      items: [
        {
          title: "Build",
          fixedPrice: 1000,
          phases: [
            { title: "A", fixedPrice: 400 },
            { title: "B", fixedPrice: 300 }, // sums to 700, not 1000
          ],
        },
      ],
    });
    const mismatch = issues.find((i) => i.key === "phaseSumMismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch?.params).toMatchObject({ expected: 1000, actual: 700 });
  });

  it("accumulates every blocker for a blank draft (title, items, signer)", () => {
    const keys = proposalSendReadiness({
      title: null,
      signerContactId: null,
      items: [],
    }).map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining(["titleMissing", "itemsRequired", "signerMissing"]),
    );
    expect(isProposalSendable({ title: null, signerContactId: null, items: [] })).toBe(
      false,
    );
  });
});
