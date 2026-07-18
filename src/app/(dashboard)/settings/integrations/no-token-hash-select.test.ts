import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-level guard (SAL-051): `token_hash` is a secret-equivalent
 * column — the github_token rule applies. The settings surface may
 * WRITE it exactly once (the insert payload in `actions.ts`) and must
 * never read it back:
 *
 *   - no select/query string anywhere in this directory may mention
 *     `token_hash`;
 *   - no select-all (`.select()` / `.select("*")`) is allowed at all —
 *     a wildcard on `integration_tokens` would fetch the hash without
 *     ever naming it;
 *   - outside `actions.ts` the identifier must not appear in code at
 *     all, and inside `actions.ts` it appears exactly once, as the
 *     insert-payload write.
 */
const dir = __dirname;

/** Recursive walk so a future subfolder can't fall out of scan scope. */
function collectSourceFiles(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(join(root, entry.name), rel));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      out.push(rel);
    }
  }
  return out;
}

const sourceFiles = collectSourceFiles(dir);

/**
 * Every `.select(...)` argument span, tolerating nested parens (the
 * embedded-join house style: `user_profiles(display_name, ...)`) via
 * depth counting instead of a non-greedy regex.
 */
function extractSelectArgs(source: string): string[] {
  const args: string[] = [];
  const re = /\.select\s*\(/g;
  while (re.exec(source) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    args.push(source.slice(re.lastIndex, i - 1));
  }
  return args;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*\*.*$/gm, "");
}

describe("token_hash never selected on the settings surface", () => {
  it("scans every source file in the integrations settings directory", () => {
    // Guard the guard: if the directory layout changes, this test
    // should still be looking at the real files.
    expect(sourceFiles).toContain("page.tsx");
    expect(sourceFiles).toContain("actions.ts");
    expect(sourceFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of sourceFiles) {
    it(`${file}: no select mentions token_hash or selects all columns`, () => {
      const source = readFileSync(join(dir, file), "utf-8");
      for (const arg of extractSelectArgs(source)) {
        expect(arg).not.toContain("token_hash");
        // A wildcard or empty select fetches every column — including
        // the hash — without naming it. Banned outright.
        const literal = arg.trim().replace(/^["'`]|["'`]$/g, "").trim();
        const isWildcard = literal === "" || literal === "*";
        expect(
          isWildcard,
          `${file}: bare/wildcard .select(${arg || '""'}) is banned on this surface`,
        ).toBe(false);
      }
    });
  }

  it("actions.ts writes token_hash exactly once — the insert payload", () => {
    const source = stripComments(
      readFileSync(join(dir, "actions.ts"), "utf-8"),
    );
    expect(source.match(/token_hash/g) ?? []).toHaveLength(1);
    // ...and that one occurrence is the write, not a read.
    expect(source).toMatch(/token_hash:\s*token\.hash/);
  });

  for (const file of sourceFiles.filter((f) => f !== "actions.ts")) {
    it(`${file}: does not mention token_hash in code at all`, () => {
      const source = stripComments(readFileSync(join(dir, file), "utf-8"));
      expect(source).not.toContain("token_hash");
    });
  }
});
