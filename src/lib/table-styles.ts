/**
 * Shared data-table styles.
 *
 * MANDATORY: Use these constants for `<table>` chrome instead of
 * inlining classNames. The CLAUDE.md typography rule bans
 * `text-sm` / `text-base` / raw `text-[Npx]` in favor of the
 * semantic scale; tables had drifted into `text-sm` territory.
 *
 * Why no `<DataTable>` primitive: per the platform-architect
 * review, the two multi-select patterns (overlay strip vs sibling
 * strip), the `<col>`-owned widths, and the density-attribute
 * system aren't worth locking into a single component yet — and
 * Liv has no consumer driving it. Standardize the chrome instead;
 * promote later if a real second consumer appears.
 */

/**
 * The outer `<table>` element. `w-full` so it fills its container,
 * `text-body` so type scales with the user's text-size preference
 * (per the typography scale rule).
 */
export const tableClass = "w-full text-body";

/**
 * The `<thead>`'s row. Bottom rule + inset background — same shape
 * Shyre invoice / customer / project list pages already use.
 */
export const tableHeaderRowClass =
  "border-b border-edge bg-surface-inset";

/**
 * Header `<th>` cell. Uppercase labels, muted color, slight padding.
 * Caller appends `text-left` / `text-right` as needed.
 */
export const tableHeaderCellClass =
  "px-4 py-3 text-label font-semibold uppercase tracking-wider text-content-muted";

/**
 * Body `<tr>`. Bottom divider (last row drops it via last:border-0)
 * and a hover tint for clickable rows. Pages with non-clickable
 * tables can omit `hover:bg-hover` by composing only the parts
 * they want — this constant covers the common case.
 */
export const tableBodyRowClass =
  "border-b border-edge last:border-0 hover:bg-hover transition-colors";

/**
 * Body `<td>`. Caller appends alignment / mono / tabular-nums when
 * the column needs it (e.g. amounts, dates).
 */
export const tableBodyCellClass = "px-4 py-3 text-content-secondary";

/**
 * Wrapping container for tables that need a bordered card. Most
 * list pages use this shell + the `tableClass` inside.
 */
export const tableWrapperClass =
  "overflow-hidden rounded-lg border border-edge bg-surface-raised";
