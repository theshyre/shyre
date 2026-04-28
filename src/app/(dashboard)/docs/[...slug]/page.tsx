import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BookOpen, ArrowLeft } from "lucide-react";
import fs from "fs/promises";
import path from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Last segment, prettified — "time-tracking" → "Time tracking".
  const last = slug[slug.length - 1] ?? "";
  if (!last) return { title: "Docs" };
  const pretty = last
    .replace(/[-_]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
  return { title: `${pretty} · Docs` };
}

/**
 * Resolve a URL slug to a file under docs/. Supports:
 *   /docs/guides/features/time-tracking        → docs/guides/features/time-tracking.md
 *   /docs/reference/architecture           → docs/reference/architecture.md
 *   /docs/security/SECURITY_AUDIT_LOG      → docs/security/SECURITY_AUDIT_LOG.md
 *   /docs/guides/features                      → docs/guides/features/README.md
 *
 * Back-compat for the previous flat slug scheme:
 *   /docs/architecture          → docs/reference/architecture.md
 *   /docs/database-schema       → docs/reference/database-schema.md
 *   /docs/security-audit-log    → docs/security/SECURITY_AUDIT_LOG.md
 */
const LEGACY_SLUG_TO_PATH: Record<string, string> = {
  architecture: "reference/architecture.md",
  "database-schema": "reference/database-schema.md",
  "security-audit-log": "security/SECURITY_AUDIT_LOG.md",
};

async function readDoc(slugParts: string[]): Promise<string | null> {
  // Reject non-alphanumeric path components to prevent traversal.
  for (const part of slugParts) {
    if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
  }

  const cwd = process.cwd();
  const docsRoot = path.resolve(path.join(cwd, "docs")) + path.sep;

  const tryRead = async (relative: string): Promise<string | null> => {
    try {
      const resolved = path.resolve(path.join(cwd, "docs", relative));
      // Safety: resolved path must be inside the docs/ dir.
      if (!resolved.startsWith(docsRoot)) return null;
      return await fs.readFile(resolved, "utf-8");
    } catch {
      return null;
    }
  };

  // Legacy flat slugs.
  if (slugParts.length === 1) {
    const legacy = LEGACY_SLUG_TO_PATH[slugParts[0]!];
    if (legacy) {
      const content = await tryRead(legacy);
      if (content !== null) return content;
    }
  }

  // Try a/b/c.md
  const direct = slugParts.join("/") + ".md";
  const directContent = await tryRead(direct);
  if (directContent !== null) return directContent;

  // Try a/b/c/README.md
  const asDir = slugParts.join("/") + "/README.md";
  return tryRead(asDir);
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const content = await readDoc(slug);
  if (content === null) notFound();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BookOpen size={20} className="text-accent" />
          <span className="text-sm text-content-muted">Documentation</span>
        </div>
        <Link
          href="/docs"
          className="inline-flex items-center gap-1 text-sm text-content-muted hover:text-content"
        >
          <ArrowLeft size={14} />
          All docs
        </Link>
      </div>

      <article className="shyre-doc">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
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
              const rewritten = rewriteDocLink((href ?? "") as string);
              return (
                <Link href={rewritten} className="text-accent hover:underline break-words">
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
                <table {...props} className="w-full text-sm" />
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
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

/**
 * Rewrite relative markdown links (./customers.md,
 * ../agency/teams-and-roles.md) so they work inside /docs.
 *
 * Limitations: without knowing the current doc's path in scope, relative
 * links work only when the link is already within the same subtree the
 * browser can resolve naturally. Absolute URLs, anchors, and mailto: are
 * passed through untouched.
 */
function rewriteDocLink(href: string): string {
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
  return href.replace(/\.md$/, "");
}
