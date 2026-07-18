import { describe, it, expect, afterEach } from "vitest";
import { anyDialogOpen } from "./dialog-open";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("anyDialogOpen", () => {
  it("is false with no dialog in the document", () => {
    document.body.innerHTML = "<div><button>x</button></div>";
    expect(anyDialogOpen()).toBe(false);
  });

  it("detects role=dialog, role=alertdialog, and aria-modal", () => {
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(anyDialogOpen()).toBe(true);
    document.body.innerHTML = '<div role="alertdialog"></div>';
    expect(anyDialogOpen()).toBe(true);
    document.body.innerHTML = '<div aria-modal="true"></div>';
    expect(anyDialogOpen()).toBe(true);
  });
});
