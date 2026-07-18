/**
 * True when a dialog/modal is currently open anywhere in the document.
 *
 * Single-letter and bare-arrow page shortcuts must not fire underneath an
 * open modal (the project keyboard rule: "shortcuts only fire when … no
 * modal is open") — e.g. pressing `n` with the `?` keyboard-help dialog
 * open used to pop the add-row form behind it, and ←/→ flipped weeks.
 * Checking the DOM beats threading open-state through every consumer:
 * any dialog rendered by any component (Modal, the send-confirm popover,
 * future ones) is covered as long as it carries dialog semantics — which
 * the a11y rules require anyway.
 */
export function anyDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [aria-modal="true"]',
    ) !== null
  );
}
