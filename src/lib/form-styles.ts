/**
 * Shared form field styles.
 * MANDATORY: Never inline form field classes — use these constants.
 */

import {
  buttonPrimaryClass as baseButtonPrimaryClass,
  selectClass as baseSelectClass,
} from "@theshyre/ui";

export {
  inputClass,
  textareaClass,
  searchInputClass,
} from "@theshyre/ui";

/**
 * Cross-browser select.
 *
 * Safari renders <select> noticeably taller than Chrome's, with its
 * native double-arrow widget inside the field. The result is two
 * different visual heights side-by-side with our text inputs and
 * DateField, which the user reported as "selects look strange in
 * Safari."
 *
 * The visual fix lives in `globals.css` under `.shyre-select`
 * (appearance: none + chevron-down background image). This wrapper
 * just appends the class to the @theshyre/ui base so every existing
 * `selectClass` consumer picks up the override automatically — no
 * call-site changes needed.
 *
 * Promote upstream: should land in @theshyre/ui in the next
 * theshyre-core release. Tracked in
 * docs/reference/promotion-candidates.md.
 */
export const selectClass = `${baseSelectClass} shyre-select`;

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

/**
 * 12-column form grid + span helpers.
 *
 * Use a 12-column grid for any form with mixed-width fields rather
 * than `grid-cols-2`, which forces a 10-character date input and a
 * 200-character description into the same horizontal budget. Each
 * field declares the span that fits its content.
 *
 * The columns collapse to one on mobile (`col-span-12`) so a narrow
 * viewport stacks. The `sm:` breakpoint (640px+) is where the grid
 * reads as a grid.
 *
 * Mapping (canonical, also documented at
 * `docs/reference/forms-and-buttons.md` → "Field sizing"):
 *
 *   Description / Notes textarea       → formSpanFull       (col-span-12)
 *   Project / Customer / Vendor select → formSpanHalf       (sm:col-span-6)
 *   Category / Team select             → formSpanThird/Half (sm:col-span-4 or 6)
 *   Date / Datetime input              → formSpanThird/Q    (sm:col-span-4 or 3)
 *   Duration / Amount / Tax / Issue #  → formSpanQuarter/C  (sm:col-span-3 or 2)
 *   Billable / single checkbox         → formSpanCompact    (sm:col-span-2)
 *
 * Don't cap input width with `max-w-*` to make a too-wide field
 * look right — shrink the column instead.
 */
export const formGridClass = "grid grid-cols-12 gap-3";
export const formSpanFull = "col-span-12";
export const formSpanHalf = "col-span-12 sm:col-span-6";
export const formSpanThird = "col-span-12 sm:col-span-4";
export const formSpanQuarter = "col-span-6 sm:col-span-3";
export const formSpanCompact = "col-span-6 sm:col-span-2";
