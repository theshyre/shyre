"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Render trusted-authored markdown to styled HTML for the app + the PUBLIC sign
 * page. react-markdown does NOT render raw HTML (no `rehype-raw`), so embedded
 * `<script>`/`<img onerror>`/etc. are inert text — the SAL-039 injection lesson
 * applied to prose that renders on a login-free page. `defaultUrlTransform`
 * (built in) strips `javascript:`/`data:` link targets; links open in a new tab
 * with `rel="noopener noreferrer"`. GFM adds tables / task lists / strikethrough.
 *
 * Elements map to the semantic typography scale (never raw px) for consistency
 * with the rest of the app.
 */
export function MarkdownView({
  content,
  className,
}: {
  content: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`markdown-body space-y-2 ${className ?? ""}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="mt-3 text-body-lg font-semibold text-content">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h4 className="mt-3 text-body-lg font-semibold text-content">
              {children}
            </h4>
          ),
          h3: ({ children }) => (
            <h5 className="mt-2 text-body font-semibold text-content">
              {children}
            </h5>
          ),
          p: ({ children }) => (
            <p className="text-body text-content-secondary">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="ml-4 list-disc space-y-1 text-body text-content-secondary">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-4 list-decimal space-y-1 text-body text-content-secondary">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-content">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-surface-raised px-1 font-mono text-caption">
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-edge pl-3 text-body text-content-secondary">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-edge" />,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-edge px-2 py-1 text-left font-semibold text-content">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-edge px-2 py-1 text-content-secondary">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
