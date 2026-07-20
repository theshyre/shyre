import { describe, it, expect, afterEach } from "vitest";
import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Repo-wide guard against the 2026-07-19 /invoices 500 outage: a
 * server `page.tsx` imported `hasActiveInvoiceFilters` — a plain
 * helper function — from `./invoice-filters`, a `"use client"`
 * module. That pulled client-bundle code into the server import
 * graph purely to reuse a pure function, and broke the route. The
 * fix moved the helper into a plain `.ts` module
 * (`invoice-list-filters.ts`) and repointed the page.
 *
 * `src/app/(dashboard)/invoices/invoice-filters.test.tsx:246-258` is
 * the single-route regression test for that incident. This test
 * generalizes it repo-wide: every server `page.tsx` under `src/app`
 * must import helpers (non-component, non-type bindings — i.e. any
 * runtime named import whose local binding isn't PascalCase) only
 * from plain `.ts`/`.tsx` modules that are NOT marked `"use client"`.
 *
 * Importing an actual CLIENT COMPONENT (PascalCase name — e.g.
 * `<InvoiceFilters />`) from a `"use client"` module is the normal,
 * expected pattern (a server page renders a client component) and is
 * NOT flagged — only helper-shaped (non-PascalCase) runtime imports
 * are.
 */

const APP_ROOT = resolve(process.cwd(), "src/app");

function walkPageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkPageFiles(p));
    } else if (entry.isFile() && entry.name === "page.tsx") {
      out.push(p);
    }
  }
  return out;
}

function hasUseClientDirective(content: string): boolean {
  // The directive must be the first statement (ignoring leading
  // whitespace/blank lines) per the "use client" spec — checking
  // just the first non-blank line matches how Next.js itself parses
  // it and avoids false positives from a stray string elsewhere in
  // the file.
  const firstLine = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return false;
  return firstLine === '"use client";' ||
    firstLine === "'use client';" ||
    firstLine === '"use client"' ||
    firstLine === "'use client'";
}

interface ImportedBinding {
  /** The local binding name (post `as` alias, if any). */
  name: string;
  /** True if this individual specifier is a `type`-only import. */
  typeOnly: boolean;
}

interface RelativeImport {
  specifier: string;
  /** True when the whole `import type { ... }` statement is type-only. */
  wholeImportTypeOnly: boolean;
  bindings: ImportedBinding[];
}

// Matches `import [type] [Default,] { a, b as c } from "./relative";`
// across multiple lines. The brace-content class deliberately excludes
// `{`/`}` themselves (named-import lists are never nested) — using
// `[\s\S]*?` instead would let backtracking swallow past an unrelated
// (e.g. non-relative-specifier) import's closing brace and merge two
// separate import statements into one bogus match.
const IMPORT_RE =
  /import\s+(type\s+)?(?:[\w$]+\s*,\s*)?\{([^{}]*)\}\s+from\s+["'](\.[^"']+)["']/g;

function parseRelativeImports(content: string): RelativeImport[] {
  const out: RelativeImport[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const wholeImportTypeOnly = Boolean(m[1]);
    const braceContents = m[2] ?? "";
    const specifier = m[3] ?? "";
    const bindings: ImportedBinding[] = braceContents
      .split(",")
      .map((raw) => raw.trim())
      .filter((raw) => raw.length > 0)
      .map((raw) => {
        const typeOnly = /^type\s+/.test(raw);
        const withoutType = raw.replace(/^type\s+/, "");
        const asMatch = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(withoutType);
        const name = asMatch ? asMatch[2]! : withoutType;
        return { name, typeOnly };
      });
    out.push({ specifier, wholeImportTypeOnly, bindings });
  }
  return out;
}

/** Resolve a relative import specifier to a same-tree source file, if
 *  one exists. Tries the conventional candidates in order. */
