import { describe, it, expect } from "vitest";
import { locales, defaultLocale } from "./config";
import type { Locale } from "./config";

describe("i18n config", () => {
  it("exports en and es as supported locales", () => {
    expect(locales).toContain("en");
    expect(locales).toContain("es");
    expect(locales).toHaveLength(2);
  });

  it("defaults to English", () => {
    expect(defaultLocale).toBe("en");
  });

  it("Locale type matches locales array", () => {
    const testLocale: Locale = "en";
    expect(locales).toContain(testLocale);
  });
});
