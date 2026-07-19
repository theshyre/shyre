// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { isTextEditingTarget } from "./is-text-editing-target";

function input(type: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  return el;
}

describe("isTextEditingTarget", () => {
  it("returns true for text-like input types", () => {
    for (const type of ["text", "search", "email", "url", "password", "number"]) {
      expect(isTextEditingTarget(input(type))).toBe(true);
    }
  });

  it("returns false for checkbox and radio inputs (rule 5: checkboxes are inputs, not text editors)", () => {
    expect(isTextEditingTarget(input("checkbox"))).toBe(false);
    expect(isTextEditingTarget(input("radio"))).toBe(false);
  });

  it("returns false for button-like and non-caret input types", () => {
    for (const type of ["button", "submit", "reset", "range", "color", "file", "image"]) {
      expect(isTextEditingTarget(input(type))).toBe(false);
    }
  });

  it("returns true for textareas", () => {
    expect(isTextEditingTarget(document.createElement("textarea"))).toBe(true);
  });

  it("returns true for contenteditable elements", () => {
    const div = document.createElement("div");
    // jsdom doesn't compute isContentEditable from the attribute in all
    // versions — define it explicitly so the behavior under test is the
    // helper's branch, not jsdom's attribute reflection.
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isTextEditingTarget(div)).toBe(true);
  });

  it("returns false for plain elements, selects, and null", () => {
    expect(isTextEditingTarget(document.createElement("div"))).toBe(false);
    expect(isTextEditingTarget(document.createElement("select"))).toBe(false);
    expect(isTextEditingTarget(document.createElement("button"))).toBe(false);
    expect(isTextEditingTarget(null)).toBe(false);
  });
});
