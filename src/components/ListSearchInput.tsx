"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { kbdClass } from "@/lib/form-styles";

/**
 * The one list-page search input (docs/reference/list-pages.md rule 1):
 * rounded chip-height field with a `/` shortcut + visible kbd hint,
 * 300ms debounced instant-apply, Enter commits immediately, Escape
 * clears. Unifies the projects search (styling + `/` shortcut) with the
 * Time-Table input (debounce semantics).
 *
 * `value` is the committed query (usually from the URL); `onCommit`
 * receives the trimmed next query — empty string means "clear".
 *
 * Local draft vs. committed value: the draft survives our own commit
 * echoing back through `value` (so in-progress typing — including
 * trailing spaces the debounce trims away — is never yanked), but an
 * EXTERNAL value change (e.g. a Clear-all button) drops the draft so
 * the input reflects the new state. Render-time adjustment per React's
 * "adjusting state when props change" guidance — an effect-based sync
 * would re-introduce the cursor-yank the draft exists to prevent.
 */

interface ListSearchInputProps {
  /** Committed query (URL-derived). */
  value: string;
  /** Called with the trimmed query on debounce idle / Enter / Escape-clear. */
  onCommit: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
}

export function ListSearchInput({
  value,
  onCommit,
  placeholder,
  ariaLabel,
}: ListSearchInputProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  // null = not editing; string = user's in-progress text.
  const [draft, setDraft] = useState<string | null>(null);
  const [prevValue, setPrevValue] = useState(value);

  if (value !== prevValue) {
    setPrevValue(value);
    // Our own commit echo satisfies draft.trim() === value — keep the
    // draft. Anything else is an external change — adopt it.
    if (draft !== null && draft.trim() !== value) {
      setDraft(null);
    }
  }

  const shown = draft ?? value;

  // 300ms debounced instant-apply. Cleared whenever the draft changes
  // again or the committed value catches up.
  useEffect(() => {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed === value) return;
    const id = setTimeout(() => onCommit(trimmed), 300);
    return () => clearTimeout(id);
  }, [draft, value, onCommit]);

  // `/` focuses the search input — standard list-page convention.
  // Skipped while another input/textarea/select/contenteditable is
  // focused or a modifier is held, so typing is never hijacked.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "/") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      onSubmit={(e) => {
        // Enter commits immediately (the debounce timer is cleaned up
        // once the committed value catches up).
        e.preventDefault();
        onCommit(shown.trim());
      }}
      className="relative inline-flex items-center"
      role="search"
    >
      <Search
        size={12}
        className="absolute left-3 text-content-muted pointer-events-none"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && shown.length > 0) {
            // Escape clears (input + committed query). The consumed
            // keypress must not also reach page-level Escape handlers
            // (e.g. clear-table-selection) — stopPropagation keeps one
            // keypress to one effect. When already empty it falls
            // through so those page-level handlers still work.
            e.preventDefault();
            e.stopPropagation();
            setDraft("");
            onCommit("");
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="rounded-full border border-edge bg-surface pl-7 pr-12 py-1 text-caption text-content placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-focus-ring w-[220px]"
      />
      <kbd
        className={`${kbdClass} absolute right-2 pointer-events-none`}
        aria-hidden="true"
      >
        /
      </kbd>
    </form>
  );
}
