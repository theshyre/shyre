import { getTranslations } from "next-intl/server";
import { BookOpen } from "lucide-react";
import Link from "next/link";
import fs from "fs/promises";
import path from "path";

interface DocEntry {
  name: string;
  href: string;
  description: string;
}

const DOCS: DocEntry[] = [
  {
    name: "Architecture Overview",
    href: "/docs/architecture",
    description: "System design, stack, data flow, and deployment",
  },
  {
    name: "Database Schema",
    href: "/docs/database-schema",
    description: "Tables, relationships, RLS policies, and triggers",
  },
  {
    name: "Security Audit Log",
    href: "/docs/security-audit-log",
    description: "Append-only record of security findings and resolutions",
  },
];

export default async function DocsIndexPage(): Promise<React.JSX.Element> {
  return (
    <div>
      <div className="flex items-center gap-3">
        <BookOpen size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">Documentation</h1>
      </div>

      <ul className="mt-6 space-y-3">
        {DOCS.map((doc) => (
          <li key={doc.href}>
            <Link
              href={doc.href}
              className="block rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
            >
              <span className="font-medium text-accent">{doc.name}</span>
              <p className="mt-1 text-sm text-content-secondary">
                {doc.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
