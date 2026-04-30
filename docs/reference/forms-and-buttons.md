# Form & button rules

> Authoritative reference. CLAUDE.md links here. Rules apply to EVERY form and button in the app — non-negotiable.

## Every form must

1. **Submit on Enter** — native `<form>` with `<button type="submit">` handles this automatically. Never build custom submit buttons that break Enter-to-submit.
2. **Autofocus the primary field** — when opening a form (inline expansion or modal), autofocus the first field the user needs to fill (e.g., `<input autoFocus>`).
3. **Show visual feedback on submission** — use `SubmitButton` component from `@/components/SubmitButton` which provides spinner + "Saving..." + disabled state. No silent submits.
4. **Disable Cancel/back buttons during submission** — `disabled={pending}` on every button in the form while submitting.
5. **Show server errors inline** — use `serverError` from `useFormAction` with the standard error banner pattern.
6. **Show field-level errors below fields** — use `FieldError` component next to each field.
7. **Have a keyboard shortcut if it's a primary action** — "new" forms use `N` key with visible `<kbd>` badge on the trigger button.

## Every button must

1. **Look like its state** — disabled buttons must look visually disabled (opacity, no hover). Enabled buttons have hover states and clear color.
2. **Use shared button classes** — `buttonPrimaryClass`, `buttonSecondaryClass`, `buttonDangerClass`, `buttonGhostClass` from `@/lib/form-styles`. Don't inline button styles.
3. **Show loading state for async actions** — if the click triggers an async operation, show a spinner and disable the button. Use `SubmitButton` for forms.
4. **Never silently succeed or fail** — user must see SOMETHING happen after clicking.

## Destructive confirmation flows

1. **One action button at a time** — when a destructive action reveals a confirmation form, HIDE the original trigger button. Don't show both "Delete" and "Permanently Delete" simultaneously.
2. **Tiered confirmation based on what is actually being destroyed:**
   - **Unsaved local state** (a row the user just added in-session but never committed to the DB — timesheet row with no entries yet, etc.) → inline `[Confirm][Cancel]` via `<InlineDeleteButton />` from `@/components/InlineDeleteButton`. Nothing to undo, cheap action.
   - **Row-level delete of persisted data** (time-entry row with one or more saved entries, anything else that touches the DB) → **typed-confirm via `<InlineDeleteRowConfirm />`**. User types `delete` to arm the red button. Inline expansion, not modal. Escape cancels. Deleting data is deleting data — size of the payload doesn't change the gesture.
   - **Multi-entity or record-level delete** (customer, project, team, void invoice) → typed-name confirmation using the **entity's own name** in an inline form or modal.
   - **Irreversible hard delete of soft-deleted data** (emptying trash) → inline confirm via `<InlineDeleteButton />` is acceptable because the user already decided once to trash the row; the second confirm guards against a stray click. Label it "forever" or equivalent.
3. **Soft delete + Undo toast is mandatory for any destructive action the user could realistically want back.** After delete completes, push an `Undo` toast (`useToast()`) for 10s that restores the soft-deleted row(s). Example: time entry row → `deleteTimeEntryAction` sets `deleted_at`, toast offers `restoreTimeEntriesAction`. A `/trash` surface must exist so users can recover from the grave after the toast expires. This is independent of the confirmation tier — typed-confirm and Undo-toast both apply.
4. **Confirm button disabled until confirmation matches** — typed word/name must match (case-insensitive) before the destructive button enables.
5. **Cancel button always present** — easy escape from destructive flows, plus Escape key from anywhere inside the prompt.

## Field sizing

Forms with mixed-width fields use a 12-column grid (`formGridClass`) and let each field declare the span that fits its content. Don't fall back to `grid-cols-2` for "simple" forms — a 10-character date input and a 200-character description don't share the same horizontal budget. Don't cap input width with `max-w-*` to make an oversized field look right — shrink the column instead.

Default rubric:

| Field type | Span | Constant |
|---|---|---|
| Description / Notes textarea | 12 | `formSpanFull` |
| Project / Customer / Vendor select | 6 | `formSpanHalf` |
| Category / Team select | 4–6 | `formSpanThird` / `formSpanHalf` |
| Date / Datetime input | 3–4 | `formSpanQuarter` / `formSpanThird` |
| Duration / Amount / Tax / Issue # | 2–3 | `formSpanCompact` / `formSpanQuarter` |
| Billable / single checkbox | 2 | `formSpanCompact` |

Concrete examples:

```tsx
import {
  formGridClass,
  formSpanFull,
  formSpanHalf,
  formSpanThird,
  formSpanQuarter,
  formSpanCompact,
} from "@/lib/form-styles";

<div className={formGridClass}>
  <div className={formSpanHalf}>{/* Project */}</div>
  <div className={formSpanHalf}>{/* Category */}</div>
  <div className={formSpanFull}>{/* Description textarea */}</div>
  <div className={formSpanThird}>{/* Date */}</div>
  <div className={formSpanQuarter}>{/* Duration */}</div>
  <div className={formSpanQuarter}>{/* GitHub Issue # */}</div>
  <div className={formSpanCompact}>{/* Billable checkbox */}</div>
</div>
```

The columns collapse to one (`col-span-12`) below the `sm:` breakpoint so a narrow viewport stacks naturally. Gap stays at `gap-3` (rem) per the layout-in-px rule — column spans are unitless ratios; only the gutter is type-adjacent.

Reference implementations: `inline-edit-form.tsx`, `new-time-entry-form.tsx`, `new-expense-form.tsx`, `new-invoice-form.tsx`.
