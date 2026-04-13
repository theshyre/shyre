"use client";

import { useEffect } from "react";

interface ShortcutOptions {
  /** The key to listen for (e.g., "n", "s", "/", "Escape") */
  key: string;
  /** Whether Cmd/Ctrl modifier is required */
  meta?: boolean;
  /** Callback when shortcut fires */
  onTrigger: () => void;
  /** Whether to allow firing when an input is focused (default: false, except for meta combos) */
  allowInInput?: boolean;
  /** Whether the shortcut is currently enabled (default: true) */
  enabled?: boolean;
}

/**
 * Hook for keyboard shortcuts.
 * By default, shortcuts only fire when no text input is focused
 * (except Cmd/Ctrl combos which always fire).
 */
export function useKeyboardShortcut({
  key,
  meta = false,
  onTrigger,
  allowInInput,
  enabled = true,
}: ShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent): void {
      // Check modifier
      if (meta && !(e.metaKey || e.ctrlKey)) return;
      if (!meta && (e.metaKey || e.ctrlKey)) return;

      // Check key match
      if (e.key.toLowerCase() !== key.toLowerCase()) return;

      // Check if input is focused
      const shouldAllowInInput = allowInInput ?? meta;
      if (!shouldAllowInInput) {
        const target = e.target as HTMLElement | null;
        if (target?.tagName) {
          const tag = target.tagName.toLowerCase();
          if (
            tag === "input" ||
            tag === "textarea" ||
            tag === "select" ||
            target.isContentEditable
          ) {
            return;
          }
        }
      }

      e.preventDefault();
      onTrigger();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [key, meta, onTrigger, allowInInput, enabled]);
}