function resolveLocalModule(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** A helper-shaped import: a runtime (non-type) named binding whose
 *  local name doesn't look like a React component (PascalCase). */
function isHelperShaped(name: string): boolean {
  return /^[a-z]/.test(name);
}

interface Violation {
  page: string;
  specifier: string;
  targetModule: string;
  helperNames: string[];
}

function findViolations(root: string = APP_ROOT): Violation[] {
  const violations: Violation[] = [];
  for (const pageFile of walkPageFiles(root)) {
    const content = readFileSync(pageFile, "utf8");
    if (hasUseClientDirective(content)) continue; // not a server page

    for (const imp of parseRelativeImports(content)) {
      if (imp.wholeImportTypeOnly) continue;
      const target = resolveLocalModule(pageFile, imp.specifier);
      if (!target) continue;
      const targetContent = readFileSync(target, "utf8");
      if (!hasUseClientDirective(targetContent)) continue;

      const helperNames = imp.bindings
        .filter((b) => !b.typeOnly)
        .map((b) => b.name)
        .filter(isHelperShaped);

      if (helperNames.length > 0) {
        violations.push({
          page: relative(process.cwd(), pageFile),
          specifier: imp.specifier,
          targetModule: relative(process.cwd(), target),
          helperNames,
        });
      }
    }
  }
  return violations;
}

describe("server page.tsx files only import helpers from server-safe modules", () => {
  it("no server page.tsx imports a non-component (helper) binding from a \"use client\" module", () => {
    const violations = findViolations();
    if (violations.length > 0) {
      const formatted = violations
        .map(
          (v) =>
            `  ${v.page}\n` +
            `    imports [${v.helperNames.join(", ")}] from "${v.specifier}"\n` +
            `    → ${v.targetModule} is a "use client" module.\n` +
            `    Move the helper(s) to a plain .ts module and repoint both sides ` +
            `(see the 2026-07-19 /invoices 500 outage / invoice-list-filters.ts).`,
        )
        .join("\n");
      throw new Error(
        `Found ${violations.length} server-page → client-module helper import(s):\n${formatted}`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it("sanity: the walker finds a non-trivial number of page.tsx files", () => {
    // Guards against a path typo silently turning this into a
    // vacuously-passing test.
    expect(walkPageFiles(APP_ROOT).length).toBeGreaterThan(30);
  });
});

describe("detector behavior against isolated fixtures", () => {
  // These prove the detector actually fires (and doesn't over-fire) —
  // "no server page.tsx imports..." above passing today doesn't by
  // itself prove the detector would catch a regression; it could just
  // as easily be a no-op. Fixtures are built in a real temp directory
  // (not the repo) so we exercise the same fs-based code path.
  let fixtureRoot: string | null = null;

  afterEach(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
      fixtureRoot = null;
    }
  });

  function makeFixture(routeDir: string, files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "page-client-guard-"));
    fixtureRoot = root;
    const dir = join(root, routeDir);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, "utf8");
    }
    return root;
  }

  it("flags a helper (camelCase) import from a \"use client\" sibling module — the 2026-07-19 outage shape", () => {
    const root = makeFixture("widgets", {
      "page.tsx": [
        'import { hasActiveWidgetFilters } from "./widget-filters";',
        "",
        "export default function Page() {",
        "  return hasActiveWidgetFilters({}) ? null : null;",
        "}",
        "",
      ].join("\n"),
      "widget-filters.tsx": [
        '"use client";',
        "",
        "export function hasActiveWidgetFilters(f: object): boolean {",
        "  return Object.keys(f).length > 0;",
        "}",
        "",
      ].join("\n"),
    });

    const violations = findViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.helperNames).toContain("hasActiveWidgetFilters");
    expect(violations[0]?.specifier).toBe("./widget-filters");
  });

  it("does NOT flag a PascalCase component import from the same \"use client\" module", () => {
    const root = makeFixture("widgets", {
      "page.tsx": [
        'import { WidgetFilters } from "./widget-filters";',
        "",
        "export default function Page() {",
        "  return <WidgetFilters />;",
        "}",
        "",
      ].join("\n"),
      "widget-filters.tsx": [
        '"use client";',
        "",
        "export function WidgetFilters() {",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    });

    expect(findViolations(root)).toHaveLength(0);
  });

  it("does NOT flag a helper import from a plain (non-\"use client\") .ts module", () => {
    const root = makeFixture("widgets", {
      "page.tsx": [
        'import { hasActiveWidgetFilters } from "./widget-filters";',
        "",
        "export default function Page() {",
        "  return hasActiveWidgetFilters({}) ? null : null;",
        "}",
        "",
      ].join("\n"),
      "widget-filters.ts": [
        "export function hasActiveWidgetFilters(f: object): boolean {",
        "  return Object.keys(f).length > 0;",
        "}",
        "",
      ].join("\n"),
    });

    expect(findViolations(root)).toHaveLength(0);
  });

  it("does NOT flag a page.tsx that is itself a client component", () => {
    const root = makeFixture("widgets", {
      "page.tsx": [
        '"use client";',
        "",
        'import { hasActiveWidgetFilters } from "./widget-filters";',
        "",
        "export default function Page() {",
        "  return hasActiveWidgetFilters({}) ? null : null;",
        "}",
        "",
      ].join("\n"),
      "widget-filters.tsx": [
        '"use client";',
        "",
        "export function hasActiveWidgetFilters(f: object): boolean {",
        "  return Object.keys(f).length > 0;",
        "}",
        "",
      ].join("\n"),
    });

    expect(findViolations(root)).toHaveLength(0);
  });

  it("does NOT flag a type-only import from a \"use client\" module", () => {
    const root = makeFixture("widgets", {
      "page.tsx": [
        'import type { widgetFilterShape } from "./widget-filters";',
        "",
        "export default function Page(props: { f: widgetFilterShape }) {",
        "  return null;",
        "}",
        "",
      ].join("\n"),
      "widget-filters.tsx": [
        '"use client";',
        "",
        "export type widgetFilterShape = { q: string };",
        "",
      ].join("\n"),
    });

    expect(findViolations(root)).toHaveLength(0);
  });

  it("does not merge two separate import statements when the first has a non-relative specifier (regex-swallowing regression)", () => {
    // Earlier draft of this detector used a `[\s\S]*?` brace-content
    // class, which backtracked past an unrelated import's closing
    // brace and silently merged two statements into one bogus match
    // — either missing the real violation or mis-attributing names.
    const root = makeFixture("widgets", {
      "page.tsx": [
        'import { SomeIcon, resolveThing } from "some-package";',
        'import { hasActiveWidgetFilters } from "./widget-filters";',
        "",
        "export default function Page() {",
        "  return hasActiveWidgetFilters({}) ? null : null;",
        "}",
        "",
      ].join("\n"),
      "widget-filters.tsx": [
        '"use client";',
        "",
        "export function hasActiveWidgetFilters(f: object): boolean {",
        "  return Object.keys(f).length > 0;",
        "}",
        "",
      ].join("\n"),
    });

    const violations = findViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("./widget-filters");
    expect(violations[0]?.helperNames).toEqual(["hasActiveWidgetFilters"]);
  });
});
