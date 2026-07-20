import { describe, it, expect } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
import { DOC_TOPICS } from "@/lib/docs/topics";

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

/* ------------------------------------------------------------------ *
 * Hub reachability audit (docs/reference/documentation.md →
 * "Reachability — every guide must be findable from the hub").
 *
 * Direction 1 (hub → files): every /docs/... href in the hub page
 * resolves to a real file under docs/.
 * Direction 2 (files → hub): every .md under docs/guides/** is
 * reachable from the hub by following rendered markdown links,
 * starting from the hub's hrefs.
 * ------------------------------------------------------------------ */

const HUB_PAGE = resolve(process.cwd(), "src/app/(dashboard)/docs/page.tsx");

/**
 * Deliberately-unlisted guides. Every entry needs a comment saying
 * why it is exempt from hub reachability. Keep this empty unless a
 * guide genuinely must not be linked.
 */
const REACHABILITY_ALLOW_LIST: ReadonlySet<string> = new Set<string>([]);

/**
 * Every /docs/... href reachable from the hub. Two sources, because
 * the Modules section no longer hardcodes article hrefs as literal
 * strings in page.tsx (docs/reference/documentation.md's
 * topic-navigation rules moved that into the shared DOC_TOPICS
 * manifest, imported by both the hub and the topic-index route):
 *
 *   1. Literal `/docs/...` string constants still hand-written in the
 *      hub page (personal links, role-browse, reference).
 *   2. Every article href in DOC_TOPICS — reachable in the real app
 *      via hub card -> `/docs/topics/<slug>` -> article link, none of
 *      which is a static string this regex scan could find.
 */
async function hubHrefs(): Promise<string[]> {
  const src = await readFile(HUB_PAGE, "utf8");
  const re = /["'](\/docs(?:\/[^"'\s#]*)?)(#[^"'\s]*)?["']/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  for (const topic of DOC_TOPICS) {
    for (const article of topic.articles) {
      out.add(article.href);
    }
  }
  return [...out];
}

/** Resolve a /docs/... route to the file the slug renderer would serve. */
async function resolveDocRoute(href: string): Promise<string | null> {
  const rel = href.replace(/^\/docs\/?/, "");
  if (rel === "") return null; // the hub page itself
  const base = resolve(process.cwd(), "docs", rel);
  try {
    const s = await stat(`${base}.md`);
    if (s.isFile()) return `${base}.md`;
  } catch {
    // fall through to README resolution
  }
  return fileOrDirReadme(base);
}

/** Rendered relative markdown link targets of one docs .md file. */
async function outboundDocLinks(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n");
  const fileDir = dirname(filePath);
  const targets: string[] = [];
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let m: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(line)) !== null) {
      if (insideBackticks(line, m.index)) continue;
      const href = (m[2] ?? "").trim();
      if (/^(https?:|mailto:|\/|#)/.test(href)) continue;
      const pathPart = href.split("#")[0];
      if (!pathPart) continue;
      const resolvedFile = await fileOrDirReadme(resolve(fileDir, pathPart));
      if (resolvedFile) targets.push(resolvedFile);
    }
  }
  return targets;
}

async function reachableFromHub(): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const href of await hubHrefs()) {
    const file = await resolveDocRoute(href);
    if (file && !seen.has(file)) {
      seen.add(file);
      queue.push(file);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const target of await outboundDocLinks(current)) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

describe("docs hub reachability", () => {
  it("every /docs href in the hub page resolves to a real doc file", async () => {
    const broken: string[] = [];
    for (const href of await hubHrefs()) {
      if (href === "/docs") continue; // the hub itself
      const file = await resolveDocRoute(href);
      if (!file) broken.push(href);
    }
    if (broken.length > 0) {
      throw new Error(
        `Hub links point at missing docs:\n${broken.map((h) => `  ${h}`).join("\n")}`,
      );
    }
    expect(broken).toHaveLength(0);
  });

  it("every guide under docs/guides/** is reachable from the hub", async () => {
    const reachable = await reachableFromHub();
    const guidesRoot = resolve(process.cwd(), "docs", "guides");
    const orphans: string[] = [];
    for await (const filePath of walk(guidesRoot)) {
      const rel = relative(guidesRoot, filePath);
      if (REACHABILITY_ALLOW_LIST.has(rel)) continue;
      if (!reachable.has(filePath)) orphans.push(rel);
    }
    if (orphans.length > 0) {
      throw new Error(
        `Guides not reachable from the /docs hub (add a hub card entry ` +
          `or link them from a reachable README):\n${orphans
            .map((o) => `  guides/${o}`)
            .join("\n")}`,
      );
    }
    expect(orphans).toHaveLength(0);
  });

  it("every section README links all of its sibling guides", async () => {
    const guidesRoot = resolve(process.cwd(), "docs", "guides");
    const entries = await readdir(guidesRoot, { withFileTypes: true });
    const missing: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(guidesRoot, e.name);
      const readme = join(dir, "README.md");
      let readmeLinks: string[];
      try {
        await stat(readme);
        readmeLinks = await outboundDocLinks(readme);
      } catch {
        continue; // dirs without a README are covered by the transitive check
      }
      const linked = new Set(readmeLinks);
      const siblings = await readdir(dir, { withFileTypes: true });
      for (const s of siblings) {
        if (!s.isFile() || !s.name.endsWith(".md") || s.name === "README.md") continue;
        const abs = join(dir, s.name);
        if (!linked.has(abs)) missing.push(`guides/${e.name}/${s.name}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Section READMEs missing links to sibling guides:\n${missing
          .map((f) => `  ${f}`)
          .join("\n")}`,
      );
    }
    expect(missing).toHaveLength(0);
  });
});

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
