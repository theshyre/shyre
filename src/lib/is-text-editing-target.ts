/**
 * True when the event target is a text-EDITING control — the guard the
 * list-page Escape-clears-selection handler must use
 * (docs/reference/list-pages.md rule 5): "guard on text-editing inputs,
 * not `tagName === "INPUT"` — checkboxes are inputs".
 *
 * Text-editing means the control has a caret Escape might interact
 * with: <textarea>, contenteditable regions, and <input> types that
 * accept typed text. Checkboxes, radios, buttons, ranges, etc. are
 * NOT text-editing — Escape while one of those is focused should
 * still clear the selection.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type);
  }
  return false;
}
