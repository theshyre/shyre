/**
 * Shared form field styles.
 * MANDATORY: Never inline form field classes — use these constants.
 */

export const inputClass = [
  "w-full rounded-lg border border-edge bg-surface-raised px-3 py-2",
  "text-sm text-content outline-none transition-colors",
  "placeholder:text-content-muted",
  "hover:border-content-muted",
  "focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");

export const textareaClass = `${inputClass} resize-none`;

export const searchInputClass = inputClass
  .replace("px-3", "pl-10 pr-4");

export const selectClass = inputClass;

export const labelClass = "block text-sm font-medium text-content mb-1";

export const buttonPrimaryClass = [
  "inline-flex items-center gap-2 rounded-lg px-4 py-2",
  "text-sm font-medium bg-accent text-content-inverse",
  "hover:bg-accent-hover transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

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
