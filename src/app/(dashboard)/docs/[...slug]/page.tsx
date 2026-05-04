import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import fs from "fs/promises";
import path from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { tableClass } from "@/lib/table-styles";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const last = slug[slug.length - 1] ?? "";
  if (!last) return { title: "Docs" };
  const pretty = last
    .replace(/[-_]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
  return { title: `${pretty} · Docs` };
}

const LEGACY_SLUG_TO_PATH: Record<string, string> = {
  architecture: "reference/architecture.md",
  "database-schema": "reference/database-schema.md",
  "security-audit-log": "security/SECURITY_AUDIT_LOG.md",
};

interface DocResult {
  content: string;
  /** Path under docs/, e.g. "guides/admin/email-setup.md" or
   *  "guides/admin/README.md". Used by the link rewriter to
   *  resolve relative hrefs against the current doc's location. */
  relativePath: string;
}

async function readDoc(slugParts: string[]): Promise<DocResult | null> {
  // Reject non-alphanumeric path components to prevent traversal.
  for (const part of slugParts) {
    if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
  }

  const cwd = process.cwd();
  const docsRoot = path.resolve(path.join(cwd, "docs")) + path.sep;

  const tryRead = async (
    relative: string,
  ): Promise<DocResult | null> => {
    try {
      const resolved = path.resolve(path.join(cwd, "docs", relative));
      if (!resolved.startsWith(docsRoot)) return null;
      const content = await fs.readFile(resolved, "utf-8");
      return { content, relativePath: relative };
    } catch {
      return null;
    }
  };

  if (slugParts.length === 1) {
    const legacy = LEGACY_SLUG_TO_PATH[slugParts[0]!];
    if (legacy) {
      const result = await tryRead(legacy);
      if (result) return result;
    }
  }

  // Try a/b/c.md
  const direct = await tryRead(slugParts.join("/") + ".md");
  if (direct) return direct;

  // Try a/b/c/README.md
  return tryRead(slugParts.join("/") + "/README.md");
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const result = await readDoc(slug);
  if (result === null) notFound();

  // Directory the current doc lives in, with trailing slash. Used
  // as the base for resolving relative links inside the markdown.
  // For "guides/admin/README.md" → "guides/admin/".
  // For "guides/admin/email-setup.md" → "guides/admin/".
  const lastSlash = result.relativePath.lastIndexOf("/");
  const docDir =
    lastSlash >= 0 ? result.relativePath.slice(0, lastSlash + 1) : "";

  const breadcrumbs = buildBreadcrumbs(slug);

  return (
    <div>
      <nav
        aria-label="Breadcrumbs"
        className="mb-6 flex items-center gap-2 text-caption text-content-muted flex-wrap"
      >
        <BookOpen size={14} className="text-accent shrink-0" aria-hidden />
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span key={crumb.href} className="inline-flex items-center gap-2">
              {isLast ? (
                <span className="text-content font-medium">{crumb.label}</span>
              ) : (
                <Link href={crumb.href} className="hover:text-content">
                  {crumb.label}
                </Link>
              )}
              {!isLast && (
                <span className="text-content-muted/60" aria-hidden>
                  /
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <article className="shyre-doc">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug]}
          components={{
            h1: (props) => (
              <h1 {...props} className="text-3xl font-bold text-content mt-2 mb-4" />
            ),
            h2: (props) => (
              <h2
                {...props}
                className="text-xl font-semibold text-content mt-8 mb-3 pb-2 border-b border-edge-muted"
              />
            ),
            h3: (props) => (
              <h3 {...props} className="text-lg font-semibold text-content mt-6 mb-2" />
            ),
            p: (props) => (
              <p {...props} className="text-sm text-content-secondary leading-relaxed my-3" />
            ),
            a: ({ href, children }) => {
              const rewritten = rewriteDocLink((href ?? "") as string, docDir);
              const isExternal =
                rewritten.startsWith("http://") ||
                rewritten.startsWith("https://");
              return (
                <Link
                  href={rewritten}
                  className="text-accent hover:underline break-words"
                  {...(isExternal
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {children}
                </Link>
              );
            },
            ul: (props) => (
              <ul
                {...props}
                className="list-disc pl-6 my-3 space-y-1 text-sm text-content-secondary"
              />
            ),
            ol: (props) => (
              <ol
                {...props}
                className="list-decimal pl-6 my-3 space-y-1 text-sm text-content-secondary"
              />
            ),
            li: (props) => <li {...props} className="leading-relaxed" />,
            blockquote: (props) => (
              <blockquote
                {...props}
                className="border-l-4 border-accent bg-accent-soft/30 pl-4 py-2 my-3 text-sm text-content-secondary italic"
              />
            ),
            code: ({ className, children, ...rest }) => {
              const isBlock = typeof className === "string" && className.startsWith("language-");
              if (isBlock) {
                return (
                  <code {...rest} className={`${className ?? ""} text-sm text-content font-mono`}>
                    {children}
                  </code>
                );
              }
              return (
                <code className="rounded bg-surface-inset px-1.5 py-0.5 text-[0.85em] font-mono text-content">
                  {children}
                </code>
              );
            },
            pre: (props) => (
              <pre
                {...props}
                className="my-3 overflow-x-auto rounded-lg border border-edge bg-surface-inset p-4 text-xs"
              />
            ),
            table: (props) => (
              <div className="my-4 overflow-x-auto rounded-lg border border-edge">
                <table {...props} className={tableClass} />
              </div>
            ),
            thead: (props) => <thead {...props} className="bg-surface-inset" />,
            th: (props) => (
              <th
                {...props}
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-content-muted border-b border-edge"
              />
            ),
            td: (props) => (
              <td
                {...props}
                className="px-3 py-2 text-sm text-content-secondary border-b border-edge-muted last:border-0"
              />
            ),
            hr: () => <hr className="my-6 border-edge" />,
            strong: (props) => <strong {...props} className="font-semibold text-content" />,
            em: (props) => <em {...props} className="italic" />,
          }}
        >
          {result.content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

interface Crumb {
  label: string;
  href: string;
}

/** Build breadcrumbs from a slug. `Docs` always leads. Each
 *  intermediate segment links to its directory README; the last
 *  segment is the current page (rendered non-link). */
function buildBreadcrumbs(slugParts: string[]): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Docs", href: "/docs" }];
  let acc = "";
  for (let i = 0; i < slugParts.length; i++) {
    const part = slugParts[i]!;
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({
      label: prettifySegment(part),
      href: `/docs/${acc}`,
    });
  }
  return crumbs;
}

function prettifySegment(segment: string): string {
  // Acronym-friendly: keep all-caps tokens uppercase
  // (SECURITY_AUDIT_LOG → "Security audit log" not "S e c u r i t y").
  if (/^[A-Z][A-Z_]+$/.test(segment)) {
    return segment
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
  }
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Rewrite markdown links so they work inside /docs.
 *
 * Strategy: resolve any relative href against the current doc's
 * directory (e.g. "guides/admin/"), strip the `.md` extension if
 * present, prefix with "/docs/", preserve fragment identifiers.
 *
 * Absolute URLs, app-internal absolute paths, anchors, and mailto:
 * links are passed through.
 */
function rewriteDocLink(href: string, docDir: string): string {
  if (!href) return "#";
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("/") ||
    href.startsWith("#") ||
    href.startsWith("mailto:")
  ) {
    return href;
  }

  // Split off a fragment (#anchor) so we can re-add after path
  // normalization. Markdown inside-page links (`#section`) are
  // handled above.
  let fragment = "";
  let pathPart = href;
  const hashIdx = href.indexOf("#");
  if (hashIdx >= 0) {
    fragment = href.slice(hashIdx);
    pathPart = href.slice(0, hashIdx);
  }

  // Resolve relative path against docDir using POSIX semantics.
  // path.posix.join collapses ../ and ./ correctly. docDir always
  // ends with "/" (or is empty for top-level docs).
  const joined = path.posix.join(docDir, pathPart);

  // Strip trailing /README.md or .md so URLs are clean.
  const cleaned = joined
    .replace(/\/README\.md$/, "")
    .replace(/\.md$/, "");

  // Prepend the route prefix.
  return `/docs/${cleaned}${fragment}`;
}
