import { describe, it, expect } from "vitest";
import { isTextEditingTarget } from "./is-text-editing-target";

function input(type?: string): HTMLInputElement {
  const el = document.createElement("input");
  if (type) el.type = type;
  return el;
}

describe("isTextEditingTarget", () => {
  it("treats text-editing input types as editing targets", () => {
    for (const type of ["text", "search", "date", "email", "number", "password", "url", "tel", "time"]) {
      expect(isTextEditingTarget(input(type)), type).toBe(true);
    }
  });

  it("treats a type-less input (default text) as an editing target", () => {
    expect(isTextEditingTarget(input())).toBe(true);
  });

  it("does NOT treat checkboxes, radios, or button-ish inputs as editing targets", () => {
    for (const type of ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "hidden"]) {
      expect(isTextEditingTarget(input(type)), type).toBe(false);
    }
  });

  it("treats textarea and select as editing targets", () => {
    expect(isTextEditingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTextEditingTarget(document.createElement("select"))).toBe(true);
  });

  it("treats contenteditable elements as editing targets", () => {
    const div = document.createElement("div");
    // jsdom doesn't compute isContentEditable from the attribute alone;
    // define the resolved property the way a browser would report it.
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isTextEditingTarget(div)).toBe(true);
  });

  it("is false for plain elements, document, and null", () => {
    expect(isTextEditingTarget(document.createElement("div"))).toBe(false);
    expect(isTextEditingTarget(document.body)).toBe(false);
    expect(isTextEditingTarget(null)).toBe(false);
  });
});
