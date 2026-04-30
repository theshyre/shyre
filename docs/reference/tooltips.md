# Tooltips

> Authoritative reference. CLAUDE.md links here.

**Tooltips are a progressive-disclosure channel, not a storage medium.** Never hide critical content behind hover. Use the `<Tooltip>` primitive from `@theshyre/ui` (re-exported at `@/components/Tooltip`) for every eligible case. The native HTML `title=` attribute is banned in new TSX; an ESLint rule enforces this.

## Required on

- Icon-only interactive controls (buttons, links, menu items) — including disabled ones via `showOnDisabled`.
- Truncated text (`truncate` / `line-clamp-*`) whose full value conveys identity or state — customer names, project titles, invoice numbers, entry descriptions in dense grids.
- Abbreviations, initialisms, and terse codes (`MFA`, `TOTP`, `PO#`, ISO-week codes).
- Color-only state chips / dots / pills with no adjacent text.
- "Coming soon" / placeholder nav pills.

## Forbidden for

- Form validation errors (use `<FieldError>` — `aria-describedby` on a sometimes-rendered bubble is the wrong plumbing for an always-load-bearing error).
- Critical information that must always be visible — put it inline.
- Long-form content (more than two lines, headings, lists, links) — use a popover or inline disclosure.
- Controls that already have a visible text label *and* no keyboard shortcut to surface.
- Nested tooltips (never).

## Content

≤80 characters, single line preferred, imperative for actions ("Stop timer"), descriptive for state ("Shared with 3 organizations"), never duplicates the trigger's visible label, routed through `next-intl`, no trailing period, no HTML. Keyboard shortcuts render inside the bubble as a `<kbd>` badge via the `shortcut` prop.

## Behavior

500 ms mouse-open delay, 0 ms focus-open; 100 ms close delay with hoverable bubble (WCAG 2.1 SC 1.4.13); Escape dismisses; one tooltip open at a time; `top`-default auto-flipping position; no arrow; `@media (hover: none)` suppresses entirely (no long-press workaround — mobile-important content must be visible inline); `prefers-reduced-motion` disables the fade.

## Accessibility

`labelMode="describe"` (default) wires `aria-describedby` — tooltip supplements the trigger's existing accessible name. `labelMode="label"` wires `aria-label` — tooltip text IS the name (use only for icon-only triggers with no other text source). Never duplicate the trigger's own `aria-label` in describe mode. Bubble uses `bg-content` + `text-content-inverse` + `border-edge` — inverted-surface tokens that pass AA across light / dark / high-contrast. `showOnDisabled` wraps the child in a focusable `<span>` so hover + focus fire when the underlying button is disabled; that span is the only sanctioned place to add `tabIndex={0}` to otherwise non-interactive content.
