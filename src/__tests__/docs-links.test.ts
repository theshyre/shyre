import { describe, it, expect } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";

/**
 * Doc-link audit. Walks `docs/`, parses every `.md` file's
 * markdown links, and asserts that:
 *
 *   1. Every relative file target exists on disk.
 *   2. Every `#anchor` matches a heading in the target file
 *      (using the `rehype-slug` / GitHub-slugger algorithm so
 *      runtime + audit agree).
 *
 * Skipped:
 *   - http(s) URLs
 *   - app-internal absolute paths (/customers, /admin, etc.)
 *   - mailto: links
 *   - bare in-page anchors (no file target)
 *   - link patterns inside fenced code blocks
 *   - link patterns inside backtick-wrapped inline code spans
 *
 * Failure prints `file:line:col [href]` for each broken link so
 * the fix is one cursor jump away.
 */

const DOCS_ROOT = resolve(process.cwd(), "docs");

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith(".md")) yield p;
  }
}

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function extractHeadings(filePath: string): Promise<Set<string>> {
  const content = await readFile(filePath, "utf8");
  const headings = new Set<string>();
  let inFence = false;
  for (const line of content.split("\n")) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m && m[2]) headings.add(slugify(m[2]));
  }
  return headings;
}

async function fileOrDirReadme(absPath: string): Promise<string | null> {
  try {
    const s = await stat(absPath);
    if (s.isFile()) return absPath;
    if (s.isDirectory()) {
      const readme = join(absPath, "README.md");
      try {
        await stat(readme);
        return readme;
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function insideBackticks(line: string, idx: number): boolean {
  let inCode = false;
  for (let i = 0; i < idx; i++) {
    if (line[i] === "`") inCode = !inCode;
  }
  return inCode;
}

interface BrokenLink {
  file: string;
  line: number;
  col: number;
  href: string;
  resolved?: string;
  resolvedFile?: string;
}

async function audit(): Promise<{
  missing: BrokenLink[];
  anchor: BrokenLink[];
  ok: number;
}> {
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  const reports = {
    missing: [] as BrokenLink[],
    anchor: [] as BrokenLink[],
    ok: 0,
  };

  for await (const filePath of walk(DOCS_ROOT)) {
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n");
    const fileDir = dirname(filePath);

    const inFenceByLine: boolean[] = new Array(lines.length).fill(false);
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^```/.test(lines[i] ?? "")) {
        inFence = !inFence;
        continue;
      }
      inFenceByLine[i] = inFence;
    }

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      if (inFenceByLine[lineNum]) continue;
      const line = lines[lineNum] ?? "";
      let m: RegExpExecArray | null;
      linkRe.lastIndex = 0;
      while ((m = linkRe.exec(line)) !== null) {
        if (insideBackticks(line, m.index)) {
          reports.ok++;
          continue;
        }
        const href = (m[2] ?? "").trim();

        if (
          href.startsWith("http://") ||
          href.startsWith("https://") ||
          href.startsWith("/") ||
          href.startsWith("#") ||
          href.startsWith("mailto:")
        ) {
          reports.ok++;
          continue;
        }

        let anchor = "";
        let pathPart = href;
        const hashIdx = href.indexOf("#");
        if (hashIdx >= 0) {
          anchor = href.slice(hashIdx + 1);
          pathPart = href.slice(0, hashIdx);
        }

        const col = m.index + 1;
        const rel = relative(DOCS_ROOT, filePath);

        if (!pathPart) {
          if (anchor) {
            const headings = await extractHeadings(filePath);
            if (!headings.has(anchor)) {
              reports.anchor.push({ file: rel, line: lineNum + 1, col, href });
              continue;
            }
          }
          reports.ok++;
          continue;
        }

        const targetAbs = resolve(fileDir, pathPart);
        const resolvedFile = await fileOrDirReadme(targetAbs);
        if (!resolvedFile) {
          reports.missing.push({
            file: rel,
            line: lineNum + 1,
            col,
            href,
            resolved: relative(DOCS_ROOT, targetAbs),
          });
          continue;
        }

        if (anchor) {
          const headings = await extractHeadings(resolvedFile);
          if (!headings.has(anchor)) {
            reports.anchor.push({
              file: rel,
              line: lineNum + 1,
              col,
              href,
              resolvedFile: relative(DOCS_ROOT, resolvedFile),
            });
            continue;
          }
        }
        reports.ok++;
      }
    }
  }
  return reports;
}

describe("docs link audit", () => {
  it("every relative .md link in docs/ resolves to a real file", async () => {
    const result = await audit();
    if (result.missing.length > 0) {
      const formatted = result.missing
        .map(
          (r) =>
            `  ${r.file}:${r.line}:${r.col}   [${r.href}]   tried → ${r.resolved}`,
        )
        .join("\n");
      throw new Error(
        `Found ${result.missing.length} broken doc link(s):\n${formatted}`,
      );
    }
    expect(result.missing).toHaveLength(0);
  });

  it("every #anchor in docs/ matches a heading in the target file", async () => {
    const result = await audit();
    if (result.anchor.length > 0) {
      const formatted = result.anchor
        .map(
          (r) =>
            `  ${r.file}:${r.line}:${r.col}   [${r.href}]${r.resolvedFile ? `   in → ${r.resolvedFile}` : ""}`,
        )
        .join("\n");
      throw new Error(
        `Found ${result.anchor.length} stale doc anchor(s):\n${formatted}`,
      );
    }
    expect(result.anchor).toHaveLength(0);
  });
});
