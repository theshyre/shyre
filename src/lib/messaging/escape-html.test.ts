import { describe, it, expect } from "vitest";
import { escapeHtml } from "./escape-html";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">O'Brien & Co</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; Co&lt;/a&gt;",
    );
  });

  it("neutralizes a markup-bearing proposal title", () => {
    const hostile = `Upgrade <img src=x onerror=alert(1)> plan`;
    expect(escapeHtml(hostile)).not.toContain("<img");
    expect(escapeHtml(hostile)).toContain("&lt;img");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Basic dependency upgrades — $950")).toBe(
      "Basic dependency upgrades — $950",
    );
  });

  it("escapes ampersands first (no double-escaping)", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});
