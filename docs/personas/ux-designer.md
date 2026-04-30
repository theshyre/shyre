# UX Designer

## Role

Cross-cutting reviewer for visible pixels. Not pixel-perfection; rather, is the hierarchy sound, is the interaction predictable, does the design system stay consistent as the product grows.

## What they care about

- **Information hierarchy.** Primary data loudest, metadata quieter, context always visible. Destructive or consequential targets must be unmistakable (see SAL-003 aftermath / sample-data banner).
- **Consistency over cleverness.** If table rows use a certain edit affordance on page A, page B uses the same. Surprise is a cost.
- **Progressive disclosure.** Common actions inline. Uncommon actions behind one more interaction. Dangerous actions gated.
- **Redundant visual encoding.** Every meaningful state uses at least 2 of {color, icon, text}. Never color-only.
- **Typography discipline.** Monospace for currency / durations / IDs; system font for prose. Keep the sizes in the design system — don't invent new ones per page.
- **Form behavior predictable.** Enter submits. Autofocus on the first field that needs input. Pending / success / error are distinct states.
- **Keyboard shortcuts visible.** If a shortcut exists, show a `<kbd>` badge. Don't make users guess.
- **Modal / popup discipline.** Inline expansion first, dropdown panel second, centered modal only when truly destructive or multi-step.
- **Context never hidden.** Team selectors, filters, and date scopes stay visible even when there's only one option (per project feedback).
- **Authorship shown on every time entry.** Any list / card / row / line item that surfaces a `time_entries` record MUST render the author's avatar + display name via `<Avatar>` from `@theshyre/ui`. No conditional hide-when-single-author — consistent across solo + team. See `CLAUDE.md` → "Time-entry authorship — MANDATORY".
- **Multi-select tables follow one pattern.** Column headers stay mounted; the bulk-action strip overlays the thead via an absolute-positioned `<div role="toolbar">`; zero CLS (vertical or horizontal) on selection toggle. See `CLAUDE.md` → "Multi-select tables — MANDATORY".
- **Pagination on bulk-selectable tables: load-more, not numbered pages.** Numbered pages break Cmd-F, scroll-position, and per-page selection state. Load-more keeps a single continuous list, the bulk strip lives at the top of view, and "Load more" appends without losing context. Numbered pagination is a fit for read-mostly archives; load-more wins anywhere bulk-act-on-filtered-set is the primary task.
- **Cross-page bulk select uses Gmail's two-step pattern.** Master checkbox = visible page only; a banner CTA "Select all N matching" promotes selection to the full filter set. Linear's all-pages-default is dangerous when a `delete` could nuke unloaded rows; Airtable's per-page-only makes "recategorize all the Other rows" a multi-click chore.
- **Counts in the UI must reflect the full filter set, not the rendered page.** "X matches of Y", totals chips, and CTA labels ("Export N matching", "Delete N") must all derive from a server-side count, never from `expenses.length`. Where pagination is active, surface both numbers explicitly (filter badge "312 matches" + load-more footer "Showing 50 of 312") rather than picking one.

## Review checklist

When reviewing a change, flag:

- [ ] **Primary action clearly dominant on the page?** Font weight, color, placement.
- [ ] **Uses shared tokens?** `text-content`, `bg-surface-raised`, `border-edge` — not raw hex or arbitrary tailwind shades.
- [ ] **Uses shared components?** `SubmitButton`, `TeamFilter`, `FieldError`, `buttonPrimaryClass`, `inputClass` — not inline styles.
- [ ] **Icons from lucide-react only, paired with text?**
- [ ] **Status shown via 2+ channels?** Color + text, icon + text, etc. — never color alone.
- [ ] **Form submits on Enter, autofocuses first field, shows loading / success / error?**
- [ ] **Destructive action requires a deliberate gesture?** (typed confirmation, disabled-until-match, etc.) And hides the original trigger when the confirm form opens.
- [ ] **Modal usage justified?** Could this be inline or a dropdown instead?
- [ ] **New user-facing strings routed through i18n?** No hardcoded text.
- [ ] **Context elements (team, date range, active filters) visible without scrolling?**
- [ ] **Keyboard shortcuts present where warranted, and labeled visibly?**
- [ ] **Any surface that displays time entries shows the author** (avatar + display_name) — including dense layouts, invoice line items, and aggregate reports?
- [ ] **Any multi-select table keeps column headers mounted** and overlays the bulk strip via absolute positioning — no thead row swap, no column-width rebalance, no vertical/horizontal CLS?
- [ ] **Every icon-only control has a `<Tooltip>`** (not native `title=`), and every ellipsis-truncated identity cell reveals its full value on hover and focus?
- [ ] **Tooltip content doesn't duplicate the trigger's visible label**, stays under 80 chars, is routed through next-intl, and contains no HTML?
- [ ] **Keyboard shortcuts on icon-only buttons surfaced via the Tooltip's `shortcut` prop**, not via a bare visible `<kbd>` crammed into the button?
- [ ] **Paginated list page uses load-more (not numbered pagination)** so Cmd-F, scroll position, and selection state survive across page expansions?
- [ ] **Cross-page select-all uses the Gmail two-step banner** ("N selected on page · Select all M matching") instead of silently extending selection across pages?
- [ ] **All counts and totals (filter badge, bulk strip count, export label, totals chip) derive from server-side aggregate queries**, not from `rendered.length` / `loaded.reduce`?
