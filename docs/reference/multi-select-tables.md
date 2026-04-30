# Multi-select tables

> Authoritative reference. CLAUDE.md links here. Any data table that supports row selection + bulk actions uses one of two patterns. Pick by **column count**.

## Pattern A — overlay strip (≤ 8 semantic columns)

Dense numeric grids where short, restate-able headers ("Mon Apr 21") aren't load-bearing for the user mid-task. Bulk strip absolute-positions OVER the thead; column headers stay mounted in DOM but are visually replaced by the toolbar.

**Reference**: `/time-entries` (day + week views).

**Specifics:**
- Absolute-positioned `<div role="toolbar">` inside a `position: relative` wrapper around the `<table>`, with `bg-surface-inset` (same as thead) and height measured from the thead via `ResizeObserver` so Compact / Regular / Large text-size preferences all align.
- `aria-hidden` the `<thead>` while a selection is active so AT users hear the toolbar, not stale column labels. Thead's master checkbox gets `tabIndex={-1}` so Tab-order doesn't visit it twice.

## Pattern B — sibling strip above (> 8 semantic columns)

Wide tables where each column carries distinct semantic content (Date / Category / Vendor / Description / Notes / Project / Amount / Author / Actions) and headers are NOT restate-able from memory. Bulk strip renders as a SIBLING above the `<table>`, inside the same bordered container. Headers stay fully visible.

**Reference**: `/business/[id]/expenses`.

**Specifics:**
- Strip is a regular `<div role="toolbar">` rendered before the `<table>` in the same bordered container. Same `bg-surface-inset border-b border-edge` tokens as the thead so the visual treatment reads as a continuation.
- No `aria-hidden`, no `tabIndex={-1}` plumbing — the thead stays fully interactive. The strip's master checkbox is the only one that's interactive while the strip is visible (the thead's master checkbox is hidden behind a conditional, OR — simpler — both stay visible and toggling either toggles the same selection state).
- No ResizeObserver dance.

## Common rules for both patterns

1. **Zero layout shift on selection toggle — vertical or horizontal.** Column widths are owned by `<col>` elements in a `<colgroup>` (with `table-fixed` on the `<table>`). The strip never mutates `colSpan`, never reserves empty vertical space, never pushes rows down.
2. **Master checkbox shows indeterminate when partial.** Escape clears the selection when no more specific handler is active. Keyboard: `Cmd/Ctrl+A` to select all visible is optional but recommended.
3. **Destructive bulk actions use `<InlineDeleteRowConfirm />` + Undo toast** per "Destructive confirmation flows" in `forms-and-buttons.md`. Summary shows the count (e.g. "3 entries").
4. **Inline acknowledgment in the strip on success.** Don't replace the count + clear button with the ack — render alongside so the user can still see what's selected and dismiss it. Toast at viewport bottom is the persistent record; strip ack is the in-place signal.
5. **Bulk action handlers must check `result.success` from `runSafeAction`-wrapped server actions.** On failure: error toast + re-throw (so any in-menu Done state is skipped). On success: success toast.

## Surfaces that must conform

- Pattern A: `/time-entries` (day + week views).
- Pattern B: `/business/[id]/expenses`, `/customers`, `/projects`, `/invoices`, `/trash`, any future wide list-page table.

## Promotion

Both patterns: do not extract to `@theshyre/ui` yet. Shyre owns this pattern via in-place implementation until Liv adopts it.
