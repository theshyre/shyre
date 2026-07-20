import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED_THEMES } from "@/lib/profile/allow-lists";

/**
 * Regression guard for the 2026-07-18 malcom badge bug: the per-theme
 * --{status}-text tokens in globals.css silently fall through to the
 * LIGHT values for any theme without its own block — unreadable badges
 * on dark themes. Every concrete theme must declare (or deliberately
 * alias) the four status-text tokens.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("per-theme status-text tokens", () => {
  for (const theme of ALLOWED_THEMES) {
    if (theme === "system") continue; // resolves to light/dark at runtime
    it(`theme "${theme}" declares its own --*-text block`, () => {
      const block = css.match(
        new RegExp(String.raw`\[data-theme="${theme}"\]\s*\{[^}]*\}`, "g"),
      );
      expect(block, `no [data-theme="${theme}"] block in globals.css`).not.toBeNull();
      const joined = (block ?? []).join("\n");
      for (const tok of ["--success-text", "--warning-text", "--error-text", "--info-text"]) {
        expect(joined, `${theme} missing ${tok}`).toContain(tok);
      }
    });
  }
});
