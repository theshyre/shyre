"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, SearchX, Copy, Check, Home, RefreshCw } from "lucide-react";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/lib/form-styles";

interface ErrorDisplayProps {
  /** Error type: "error" for server errors, "notFound" for 404 */
  variant?: "error" | "notFound";
  /** Main heading */
  title?: string;
  /** Descriptive message */
  message?: string;
  /** Error digest/reference ID */
  digest?: string;
  /** Show retry button */
  showRetry?: boolean;
  /** Retry handler */
  onRetry?: () => void;
  /** Show go home button */
  showHome?: boolean;
}

/**
 * Reusable error display component.
 * Used by all error.tsx and not-found.tsx pages.
 * Includes Copy Details button for support.
 */
export function ErrorDisplay({
  variant = "error",
  title,
  message,
  digest,
  showRetry = true,
  onRetry,
  showHome = true,
}: ErrorDisplayProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const isNotFound = variant === "notFound";

  const Icon = isNotFound ? SearchX : AlertTriangle;
  const iconColor = isNotFound ? "text-warning" : "text-error";
  const bgColor = isNotFound ? "bg-warning-soft" : "bg-error-soft";

  const defaultTitle = isNotFound ? "Page not found" : "Something went wrong";
  const defaultMessage = isNotFound
    ? "The page you're looking for doesn't exist or has been moved."
    : "An unexpected error occurred. Please try again.";

  const displayTitle = title ?? defaultTitle;
  const displayMessage = message ?? defaultMessage;

  async function copyDetails(): Promise<void> {
    const details = [
      `Error: ${displayTitle}`,
      `Message: ${displayMessage}`,
      digest ? `Reference: ${digest}` : null,
      `URL: ${typeof window !== "undefined" ? window.location.href : ""}`,
      `Time: ${new Date().toISOString()}`,
      `Browser: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select a textarea
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {/* Icon */}
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-full ${bgColor} mb-6`}
      >
        <Icon size={32} className={iconColor} />
      </div>

      {/* Title + message (redundant encoding: icon + text) */}
      <h1 className="text-page-title font-bold text-content mb-2">{displayTitle}</h1>
      <p className="text-content-secondary max-w-md mb-6">{displayMessage}</p>

      {/* Reference ID */}
      {digest && (
        <p className="text-caption text-content-muted font-mono mb-6">
          Reference: {digest}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap justify-center">
        {showRetry && onRetry && (
          <button onClick={onRetry} className={buttonPrimaryClass}>
            <RefreshCw size={16} />
            Try Again
          </button>
        )}

        {showHome && (
          <Link href="/" className={buttonSecondaryClass}>
            <Home size={16} />
            Go Home
          </Link>
        )}

        <button
          onClick={copyDetails}
          className={`${buttonSecondaryClass} text-caption`}
        >
          {copied ? (
            <>
              <Check size={14} />
              Copied!
            </>
          ) : (
            <>
              <Copy size={14} />
              Copy Details
            </>
          )}
        </button>
      </div>
    </div>
  );
}
