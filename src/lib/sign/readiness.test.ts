import { describe, it, expect } from "vitest";
import {
  signoffSendReadiness,
  isSignoffEditable,
  isSignoffDeletable,
} from "./readiness";

describe("signoffSendReadiness", () => {
  it("is empty when title + body + a signer are all present", () => {
    expect(
      signoffSendReadiness({ title: "v2.0.2", bodyMarkdown: "# Notes", signerCount: 1 }),
    ).toEqual([]);
  });

  it("flags each missing piece", () => {
    expect(
      signoffSendReadiness({ title: "  ", bodyMarkdown: "", signerCount: 0 }),
    ).toEqual(["titleMissing", "bodyEmpty", "noSigners"]);
  });

  it("treats null/undefined title + body as missing", () => {
    expect(
      signoffSendReadiness({ title: null, bodyMarkdown: undefined, signerCount: 2 }),
    ).toEqual(["titleMissing", "bodyEmpty"]);
  });
});

describe("isSignoffEditable / isSignoffDeletable", () => {
  it("only a draft is editable", () => {
    expect(isSignoffEditable("draft")).toBe(true);
    for (const s of ["sent", "viewed", "completed", "declined", "superseded", "canceled"]) {
      expect(isSignoffEditable(s)).toBe(false);
    }
  });

  it("draft and canceled are deletable; sent/completed are not", () => {
    expect(isSignoffDeletable("draft")).toBe(true);
    expect(isSignoffDeletable("canceled")).toBe(true);
    expect(isSignoffDeletable("sent")).toBe(false);
    expect(isSignoffDeletable("completed")).toBe(false);
  });
});
