"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Check, X } from "lucide-react";

interface Props {
  /** Called when the user confirms the delete. */
  onConfirm: () => void | Promise<void>;
  /** Accessible label on the idle Trash button. */
  ariaLabel: string;
  /**
   * Optional short description rendered next to the Confirm button
   * (e.g., "3 entries"). Use when the target of deletion isn't obvious
   * from context.
   */
  confirmDescription?: string;
  /** Auto-revert to idle after this many ms. Default 4000. */
  resetMs?: number;
  /** Disable the idle trigger. */
  disabled?: boolean;
  /** Icon size. Default 14. */
  iconSize?: number;
}

/**
 * Row-level destructive confirm. Click the trash → same slot flips to
 * [Delete][Cancel] for a few seconds. Auto-reverts if the user walks
 * away. Never renders a modal — inline by design.
 *
 * For destructive actions that affect more than one entity (delete team,
 * void invoice, etc.), use the typed-name confirmation flow instead.
 */
export function InlineDeleteButton({
  onConfirm,
  ariaLabel,
  confirmDescription,
  resetMs = 4000,
  disabled = false,
  iconSize = 14,
}: Props): React.JSX.Element {
  const t = useTranslations("common.actions");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!confirming) return;
    timerRef.current = setTimeout(() => setConfirming(false), resetMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [confirming, resetMs]);

  // Escape while confirming → cancel, matches modal/overlay rule.
  useEffect(() => {
    if (!confirming) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [confirming]);

  async function handleConfirm(): Promise<void> {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="rounded p-1 text-content-muted hover:bg-hover hover:text-error transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 size={iconSize} />
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      {confirmDescription && (
        <span className="text-[10px] text-content-muted mr-1">
          {confirmDescription}
        </span>
      )}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={pending}
        aria-label={t("confirmDelete")}
        className="inline-flex items-center gap-1 rounded bg-error px-2 py-1 text-[10px] font-medium text-content-inverse hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        <Check size={12} />
        {t("delete")}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        aria-label={t("cancel")}
        className="rounded p-1 text-content-muted hover:bg-hover transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}
