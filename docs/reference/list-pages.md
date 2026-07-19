# List pages — the canonical grammar (MANDATORY)

Every list page speaks ONE visual language. Codified 2026-07-18 after the
five list surfaces (/invoices, /projects, /proposals, /time-entries?view=table,
/customers) drifted into five different grammars (ux-designer + accessibility
persona convergence review). Rules below each name their **reference
implementation** — when in doubt, read that file. No page invents a new
treatment.

## Slot layout (top to bottom)

```
Row 1  HEADER:   [icon 24 text-accent] [H1 text-page-title font-bold] …… [Export CSV (secondary)] [New X (primary + kbd N)]
Row 2  INSIGHT:  optional ONE-line page stat (icon + text, text-body text-content-secondary)
Row 3  FILTERS:  [TeamFilter] [Status chip] [Entity chips] [DateField pair if needed] … [Search + / kbd] [Clear all]
Row 4  CONTENT:  bordered card = bulk strip + table + PaginationFooter
```

## The six rules

### 1. Filters — chips, instant-apply, URL-driven
Reference: `src/app/(dashboard)/projects/projects-filters.tsx`.
All filters are inline chip dropdowns that apply instantly via URL push.
**No boxed FILTERS panel. No Apply button, ever** (a second
`buttonPrimaryClass` on the page violates primary-dominance). TeamFilter is
the first chip in Row 3, never in the header. Search sits at the right of
the row: rounded input, `/` shortcut with visible kbd, 300ms debounced
instant-apply + Enter commits + Escape clears. Date ranges are a labeled
`DateField` pair in Row 3 (never `<input type="date">`). Default filter
values are stripped from the URL; changing any filter resets `limit`.
A ghost "Clear all" link appears at the row's end when any filter is active.

### 2. Primary action — header row, top-right
Reference: `src/app/(dashboard)/invoices/new-invoice-link.tsx`.
`[Plus 16] label [kbd N]` in `buttonPrimaryClass`, right-aligned in Row 1.
Export CSV in `buttonSecondaryClass` with Download icon immediately left of
it. Exactly ONE `buttonPrimaryClass` per page. Inline-expansion forms keep
rendering below the header; only their trigger lives in the header cluster.
*Sanctioned exception*: Time's timer widgets are stateful controls, not nav
— they stay in the toolbar cluster with Time's Export.

### 3. Header + insight line
Row 1 = 24px lucide icon in `text-accent` + `text-page-title font-bold` H1.
Optional page stat = ONE line under the header (reference: proposals'
awaiting-signature line). No marketing subtitles (that copy belongs in
empty states). No breadcrumbs on single-segment routes.
*Sanctioned exception*: Time's hours masthead is the page's hero metric,
parity-locked across its four views.

### 4. Checkboxes — one shared class, entity-named, ≥24px hit area
Reference: Time's table (`entry-row.tsx`).
Every selection checkbox (row + both masters) uses **`checkboxClass`** from
`src/lib/form-styles.ts` — a styled native input, 16×16 visual, inside a
≥24×24 hit area (padded cell/label; clicks on the wrapper toggle, with
`stopPropagation` where rows are clickable). Bare `<input type="checkbox">`
is banned. Row checkbox `aria-label` NAMES THE ENTITY ("Select {name}", or
description+date for time entries — never a generic "Select entry"). Master
checkbox: `indeterminate` synced via ref; label flips Select/Deselect all.
**If a master checkbox is hidden/demoted when selection starts (Pattern A
overlay), focus MUST move to the surviving master before the old one goes
`aria-hidden`.**

### 5. Bulk strips — pattern per multi-select-tables.md; neutral button chrome
Patterns A/B assignment lives in `docs/reference/multi-select-tables.md`
(criterion: restate-able headers → A; distinct semantic headers → B).
Strip buttons use `bulkStripButtonClass` / `bulkStripDangerButtonClass`
from `src/lib/table-styles.ts` — **neutral border + surface, intent via
colored text/icon; soft-fill backgrounds are banned** (reference: Time's
`InlineBulkDeleteButton`, Projects' neutral Close). Every strip: visible
Clear button (Time reference), `role="toolbar"` + label, selection count in
a polite live region, Escape clears selection EXCEPT when focus is in a
text-editing control or a more specific overlay is open (guard on
text-editing inputs, not `tagName === "INPUT"` — checkboxes are inputs).
Reversible one-way flips (mark paid, close) = tier-1 inline confirm;
destructive = typed confirm + Undo per the destructive-flow tiers.

### 6. Table chrome, empty states, badges
Table shell classes come from `src/lib/table-styles.ts` — inlining those
strings is banned. Empty states use the bordered-card + icon-circle
treatment (reference: `invoices-table.tsx` empty state). Status badges
converge on `<StatusBadge>` (pill + dot + text); bespoke badges keep the
pill shape and ≥2-channel encoding until converged.

## Accessibility invariants (from the same review — non-negotiable)

- Filter chip triggers: `aria-haspopup` + `aria-expanded`, accessible name
  = **dimension + current value** ("Status: Active"), panel closes on
  Escape AND returns focus to the trigger, selected option = check icon +
  `aria-selected` (never color fill alone). Use `<FilterChip>` — do not
  hand-roll the dropdown scaffold.
- One polite `role="status"` live region per list announcing result count
  after a filter commit and "N selected" (debounced) on selection change.
- Never `disabled` on a button whose disabled-reason matters —
  `aria-disabled` + focusable + Tooltip, guard in the handler.
- Verify chip/strip states in light, dark, high-contrast, and malcom themes.

## Shared primitives

| Primitive | Home | Notes |
|---|---|---|
| `checkboxClass` | `src/lib/form-styles.ts` | promotion candidate → `@theshyre/ui` |
| `<FilterChip>` | `src/components/FilterChip.tsx` | trigger+listbox+Escape+focus-return+URL-push scaffold |
| `bulkStripButtonClass` / `bulkStripDangerButtonClass` | `src/lib/table-styles.ts` | |
| `<ListSearchInput>` | `src/components/ListSearchInput.tsx` | rounded + `/` kbd + debounce/Enter/Escape |

No `<DataTable>` / `<ListPageHeader>` mega-components — the
platform-architect ruling in `table-styles.ts` stands; this doc + the
classes are the enforcement mechanism.

## Sanctioned exceptions (the grammar absorbs these; do not "fix" them)

- Time's hours masthead, timer action cluster, and truncation banner.
- Customers' bounced banner (event surface, not a filter).
- Projects' customer-grouped sticky headers (hierarchy display) — but the
  group header row must be `<th scope="rowgroup">`, not a `<td>`.

## Tracked follow-ups (not part of the convergence)

- Gmail-style select-all-matching banner + server-side "N of M" counts.
- Roving tabindex/type-ahead in chip listboxes (or drop listbox roles).
- Per-status icons in `<StatusBadge>`.
