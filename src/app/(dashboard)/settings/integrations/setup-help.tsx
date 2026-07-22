"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookOpen, Copy, Check, TerminalSquare } from "lucide-react";
import { useToast } from "@/components/Toast";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { buttonSecondaryClass } from "@/lib/form-styles";

/** External-store shim for useSyncExternalStore: the origin never
 *  changes within a page's lifetime, so there is nothing to subscribe
 *  to — the store only exists to bridge server/client snapshots. */
function subscribeNever(): () => void {
  return () => {};
}

/**
 * "Connect a tool" help: a link to the in-app feature guide plus the
 * `claude mcp add` one-liner in a copyable code block. The origin is
 * read from the browser (the server can't know which host the user
 * reached the app on); server-side a neutral placeholder renders.
 */
export function SetupHelp(): React.JSX.Element {
  const t = useTranslations("integrations.setup");
  const toast = useToast();
  // Hydration-safe origin: the server snapshot renders a neutral
  // placeholder; the client snapshot swaps in the real host.
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => "https://your-shyre-host",
  );
  const [copied, setCopied] = useState(false);

  const command = `claude mcp add shyre --transport http ${origin}/api/mcp --header "Authorization: Bearer shyre_pat_..."`;

  const copyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.push({ kind: "success", message: t("copiedCommand") });
    } catch {
      toast.push({ kind: "error", message: t("copyFailed") });
    }
  };

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
      <div className="flex items-center gap-2">
        <TerminalSquare size={16} className="text-accent" aria-hidden="true" />
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("heading")}
        </h2>
      </div>

      <p className="text-body text-content-secondary">
        {t("docsIntro")}{" "}
        <Link
          href="/docs/guides/features/integrations-quickstart"
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
        >
          <BookOpen size={14} aria-hidden="true" />
          {t("docsLink")}
          <LinkPendingSpinner />
        </Link>
      </p>

      <p className="text-body text-content-secondary">{t("mcpIntro")}</p>

      <div className="flex items-start gap-2">
        <code className="block min-w-0 flex-1 break-all rounded-lg border border-edge bg-surface-inset p-3 font-mono text-caption text-content">
          {command}
        </code>
        <button
          type="button"
          onClick={() => {
            void copyCommand();
          }}
          className={`${buttonSecondaryClass} shrink-0`}
        >
          {copied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          {t("copyCommand")}
        </button>
      </div>

      <p className="text-body text-content-secondary">
        {t("hooksIntro")}{" "}
        <Link
          href="/docs/guides/features/claude-code-hooks-kit"
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
        >
          <BookOpen size={14} aria-hidden="true" />
          {t("hooksLink")}
          <LinkPendingSpinner />
        </Link>
      </p>
    </section>
  );
}
