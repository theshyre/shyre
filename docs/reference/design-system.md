# Design system

> Authoritative reference for tokens, typography, layout, icons, and theme. CLAUDE.md links here instead of inlining.

## Token architecture

All colors use semantic CSS custom properties defined in `globals.css` with 3 themes: **light** (default), **dark**, **high-contrast**. Theme is applied via `data-theme` attribute on `<html>`.

**Token naming** — use Tailwind utilities mapped from tokens, never raw hex values:

| Category | Tokens | Usage |
|----------|--------|-------|
| Surfaces | `bg-surface`, `bg-surface-raised`, `bg-surface-inset` | Page bg, cards, table headers |
| Content | `text-content`, `text-content-secondary`, `text-content-muted` | Primary text, secondary, disabled |
| Borders | `border-edge`, `border-edge-muted` | Card borders, dividers |
| Accent | `bg-accent`, `text-accent`, `bg-accent-soft`, `text-accent-text` | Primary actions, active nav, links |
| Status | `text-success`, `bg-success-soft`, `text-error`, etc. | Feedback states |
| Interaction | `bg-hover`, `ring-focus-ring` | Hover states, focus rings |

## Form field styling

**MANDATORY: Use shared styles from `src/lib/form-styles.ts`.** Never inline form field classes.

- `inputClass` — text inputs and selects
- `textareaClass` — textareas
- `searchInputClass` — search fields (with left padding for icon)
- `labelClass` — field labels
- `buttonPrimaryClass`, `buttonSecondaryClass`, `buttonDangerClass`, `buttonGhostClass` — buttons
- `kbdClass` — keyboard shortcut badges

## Icons

**Lucide icons only** — no other icon sets. Import from `lucide-react`.

- Default size: 20px in nav/sidebar, 24px in page headers, 16px inline with button text, 14px in compact contexts
- Always paired with text (redundant visual encoding)

## Theme provider

- `useTheme()` from `@/components/theme-provider` — get/set current theme
- Anti-flash script in `<head>` applies theme before hydration
- Storage key: `stint-theme` in localStorage

## Typography

