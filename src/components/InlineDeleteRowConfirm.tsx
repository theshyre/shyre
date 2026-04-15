"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { Trash2, X } from "lucide-react";

interface Props {
  onConfirm: () => void | Promise<void>;
  /** Accessible label on the idle Trash button. */
  ariaLabel: string;
  /** Short payload summary rendered in the prompt. E.g. "5 entries · 8:30". */
  summary?: string;
  /** The word the user must type to arm the red button. Default: "delete". */
  confirmWord?: string;
  disabled?: boolean;
  iconSize?: number;
}

/**
 * Row-level destructive confirm for rows that have saved data. Click the
 * trash → the row expands inline (pushes the row taller) to show a prompt
 * and a text input. Typing the confirm word (`delete` by default) arms
 * the red button.
 *
 * Not a modal. Not a popover. Inline expansion so the mental model is
 * "I just escalated the destructive action on this row, there's nothing
 * else to think about." Escape cancels. Paired with the soft-delete +
 * Undo toast + /trash recovery flow: the typed-confirm is about *feeling*
 * proportional, not about making the delete un-recoverable.
 *
 * For row-level deletes on rows with ZERO saved entries, skip this
 * component entirely — just remove the row from local state.
 */
export function InlineDeleteRowConfirm({
  onConfirm,
  ariaLabel,
  summary,
  confirmWord = "delete",
  disabled = false,
  iconSize = 14,
}: Props): React.JSX.Element {
  const t = useTranslations("common.actions");
  const tRow = useTranslations("time.rowDelete");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // Escape from anywhere inside the prompt collapses it.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: globalThis.KeyboardEvent): void {
      if (e.key === "Escape") {
        setOpen(false);
        setTyped("");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  const canConfirm = typed.trim().toLowerCase() === confirmWord.toLowerCase();

  function handleInputKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" && canConfirm && !pending) {
      e.preventDefault();
      void fire();
    }
  }

  async function fire(): Promise<void> {
    if (!canConfirm || pending) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setOpen(false);
      setTyped("");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="rounded p-1 text-content-muted hover:bg-hover hover:text-error transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 size={iconSize} />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-2 rounded-md border border-error/40 bg-error-soft px-2 py-1.5"
    >
      <span className="text-caption text-content whitespace-nowrap">
        {summary
          ? tRow("promptWithSummary", { word: confirmWord, summary })
          : tRow("prompt", { word: confirmWord })}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={handleInputKey}
        aria-label={tRow("inputLabel")}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-20 rounded border border-edge bg-surface-raised px-1.5 py-0.5 text-body font-mono outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30"
      />
      <button
        type="button"
        onClick={() => void fire()}
        disabled={!canConfirm || pending}
        aria-label={t("confirmDelete")}
        className="inline-flex items-center gap-1 rounded bg-error px-2 py-0.5 text-caption font-semibold text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        {t("delete")}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTyped("");
        }}
        disabled={pending}
        aria-label={t("cancel")}
        className="rounded p-0.5 text-content-muted hover:bg-hover transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}
