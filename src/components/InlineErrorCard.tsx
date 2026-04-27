"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { buttonGhostClass, buttonSecondaryClass } from "@/lib/form-styles";

interface Props {
  /** Short user-facing headline — what went wrong in plain language. */
  title: string;
  /** One-sentence description with a bit more context. Optional;
   * omit when the title is self-explanatory. */
  message?: string;
  /**
   * Raw diagnostic info (HTTP status, response body, stack trace, etc.)
   * Never shown by default — revealed behind a "Show details" toggle
   * and included in the clipboard payload when the user hits Copy.
   * Pass long strings without trying to pre-format them; we render in
   * <pre> with wrapping.
   */
  detail?: string;
  /**
   * Key-value facts included in the copy payload (e.g. "status": "404",
   * "endpoint": "/v2/clients"). Rendered as a small list above the
   * collapsible detail. Use this for anything a support reader needs
   * to see without expanding.
   */
  context?: Record<string, string>;
  /** If supplied, a Retry button invokes it. Commonly bound to the
   * same handler that triggered the failing action. */
  onRetry?: () => void;
  /** Extra class on the outer card. */
  className?: string;
}

/**
 * Compact, copy-able error card for action-level failures.
 *
 * Use this INSTEAD of `<AlertBanner tone="error">{rawString}</AlertBanner>`
 * whenever the underlying error has diagnostic context worth preserving
 * (HTTP status, request id, response body) — which is most of the time
 * for network calls and server actions. AlertBanner is still fine for
 * simple validation-style messages with no payload.
 *
 * Why a separate component rather than extending AlertBanner: the
 * copy-to-clipboard flow, the collapsible details, and the structured
 * context list all want their own layout. Cramming them behind an
 * AlertBanner prop makes both worse.
 *
 * Paired with the full-page `ErrorDisplay` component — same visual
 * language, different scale. ErrorDisplay owns error.tsx and
 * not-found.tsx; this owns inline form and action surfaces.
 */
export function InlineErrorCard({
  title,
  message,
  detail,
  context,
  onRetry,
  className,
}: Props): React.JSX.Element {
  const t = useTranslations("common.errors");
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyDetails(): Promise<void> {
    const lines: string[] = [`Error: ${title}`];
    if (message) lines.push(`Message: ${message}`);
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        lines.push(`${k}: ${v}`);
      }
    }
    if (detail) {
      lines.push("", "---", detail);
    }
    lines.push("", `Time: ${new Date().toISOString()}`);
    if (typeof window !== "undefined") {
      lines.push(`URL: ${window.location.href}`);
    }
    if (typeof navigator !== "undefined") {
      lines.push(`Browser: ${navigator.userAgent}`);
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in insecure contexts / older browsers;
      // nothing else to do gracefully here.
    }
  }

  const hasDetail = Boolean(detail);
  const contextEntries = context ? Object.entries(context) : [];

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`rounded-lg border border-error/40 bg-error-soft/60 p-4 ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          size={18}
          className="text-error shrink-0 mt-0.5"
          aria-hidden
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="font-semibold text-content break-words">{title}</p>
            {message ? (
              <p className="mt-0.5 text-body text-content-secondary break-words">
                {message}
              </p>
            ) : null}
          </div>

          {contextEntries.length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-caption">
              {contextEntries.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-content-muted font-mono">{k}</dt>
                  <dd className="text-content-secondary font-mono break-all">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {hasDetail && expanded ? (
            <pre className="text-caption text-content-secondary font-mono bg-surface-inset rounded-md p-2 max-h-[240px] overflow-auto whitespace-pre-wrap break-all">
              {detail}
            </pre>
          ) : null}

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className={`${buttonSecondaryClass} text-caption`}
              >
                <RefreshCw size={12} />
                {t("retry")}
              </button>
            ) : null}

            <button
              type="button"
              onClick={copyDetails}
              className={`${buttonGhostClass} text-caption`}
              aria-live="polite"
            >
              {copied ? (
                <>
                  <Check size={12} />
                  {t("copied")}
                </>
              ) : (
                <>
                  <Copy size={12} />
                  {t("copyDetails")}
                </>
              )}
            </button>

            {hasDetail ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={`${buttonGhostClass} text-caption`}
                aria-expanded={expanded}
              >
                {expanded ? (
                  <>
                    <ChevronUp size={12} />
                    {t("hideDetails")}
                  </>
                ) : (
                  <>
                    <ChevronDown size={12} />
                    {t("showDetails")}
                  </>
                )}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
