"use client";

import type { ReactElement } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/Tooltip";

export interface InlineCancelButtonProps {
  /** Cancel/close the inline form, confirm strip, or modal. */
  onClick: () => void;
  disabled?: boolean;
  /**
   * Overrides the default "Cancel" tooltip + accessible name. Pass an
   * already-translated string — e.g. a more specific "Cancel unlock"
   * or the call site's own `actions.close` label.
   */
  label?: string;
  /** Icon-only button classes. Defaults to the shared inline-X treatment. */
  className?: string;
  /** Lucide icon size in px. Defaults to 14 to match the common inline X. */
  iconSize?: number;
}

const DEFAULT_CLASS =
  "rounded p-0.5 text-content-muted hover:bg-hover transition-colors";

/**
 * Shared icon-only "X" cancel/close button used across inline forms,
 * bulk-action confirm strips, and modal chrome. Bakes in the required
 * `<Tooltip labelMode="label">` — this control has no other text
 * source, so the tooltip text IS its accessible name — so every
 * cancel/close X gets consistent hover/focus affordance instead of
 * each call site hand-rolling its own aria-label.
 */
export function InlineCancelButton({
  onClick,
  disabled = false,
  label,
  className,
  iconSize = 14,
}: InlineCancelButtonProps): ReactElement {
  const t = useTranslations("common.actions");
  const resolvedLabel = label ?? t("cancel");

  return (
    <Tooltip label={resolvedLabel} labelMode="label">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={className ?? DEFAULT_CLASS}
      >
        <X size={iconSize} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