- Primary: Geist Sans (via the self-hosted [`geist`](https://www.npmjs.com/package/geist) npm package — no build-time Google Fonts fetch)
- Monospace: Geist Mono — used for monetary values, rates, durations

**MANDATORY: use the semantic typography scale defined in `globals.css`.** Never use `text-[Npx]` or raw Tailwind `text-xs`/`text-sm`/`text-base`/`text-lg`/`text-xl` in new code — those are absolute sizes that won't scale with the user's text-size preference.

| Class             | Role                                         | rem    | @ regular (16px) |
|-------------------|----------------------------------------------|--------|------------------|
| `text-label`      | Uppercase micro labels (col headers, framebar titles) | 0.625 | 10px |
| `text-caption`    | Meta info, sublines, timestamps, kbd         | 0.6875 | 11px |
| `text-body`       | Default body, cells, descriptions, inputs    | 0.8125 | 13px |
| `text-body-lg`    | Emphasized body, button labels               | 0.875  | 14px |
| `text-title`      | Section / card titles                        | 1      | 16px |
| `text-page-title` | H1 per page                                  | 1.5    | 24px |
| `text-hero`       | Running timer elapsed, big stats             | 2.25   | 36px |

- Weights are orthogonal: pair with `font-normal` / `font-medium` / `font-semibold` / `font-bold` as the hierarchy demands.
- Table headers: `text-label font-semibold uppercase text-content-muted`
- Page titles: `text-page-title font-bold text-content` with icon
- Monetary/time values: `font-mono tabular-nums` + one of the scale classes
- If you need a size outside this scale, the scale is wrong — propose a new entry rather than inline pixels.

## User-facing text size preference

- Three levels: Compact (14px root) / Regular (16px, default) / Large (18px). Applied via `data-text-size` on `<html>` + a root `font-size`. Every rem scales with the root.
- Persisted in `user_settings.text_size` and mirrored to localStorage (`stint-text-size`) for anti-flash.
- `useTextSize()` from `@/components/text-size-provider` is the client API. `<TextSizeSync />` syncs DB → provider on login. Pattern mirrors theme handling.

## Layout dimensions in px, type in rem — MANDATORY

> **Source of truth: `theshyre-core/CLAUDE.md`** ("Layout dimensions in px, type and text-adjacent padding in rem"). Liv enforces the same rule per-app. The UX-designer persona checklist (`docs/personas/ux-designer.md`) auto-fires on UI changes and flags drift. Don't fork the rule — if Shyre needs an exception, raise it upstream so both apps stay aligned.

The `<html>` font-size override above means every `rem`-based dimension scales with the user's text-size preference. That's exactly what we want for **type** — and exactly what we don't want for **layout**. Without this rule, sidebars widen, gutters shift, and the whole composition slides horizontally when a viewer toggles to Large.

**The split:**

- **Layout dimensions → `px`.** Sidebar widths, top-bar heights, page max-widths, structural gutters between independent regions (sidebar↔main, card grids, totals columns), popover/dropdown widths, scroll-container `max-h-*`, fixed table column widths. Use Tailwind arbitrary values: `w-[256px]`, `max-w-[1280px]`, `px-[32px]`, `gap-[24px]`, `max-h-[240px]`.
- **Type and text-adjacent padding → `rem`.** Every `text-*` from the typography scale, line-heights, button internal padding, table cell padding, nav row internal padding, paragraph reading-measure (`max-w-3xl` on a `<p>`), truncation widths on text (`truncate max-w-xs`). Touch targets growing with type is an a11y win — keep it.

**Examples specific to Shyre:**

- Time-entry rows: cell padding (`px-3 py-2`) stays rem so the click target grows with type. The grid's `<colgroup>` widths (`w-[72px]` per day column) are px so the day grid doesn't drift.
- Invoice line items: the value↔unit gap inside a totals column stays rem; the gap *between* the totals column and the line-items column is structural → `gap-[32px]`.
- Customer / project list cards: card outer width / max-width is px; padding inside the card is rem.
- Popovers (TeamFilter, MemberFilter, ThemePickerPopover, EntryKebabMenu): `w-[*px]` on the panel; internal row `px-3 py-2` stays rem.

**Common conversions** (Tailwind defaults at 16px root — straight px equivalents):

| rem class | px equivalent |
|---|---|
| `w-48` | `w-[192px]` |
| `w-64` | `w-[256px]` |
| `w-80` | `w-[320px]` |
| `max-w-sm` | `max-w-[384px]` |
| `max-w-md` | `max-w-[448px]` |
| `max-w-lg` | `max-w-[512px]` |
| `max-w-2xl` | `max-w-[672px]` |
| `max-w-7xl` | `max-w-[1280px]` |
| `max-h-48` / `max-h-60` | `max-h-[192px]` / `max-h-[240px]` |
| `gap-4` / `px-4` (only when structural) | `gap-[16px]` / `px-[16px]` |
| `gap-8` / `px-8` | `gap-[32px]` / `px-[32px]` |

**Don't** change `@theshyre/design-tokens` to remove the `<html>` override — that's how type still scales, and modal/tooltip/dropdown content rendered via portals depends on it. The fix is per-app: pin structural dimensions to px and let type-adjacent padding ride the rem scale.

**Form-field grids** (`grid-cols-2 gap-4` between First/Last name in a fixed-width form column) are a judgment call. Liv left those as rem — the swing is ~4px and the grid sits inside an already-fixed parent — and Shyre follows that line. Don't churn on these.

## Wayfinding (sidebar + breadcrumbs)

The sidebar and the page-level breadcrumb cooperate to answer "where am I?" with redundant signals. Bullet-pointed for callsite reference; the load-bearing patterns live in `src/components/Sidebar.tsx`, `src/components/Breadcrumbs.tsx`, and `src/lib/breadcrumbs/registry.ts`.

### Sidebar sections

- Three labeled groups: **WORK** (Track + Manage modules + Dashboard), **SETUP** (per-team configuration + setup operations: Business, Settings, Import), **SYSTEM** (sysadmin-only).
- Each group is its own `<nav aria-label>` landmark — screen-reader users can rotor between sections.
- Section header uses `text-label font-semibold uppercase`, `text-content-muted` by default.
- **Active-section emphasis**: when any item in a section is active, its header bumps to `text-content-secondary` (one notch up in contrast). No accent color — that would compete with the loud item-row highlight.

### Sidebar item active state

- `aria-current="page"` for exact-match URLs (the canonical "you are here").
- `aria-current="true"` for ancestor matches (e.g. `/business` while on `/business/abc/people`).
- Visual: `bg-accent-soft text-accent-text` background + foreground. Verify 4.5:1 in light, dark, and high-contrast.

### Breadcrumbs

- Mounted in the dashboard layout above the page content, inside the `max-w-[1280px]` wrapper.
- Hidden when the route doesn't match a registered trail OR the trail is a single segment (page title is enough on its own).
- Format: `Setup › Business › Malcom IO LLC › People`. Separator is **`›`** (U+203A, single right-pointing angle quotation mark) wrapped in a `<span aria-hidden="true">` outside the link's accessible name.
- A11y shape: `<nav aria-label="Breadcrumb">` → `<ol>` → `<li>` per segment. Last segment is `<span aria-current="page">` (text only, not a link).
- Segments are one of three kinds:
  - **Static label** (`labelKey` resolves via `common.breadcrumb.*`).
  - **Dynamic resolver** (`resolver: "businessName"` etc., looks up the human label client-side via `lib/breadcrumbs/resolvers.ts`).
  - **Structural** (`href: null`) — renders as plain text, not a link. "Setup" is the canonical example: it groups items but there's nowhere to navigate to.
- Permission failures fall back to a generic label (`(unavailable)` in en) so a missing-row doesn't crash the breadcrumb.
- Adding a new route: add an entry to `BREADCRUMB_ROUTES` in `src/lib/breadcrumbs/registry.ts`. Order doesn't matter — the matcher sorts by specificity (longest pattern wins).

### Skip link

- First focusable element on the page; visually hidden until focused, then surfaces as a real button at top-left.
- Targets `<main id="main-content" tabIndex={-1}>` so activating it actually moves focus.
- Lives in `src/components/SkipLink.tsx`. Keep this primitive — without it, keyboard users tab through ~15 sidebar items + the breadcrumb before reaching content.
