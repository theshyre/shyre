/**
 * Shared form field styles.
 * MANDATORY: Never inline form field classes — use these constants.
 */

import { buttonPrimaryClass as baseButtonPrimaryClass } from "@theshyre/ui";

export {
  inputClass,
  selectClass,
  textareaClass,
  searchInputClass,
} from "@theshyre/ui";

/**
 * Shyre's primary button wraps the shared `buttonPrimaryClass` and adds
 * `gap-2` so icon + label + kbd hint get breathing room. The shared
 * class intentionally omits the gap so consumers can choose their own
 * spacing (Liv uses narrower gaps in dense headers). If enough consumers
 * need gap-2, we can promote this convenience back to @theshyre/ui.
 */
export const buttonPrimaryClass = `${baseButtonPrimaryClass} gap-2`;

export const labelClass = "block text-sm font-medium text-content mb-1";

export const buttonSecondaryClass = [
  "inline-flex items-center gap-2 rounded-lg px-4 py-2",
  "text-sm font-medium border border-edge bg-surface-raised text-content",
  "hover:bg-hover transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

export const buttonDangerClass = [
  "inline-flex items-center gap-2 rounded-lg px-4 py-2",
  "text-sm font-medium text-error",
  "hover:bg-error-soft transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2",
].join(" ");

export const buttonGhostClass = [
  "inline-flex items-center gap-2 rounded-lg px-3 py-2",
  "text-sm font-medium text-content-secondary",
  "hover:bg-hover hover:text-content transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2",
].join(" ");

export const kbdClass =
  "rounded border border-edge bg-surface-inset px-1.5 py-0.5 text-[10px] text-content-muted font-mono";
