import { describe, it, expect } from "vitest";
import { shouldFlipPresetToSinceLast } from "./new-invoice-form";

describe("shouldFlipPresetToSinceLast", () => {
  it("flips when preset is 'all' AND customer has prior invoice", () => {
    expect(shouldFlipPresetToSinceLast("all", true)).toBe(true);
  });

  it("does NOT flip when customer has no prior invoice (no anchor)", () => {
    // No last-invoice anchor means "sinceLastInvoice" would
    // fall back to "all" anyway — flipping would just thrash
    // the radio without changing what the preview shows.
    expect(shouldFlipPresetToSinceLast("all", false)).toBe(false);
  });

  it("does NOT override a deliberate 'thisMonth' choice", () => {
    expect(shouldFlipPresetToSinceLast("thisMonth", true)).toBe(false);
  });

  it("does NOT override 'lastMonth'", () => {
    expect(shouldFlipPresetToSinceLast("lastMonth", true)).toBe(false);
  });

  it("does NOT override 'last30Days'", () => {
    expect(shouldFlipPresetToSinceLast("last30Days", true)).toBe(false);
  });

  it("does NOT override 'custom'", () => {
    expect(shouldFlipPresetToSinceLast("custom", true)).toBe(false);
  });

  it("is a no-op when already on 'sinceLastInvoice'", () => {
    expect(shouldFlipPresetToSinceLast("sinceLastInvoice", true)).toBe(false);
    expect(shouldFlipPresetToSinceLast("sinceLastInvoice", false)).toBe(false);
  });
});
