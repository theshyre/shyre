"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookOpen, Copy, Check } from "lucide-react";
import { useToast } from "@/components/Toast";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { buttonSecondaryClass } from "@/lib/form-styles";

/**
 * Copyable `~/.claude/shyre-projects.json` map line for THIS project, so a
 * developer never hand-assembles the `"owner/repo": "project-id"` entry (a
 * typo'd id silently mis-bills another client). Uses the project's github_repo
 * as the key when set; otherwise falls back to a placeholder + a hint to set
 * the repo above.
 */
export function MapLineHelper({
  githubRepo,
  projectId,
}: {
  githubRepo: string | null;
  projectId: string;
}): React.JSX.Element {
  const t = useTranslations("projects.mapLine");
  const toast = useToast();
  const repoKey = githubRepo?.trim() || "your-org/your-repo";
  const line = `"${repoKey}": "${projectId}"`;
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      toast.push({ kind: "success", message: t("copied") });
    } catch {
      toast.push({ kind: "error", message: t("copyFailed") });
    }
  };

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
      <p className="text-body text-content-secondary">{t("intro")}</p>

      <div className="flex items-start gap-2">
        <code className="block min-w-0 flex-1 break-all rounded-lg border border-edge bg-surface-inset p-3 font-mono text-caption text-content">
          {line}
        </code>
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
          className={`${buttonSecondaryClass} shrink-0`}
        >
          {copied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          {t("copy")}
        </button>
      </div>

      {!githubRepo?.trim() && (
        <p className="text-caption text-content-muted">{t("noRepoHint")}</p>
      )}

      <p className="text-body text-content-secondary">
        {t("docsIntro")}{" "}
        <Link
          href="/docs/guides/features/claude-code-hooks-kit"
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
        >
          <BookOpen size={14} aria-hidden="true" />
          {t("docsLink")}
          <LinkPendingSpinner />
        </Link>
      </p>
    </div>
  );
}
