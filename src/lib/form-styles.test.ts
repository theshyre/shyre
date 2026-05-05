import { describe, it, expect } from "vitest";
import {
  inputClass,
  textareaClass,
  searchInputClass,
  selectClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDangerClass,
  buttonGhostClass,
  kbdClass,
} from "./form-styles";

describe("form-styles", () => {
  describe("inputClass", () => {
    it("includes border and background tokens", () => {
      expect(inputClass).toContain("border-edge");
      expect(inputClass).toContain("bg-surface-raised");
    });

    it("includes focus ring styles", () => {
      expect(inputClass).toContain("focus:ring-2");
      expect(inputClass).toContain("focus:ring-focus-ring/30");
    });

    it("includes hover state", () => {
      expect(inputClass).toContain("hover:border-content-muted");
    });

    it("includes disabled state", () => {
      expect(inputClass).toContain("disabled:cursor-not-allowed");
      expect(inputClass).toContain("disabled:opacity-60");
    });

    it("includes placeholder styling", () => {
      expect(inputClass).toContain("placeholder:text-content-muted");
    });
  });

  describe("textareaClass", () => {
    it("extends inputClass with resize-none", () => {
      expect(textareaClass).toContain("resize-none");
      expect(textareaClass).toContain("border-edge");
    });
  });

  describe("searchInputClass", () => {
    it("has left padding for search icon", () => {
      expect(searchInputClass).toContain("pl-10");
      expect(searchInputClass).not.toContain(" px-3");
    });
  });

  describe("selectClass", () => {
    it("extends inputClass with the cross-browser .shyre-select hook", () => {
      // Shyre overrides the upstream selectClass to add a CSS class
      // that strips Safari's native double-arrow widget and renders
      // a custom chevron, so heights match across browsers. The base
      // input classes must still be present so all field chrome
      // (border, focus ring, etc.) carries through.
      expect(selectClass).toContain("border-edge");
      expect(selectClass).toContain("focus:ring-focus-ring/30");
      expect(selectClass).toContain("shyre-select");
    });
  });

  describe("labelClass", () => {
    it("uses the design-system text-body-lg utility (was the raw Tailwind class)", () => {
      expect(labelClass).toContain("text-body-lg");
      expect(labelClass).toContain("font-medium");
      // Guards against regression to raw Tailwind sizes.
      expect(labelClass).not.toMatch(/\btext-(xs|sm|base|lg|xl|2xl)\b/);
    });
  });

  describe("buttonPrimaryClass", () => {
    it("uses accent background and inverse text", () => {
      expect(buttonPrimaryClass).toContain("bg-accent");
      expect(buttonPrimaryClass).toContain("text-content-inverse");
    });

    it("has focus-visible ring", () => {
      expect(buttonPrimaryClass).toContain("focus-visible:ring-2");
    });

    it("has disabled state", () => {
      expect(buttonPrimaryClass).toContain("disabled:opacity-50");
    });
  });

  describe("buttonSecondaryClass", () => {
    it("uses surface background with border", () => {
      expect(buttonSecondaryClass).toContain("bg-surface-raised");
      expect(buttonSecondaryClass).toContain("border-edge");
    });
  });

  describe("buttonDangerClass", () => {
    it("uses error color", () => {
      expect(buttonDangerClass).toContain("text-error");
      expect(buttonDangerClass).toContain("hover:bg-error-soft");
    });
  });

  describe("buttonGhostClass", () => {
    it("uses secondary text with hover background", () => {
      expect(buttonGhostClass).toContain("text-content-secondary");
      expect(buttonGhostClass).toContain("hover:bg-hover");
    });
  });

  describe("kbdClass", () => {
    it("uses inset background, monospace font, and the design-system text-label utility", () => {
      expect(kbdClass).toContain("bg-surface-inset");
      expect(kbdClass).toContain("font-mono");
      expect(kbdClass).toContain("text-label");
      // Was previously text-[10px] — replaced by text-label which
      // also resolves to ~10px but scales with the user's text-size
      // preference.
      expect(kbdClass).not.toContain("text-[10px]");
    });
  });
});
