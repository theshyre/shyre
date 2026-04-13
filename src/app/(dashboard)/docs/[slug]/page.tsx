import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";
import fs from "fs/promises";
import path from "path";

const SLUG_TO_FILE: Record<string, string> = {
  architecture: "docs/ARCHITECTURE.md",
  "database-schema": "docs/DATABASE_SCHEMA.md",
  "security-audit-log": "docs/security/SECURITY_AUDIT_LOG.md",
};

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const filePath = SLUG_TO_FILE[slug];
  if (!filePath) notFound();

  let content: string;
  try {
    content = await fs.readFile(
      path.join(process.cwd(), filePath),
      "utf-8"
    );
  } catch {
    notFound();
  }

  // Simple markdown-to-HTML rendering for headings, tables, code, and paragraphs
  const lines = content.split("\n");
  const html = lines
    .map((line) => {
      if (line.startsWith("# "))
        return `<h1 class="text-2xl font-bold text-content mt-6 mb-3">${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("## "))
        return `<h2 class="text-xl font-semibold text-content mt-6 mb-2">${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("### "))
        return `<h3 class="text-lg font-medium text-content mt-4 mb-2">${escapeHtml(line.slice(4))}</h3>`;
      if (line.startsWith("|"))
        return `<div class="text-sm font-mono text-content-secondary">${escapeHtml(line)}</div>`;
      if (line.startsWith("```"))
        return `<hr class="border-edge my-2" />`;
      if (line.startsWith("> "))
        return `<blockquote class="border-l-4 border-accent pl-4 text-sm text-content-secondary italic my-2">${escapeHtml(line.slice(2))}</blockquote>`;
      if (line.startsWith("- "))
        return `<li class="text-sm text-content-secondary ml-4">${escapeHtml(line.slice(2))}</li>`;
      if (line.trim() === "") return `<div class="h-2"></div>`;
      return `<p class="text-sm text-content-secondary leading-relaxed">${escapeHtml(line)}</p>`;
    })
    .join("\n");

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <BookOpen size={24} className="text-accent" />
        <span className="text-sm text-content-muted">Documentation</span>
      </div>
      <article
        className="prose max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
