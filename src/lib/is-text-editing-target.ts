/**
 * Guard for page-level Escape handlers (clear table selection, close
 * panels): skip ONLY when focus is in a control where Escape has a
 * text-editing meaning (revert/clear typing, close a picker).
 *
 * The naive `tagName === "INPUT"` guard is wrong — checkboxes and
 * radios ARE inputs but have no text-editing Escape semantics, so
 * Escape pressed while a row checkbox has focus must still clear the
 * selection (docs/reference/list-pages.md rule 5).
 */

/** `<input type>` values with NO text-editing semantics — Escape from
 *  these should fall through to page-level handlers. Everything else
 *  (text, search, date, number, email, the missing-attribute default,
 *  and any future typed variant) is treated as text-editing: fail
 *  closed so we never hijack Escape from a control the user is typing
 *  in. */
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
  "image",
  "hidden",
]);

/** True when the event target is a control where Escape means
 *  "cancel my editing", so a page-level Escape handler should skip. */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type.toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}
