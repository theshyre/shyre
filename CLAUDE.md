@AGENTS.md

# CLAUDE.md — Shyre

> **Dual-tool project**: This repo uses both Claude Code and Cursor. This file (`CLAUDE.md`) is for Claude Code. Cursor reads `.cursorrules`. Both files enforce identical conventions — if you update one, update the other.

## Project overview

Shyre is a platform for running a consulting business. The time-tracking and invoicing surface ships as the `stint` module inside that platform (see `src/lib/modules/registry.ts`). Built with Next.js 16 (App Router), Supabase (Postgres + Auth + RLS), and Tailwind CSS 4. Deployed on Vercel + Supabase Cloud. Shared UI, theme, and design-token packages come from the `@theshyre/*` scope (source: `/Users/marcus/projects/theshyre-core`, consumed via GitHub Packages).

## Project structure

```
src/
├── app/
│   ├── layout.tsx              — root layout
│   ├── login/page.tsx          — auth
│   ├── (dashboard)/            — authenticated route group
│   │   ├── layout.tsx          — sidebar layout
│   │   ├── page.tsx            — dashboard
│   │   ├── clients/            — client list + [id] detail
│   │   ├── projects/           — project list + [id] detail
│   │   ├── time-entries/       — time entry list + [id] edit
│   │   ├── timer/              — active timer + quick entry
│   │   ├── invoices/           — invoice list + new + [id] detail
│   │   ├── reports/            — reporting dashboard
│   │   └── settings/           — user/business settings
│   ├── auth/callback/route.ts  — Supabase auth callback
│   └── docs/                   — in-app documentation (deployed with app)
├── components/                 — shared UI components
├── hooks/                      — shared React hooks
├── lib/
│   ├── supabase/               — browser client, server client, middleware
│   ├── i18n/                   — next-intl config + locale files
│   └── utils/                  — invoice calculations, formatting, etc.
├── __tests__/                  — integration tests
└── types/                      — shared TypeScript types
supabase/
└── migrations/                 — SQL migration files
docs/                           — project documentation (also served in-app)
```

## Tooling

- **npm** — package manager
- **TypeScript strict mode** — zero `any` usage, ever
- **Vitest** — unit and integration tests, >90% coverage enforced
- **Playwright** — E2E tests for critical flows
- **ESLint flat config** — Next.js recommended + TypeScript strict
- **next-intl** — internationalization (all user-facing strings)

## Code conventions

### TypeScript — strict, no exceptions

- `strict: true` with `noUncheckedIndexedAccess` enabled. Never loosen it.
- No `any` — use `unknown` and narrow, or define a proper type.
- No `@ts-ignore` or `@ts-expect-error` — fix the type instead.
- No `eslint-disable` comments — fix the lint issue.
- No non-null assertions (`!`) unless the value is guaranteed by a preceding check within the same scope.
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Explicit return types on exported functions and server actions.
- Handle all error cases — no swallowed catches, no empty `catch {}` blocks.
- Use `import type` for type-only imports.

### File organization

- Co-locate tests with source: `actions.test.ts` next to `actions.ts`
- Co-locate page-specific components with their route: `clients/new-client-form.tsx`
- Shared components go in `src/components/`
- Shared hooks go in `src/hooks/`
- Types shared across features go in `src/types/`

### Naming conventions

- SQL/Supabase columns: `snake_case` (PostgreSQL convention)
- TypeScript interfaces and variables: `camelCase`
- React components and files: `PascalCase` for components, `kebab-case` for filenames
- Server actions: `verbNounAction` (e.g., `createClientAction`, `archiveClientAction`)

## Design system

### Token architecture

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

### Form field styling

**MANDATORY: Use shared styles from `src/lib/form-styles.ts`.** Never inline form field classes.

- `inputClass` — text inputs and selects
- `textareaClass` — textareas
- `searchInputClass` — search fields (with left padding for icon)
- `labelClass` — field labels
- `buttonPrimaryClass`, `buttonSecondaryClass`, `buttonDangerClass`, `buttonGhostClass` — buttons
- `kbdClass` — keyboard shortcut badges

### Icons

**Lucide icons only** — no other icon sets. Import from `lucide-react`.

- Default size: 20px in nav/sidebar, 24px in page headers, 16px inline with button text, 14px in compact contexts
- Always paired with text (redundant visual encoding)

### Theme provider

- `useTheme()` from `@/components/theme-provider` — get/set current theme
- Anti-flash script in `<head>` applies theme before hydration
- Storage key: `stint-theme` in localStorage

### Typography

- Primary: Geist Sans (via `next/font/google`)
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

### User-facing text size preference

- Three levels: Compact (14px root) / Regular (16px, default) / Large (18px). Applied via `data-text-size` on `<html>` + a root `font-size`. Every rem scales with the root.
- Persisted in `user_settings.text_size` and mirrored to localStorage (`stint-text-size`) for anti-flash.
- `useTextSize()` from `@/components/text-size-provider` is the client API. `<TextSizeSync />` syncs DB → provider on login. Pattern mirrors theme handling.

### Layout dimensions in px, type in rem — MANDATORY

> **Source of truth: `theshyre-core/CLAUDE.md`** ("Layout dimensions in px, type and text-adjacent padding in rem"). Liv enforces the same rule per-app. The UX-designer persona checklist (`docs/personas/ux-designer.md`) auto-fires on UI changes and flags drift. Don't fork the rule — if Shyre needs an exception, raise it upstream so both apps stay aligned.

The `<html>` font-size override above means every `rem`-based dimension scales with the user's text-size preference. That's exactly what we want for **type** — and exactly what we don't want for **layout**. Without this rule, sidebars widen, gutters shift, and the whole composition slides horizontally when a viewer toggles to Large. Liv hit the same leak first; we landed Shyre's per-app sweep alongside it.

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

## Form & button rules — MANDATORY

These rules apply to EVERY form and button in the app. Non-negotiable.

### Every form must:
1. **Submit on Enter** — native `<form>` with `<button type="submit">` handles this automatically. Never build custom submit buttons that break Enter-to-submit.
2. **Autofocus the primary field** — when opening a form (inline expansion or modal), autofocus the first field the user needs to fill (e.g., `<input autoFocus>`).
3. **Show visual feedback on submission** — use `SubmitButton` component from `@/components/SubmitButton` which provides spinner + "Saving..." + disabled state. No silent submits.
4. **Disable Cancel/back buttons during submission** — `disabled={pending}` on every button in the form while submitting.
5. **Show server errors inline** — use `serverError` from `useFormAction` with the standard error banner pattern.
6. **Show field-level errors below fields** — use `FieldError` component next to each field.
7. **Have a keyboard shortcut if it's a primary action** — "new" forms use `N` key with visible `<kbd>` badge on the trigger button.

### Every button must:
1. **Look like its state** — disabled buttons must look visually disabled (opacity, no hover). Enabled buttons have hover states and clear color.
2. **Use shared button classes** — `buttonPrimaryClass`, `buttonSecondaryClass`, `buttonDangerClass`, `buttonGhostClass` from `@/lib/form-styles`. Don't inline button styles.
3. **Show loading state for async actions** — if the click triggers an async operation, show a spinner and disable the button. Use `SubmitButton` for forms.
4. **Never silently succeed or fail** — user must see SOMETHING happen after clicking.

### Destructive confirmation flows:
1. **One action button at a time** — when a destructive action reveals a confirmation form, HIDE the original trigger button. Don't show both "Delete" and "Permanently Delete" simultaneously.
2. **Tiered confirmation based on what is actually being destroyed:**
   - **Unsaved local state** (a row the user just added in-session but never committed to the DB — timesheet row with no entries yet, etc.) → inline `[Confirm][Cancel]` via `<InlineDeleteButton />` from `@/components/InlineDeleteButton`. Nothing to undo, cheap action.
   - **Row-level delete of persisted data** (time-entry row with one or more saved entries, anything else that touches the DB) → **typed-confirm via `<InlineDeleteRowConfirm />`**. User types `delete` to arm the red button. Inline expansion, not modal. Escape cancels. Deleting data is deleting data — size of the payload doesn't change the gesture.
   - **Multi-entity or record-level delete** (customer, project, team, void invoice) → typed-name confirmation using the **entity's own name** in an inline form or modal.
   - **Irreversible hard delete of soft-deleted data** (emptying trash) → inline confirm via `<InlineDeleteButton />` is acceptable because the user already decided once to trash the row; the second confirm guards against a stray click. Label it "forever" or equivalent.
3. **Soft delete + Undo toast is mandatory for any destructive action the user could realistically want back.** After delete completes, push an `Undo` toast (`useToast()`) for 10s that restores the soft-deleted row(s). Example: time entry row → `deleteTimeEntryAction` sets `deleted_at`, toast offers `restoreTimeEntriesAction`. A `/trash` surface must exist so users can recover from the grave after the toast expires. This is independent of the confirmation tier — typed-confirm and Undo-toast both apply.
4. **Confirm button disabled until confirmation matches** — typed word/name must match (case-insensitive) before the destructive button enables.
5. **Cancel button always present** — easy escape from destructive flows, plus Escape key from anywhere inside the prompt.

## Multi-select tables — MANDATORY

Any data table that supports row selection + bulk actions follows one pattern. No exceptions — tables that break these rules get flagged in review.

1. **Column headers stay mounted at all times.** Never swap the `<thead>` row's contents when a selection becomes active. Users lose column context when headers vanish and work gets harder mid-task.
2. **Bulk action strip overlays the header row.** Absolute-positioned `<div role="toolbar">` inside a `position: relative` wrapper around the `<table>`, with `bg-surface-inset` (same as thead) and height measured from the thead via `ResizeObserver` so Compact / Regular / Large text-size preferences all align pixel-perfectly.
3. **Zero layout shift on selection toggle — vertical or horizontal.** Column widths are owned by `<th>` cells only. The strip never mutates `colSpan`, never reserves empty vertical space, never pushes rows down.
4. **`aria-hidden` the `<thead>` while a selection is active** so AT users hear the toolbar, not stale column labels. The master checkbox inside the overlay is the focused control; the thead's master checkbox gets `tabIndex={-1}` so Tab-order doesn't visit it twice.
5. **Escape clears the selection** when no more specific handler is active. Master checkbox shows indeterminate when partial. Keyboard: `Cmd/Ctrl+A` to select all visible is optional but recommended.
6. **Destructive bulk actions use `<InlineDeleteRowConfirm />` + Undo toast** per "Destructive confirmation flows". Summary shows the count (e.g. "3 entries").
7. **Do not extract to `@theshyre/ui` yet.** Shyre owns this pattern via in-place implementation until a second concrete consumer (Liv) adopts it. See the entry-table on `/time-entries` for the reference implementation.

Surfaces that must conform: `/time-entries` (day + week views), `/customers`, `/projects`, `/invoices`, `/trash`, any future list-page table.

## Supabase patterns

- **Server Components**: use `createClient()` from `@/lib/supabase/server`
- **Client Components**: use `createClient()` from `@/lib/supabase/client`
- **Server Actions**: use `createClient()` from `@/lib/supabase/server`, always verify `auth.getUser()` first
- **RLS handles authorization** — every table has `user_id`, every policy scopes to `auth.uid() = user_id`
- **Never bypass RLS** — no service role key in the client app

## Shared packages — @theshyre/* — MANDATORY

Shyre consumes UI, theme, and design-token primitives from `@theshyre/ui`, `@theshyre/theme`, `@theshyre/design-tokens` (source: `/Users/marcus/projects/theshyre-core`, published to GitHub Packages). Liv consumes the same packages. Keeping all three repos in step is load-bearing for cross-repo sharing — drift here is never local.

### Stay on the latest published version

- Shyre's `@theshyre/*` caret ranges in `package.json` must be ≥ the latest version published to GitHub Packages at all times.
- When `theshyre-core` publishes a new version, the follow-up in Shyre (and Liv) is same-day: bump the caret, `npm install`, run `typecheck` + `lint` + `test` + `next build`, commit. Don't carry drift into the next feature commit.
- Compiler + `@types/node` majors stay in lockstep with `theshyre-core` and Liv. A TS major upgrade is not a Shyre-local change — plan it across all three repos.
- **Automated drift check.** A SessionStart hook (`.claude/settings.json` → `scripts/check-theshyre-versions.sh`) compares the three caret ranges to the registry on every Claude Code session and prints a warning if anything is behind. Silent when current. Requires `NODE_AUTH_TOKEN` in your shell env; if unset, the hook skips silently rather than nagging.

### When something belongs in @theshyre/*

Code belongs in the shared packages when **all four** hold:

1. **App-agnostic.** No references to Shyre-specific domain (time entries, invoices, customers, projects, teams) or Liv-specific domain.
2. **No Supabase or DB knowledge.** If it imports from `@/lib/supabase/*` or reads a Shyre table, it stays in Shyre.
3. **Framework-level compatible.** React 19 + Next.js 16 is assumed; Next-specific hooks are acceptable (both apps are Next).
4. **Concrete consumer beyond Shyre.** Liv uses it, or is planned to — "could in theory be generic" isn't enough. Over-promoting pollutes the package API surface.

Fail any one → keep in Shyre.

### Prefer author-in-core for new generic primitives

Before writing a new generic primitive in Shyre (a modal variant, a utility hook, a hashing helper), stop and author it in `theshyre-core/packages/ui` first. Import from `@theshyre/ui`. The "inline today, promote later" pattern consistently creates migration churn — write it once in the right place.

### Promotion workflow

1. **Open a PR in `theshyre-core`** (not Shyre) that adds the primitive + its tests + a changeset entry.
2. Keep the export name stable — renaming at promotion time breaks every Shyre re-exporter on the same day.
3. Publish: `pnpm version-packages` → commit → push → `pnpm release`. Patch or minor per semver.
4. **Then** open a PR in Shyre that:
   - Bumps the caret in `package.json` to the new version.
   - Deletes the local copy (or turns it into a re-export if Shyre call sites use `@/components/Foo` and you don't want to touch every one).
   - Rewires imports: `@/hooks/useFoo` → `@theshyre/ui`.
5. Don't merge the Shyre PR before `npm view @theshyre/<pkg> version` returns the new version.

### Re-export wrappers — when they're OK

Shyre's `src/components/Foo.tsx` re-exporting from `@theshyre/ui` is the right pattern when:
- The wrapper adds i18n labels the base can't know about (e.g. `SaveStatus.tsx`, `InlineDeleteButton.tsx` — they pass next-intl strings into generic primitives).
- Shyre callers use `@/components/Foo` widely and you don't want to touch every site on the promotion day.

Don't create re-export wrappers for their own sake — only when there's a concrete reason.

### App-specific — never promotion candidates

These stay in Shyre regardless of how generic-looking they seem:
- Anything that renders `time_entries`, `invoices`, `customers`, `projects`, `teams`, etc. (`EntryAuthor`, `InvoicePDF`, `Timer`, `Sidebar`, `TeamFilter`)
- Server actions, `safe-action.ts`, RLS helpers, `team-context.ts`, Supabase clients
- Next.js pages, route-group layouts, the dashboard shell
- Shyre-specific Zod schemas and i18n message bundles

If the concept itself moves — e.g. an address-input pattern Liv wants too — the answer is a new package in `theshyre-core`, not cramming it into `@theshyre/ui`.

## Migrations & deploy ordering — MANDATORY

Vercel (app code) and `.github/workflows/db-migrate.yml` (SQL migrations) run in **parallel** on every push to `main` — there is no sequencing. Full playbook in **`docs/reference/migrations.md`**. Read it before writing a migration. Critical rules:

- **Additive migrations** (`ADD COLUMN`, `CREATE TABLE/INDEX/POLICY`, nullable FK, new enum value): safe to ship code + migration in one PR. Use `IF NOT EXISTS` for idempotency.
- **Destructive migrations** (`DROP COLUMN/TABLE`, `ALTER ... NOT NULL` without default, narrowing a type): **two PRs, never one.** PR 1 removes all code references + wait for Vercel deploy; PR 2 is the migration alone. Renames use expand-contract (add → backfill + dual-write → flip reads → drop); see `rename_organizations_to_teams`.
- **Timestamps must be monotonic** — check the latest file under `supabase/migrations/` before picking one so `supabase db push` doesn't need `--include-all`.
- **Allow-lists ↔ CHECK constraints must match.** `ALLOWED_*` sets live in `allow-lists.ts` next to their action file; `src/__tests__/db-parity.test.ts` walks every migration and compares. Adding a value requires widening the constraint in the same PR, and the pair must be wired into `PAIRS` in the parity test.
- `SUPABASE_DB_URL` repo secret is required for prod migrations — a missing secret is a fire, not a warning. Never disable `db-verify.yml` to force a merge.

## Testing — MANDATORY

- **>90% coverage target** on unit and integration tests — enforced via Vitest coverage thresholds
- **Unit tests**: Vitest, co-located with source (`*.test.ts` next to `*.ts`)
- **Integration tests**: Vitest + real Supabase queries where possible, mocked Supabase client for unit tests
- **E2E tests**: Playwright for critical flows (auth, create client, track time, generate invoice)
- **Every new file must have a corresponding test file** — no exceptions
- **Tests must be meaningful** — test behavior, not implementation. Test error paths, edge cases, and boundary conditions, not just happy paths
- **No untested code gets committed** — run tests before declaring work complete

## Security — MANDATORY

- **MFA support from day one** — Supabase Auth MFA (TOTP) must be configurable in user settings
- **Short-lived sessions** — respect Supabase default token expiration
- **No secrets in code** — use environment variables via `.env.local` (gitignored). Flag any hardcoded secrets immediately
- **Never use string interpolation in queries** — always use Supabase client's parameterized methods
- **Validate at system boundaries** — all user input validated before database operations (server actions validate with Zod or equivalent)
- **CORS / auth defaults must be restrictive** — fail closed, never fail open
- **GitHub tokens** (stored in `user_settings.github_token`) must be treated as secrets — never log, never return in list queries, only return to the owning user in the settings page

### Error logging — MANDATORY

**Every caught error that returns a non-2xx response or falls into a user-visible error path must call `logError()` before returning.** The `error_logs` table (viewed at `/admin/errors`) is the only place an admin can triage issues after the fact — silent `console.error` or a banner the user dismissed leaves support blind.

- **Server actions** wrapped in `runSafeAction` get this automatically — the wrapper logs on throw.
- **API routes** (`src/app/api/**/route.ts`) do NOT go through `runSafeAction`. Every `catch` block, every `if (error) return NextResponse.json(...)` path, every per-row collector (`errors.push(...)`) must call `logError(err, { userId, teamId, url, action })` alongside.
- **Background / fire-and-forget** work (webhooks, import loops, scheduled jobs) — same rule. If it can fail and you caught it, log it.
- **What NOT to log**: expected business-logic outcomes that aren't errors — "user chose skip on this row," "no matching project to attach the entry to." Those belong in `skipReasons` or equivalent response fields, not `error_logs`.
- `logError` is fire-and-forget and never throws — safe to call from any code path, no performance cost on the happy path.

### Security audit trail

When a security issue is discovered:
1. Log it in `docs/security/SECURITY_AUDIT_LOG.md` with severity, date, description, and risk
2. Fix it — security issues take priority over feature work
3. Update the log entry with the resolution and commit hash
4. Never delete entries — the log is append-only

## Redundant visual encoding — MANDATORY

**Every meaningful UI element must communicate through at least 2 of 3 visual channels: icon, text, and color.** Never rely on a single channel alone.

- **Section headers**: icon + text label (always)
- **Status indicators**: color + text (never color alone) — e.g., invoice status shows a colored dot AND the word "Paid"
- **Action buttons**: icon + text — e.g., `[+ Add Client]`, `[▶ Start Timer]`
- **Error / warning / success states**: color + icon + text (all 3)
- **Timer state**: color (green=running, gray=stopped) + icon (play/pause) + text ("Running" / "Stopped")

This ensures accessibility for colorblind users and provides clear communication at a glance.

## Time-entry authorship — MANDATORY

**Every time entry displayed anywhere in the app must show who logged it.** Avatar + display name, or avatar with name-on-hover in dense contexts. No exceptions — consistent across solo and team scenarios so the UI doesn't change behavior based on how many authors exist in the row set.

Applies to (not exhaustive):
- `/time-entries` weekly grid + day view + running-timer cards + trash view
- Reports page aggregations (per-member breakdown, billable totals)
- Dashboard recent-entries
- Customer detail / project detail entry lists
- Invoice detail line items (each line item traces back to a time entry)
- Any future list/card that surfaces a `time_entries` row

**Rendering primitive**: `<Avatar>` from `@theshyre/ui`. Pair with `user_profiles.display_name`. Fetch `user_profiles(display_name, avatar_url)` on every query that returns a time entry destined for display.

**Why**: without this, a viewer on a multi-author team can't tell whose work they're looking at — a silent data-attribution bug that gets worse as teams grow. A solo consultant sees their own avatar and gains a visual signal that the data is theirs, so the consistency cost is small.

**Generalizes**: the same rule extends to any future user-authored content (comments, notes, log lines). When adding such an entity, route display through an author slot as a first-class concern, not an afterthought.

## Navigation feedback — MANDATORY

**Every nav-triggering action must give visible feedback within 100ms.** A user clicking and seeing nothing happen is a bug, full stop. The slowest server render still has to feel responsive.

The standard pattern, already wired:

- **Global**: `<TopProgressBar />` (mounted in root layout). Slim accent bar at the top of the viewport. Fires on any in-app link click, snaps + fades on completion. Use as-is — don't roll a per-page bar.
- **Per-link**: `<LinkPendingSpinner />` placed inside any `<Link>`'s children. Uses Next 16's `useLinkStatus` to show a small spinner on the specific link that was clicked. Mandatory in all sidebar items and in any other navigation list (cards on `/business`, doc index links, etc.).
- **Per-route segment**: `loading.tsx` at the route-group level (currently `(dashboard)/loading.tsx`). Renders a skeleton if the server render takes >300ms. Add a `loading.tsx` next to a `page.tsx` whenever the route does non-trivial server work.

For non-Link interactions (buttons that trigger server actions, mutations), the existing rule applies: `<SubmitButton>` shows the spinner / pending state, errors render inline, success is acknowledged. See "Form & button rules".

Don't:
- Don't build a custom progress bar per page. There's one global bar.
- Don't omit `<LinkPendingSpinner />` from a navigation link "because the destination is fast." Speed varies — feedback shouldn't.
- Don't show the progress bar for non-navigation interactions (use `<SubmitButton>` for those).

## Tooltips — MANDATORY

**Tooltips are a progressive-disclosure channel, not a storage medium.** Never hide critical content behind hover. Use the `<Tooltip>` primitive from `@theshyre/ui` (re-exported at `@/components/Tooltip`) for every eligible case. The native HTML `title=` attribute is banned in new TSX; an ESLint rule enforces this.

**Required on:**
- Icon-only interactive controls (buttons, links, menu items) — including disabled ones via `showOnDisabled`.
- Truncated text (`truncate` / `line-clamp-*`) whose full value conveys identity or state — customer names, project titles, invoice numbers, entry descriptions in dense grids.
- Abbreviations, initialisms, and terse codes (`MFA`, `TOTP`, `PO#`, ISO-week codes).
- Color-only state chips / dots / pills with no adjacent text.
- "Coming soon" / placeholder nav pills.

**Forbidden for:**
- Form validation errors (use `<FieldError>` — `aria-describedby` on a sometimes-rendered bubble is the wrong plumbing for an always-load-bearing error).
- Critical information that must always be visible — put it inline.
- Long-form content (more than two lines, headings, lists, links) — use a popover or inline disclosure.
- Controls that already have a visible text label *and* no keyboard shortcut to surface.
- Nested tooltips (never).

**Content:** ≤80 characters, single line preferred, imperative for actions ("Stop timer"), descriptive for state ("Shared with 3 organizations"), never duplicates the trigger's visible label, routed through `next-intl`, no trailing period, no HTML. Keyboard shortcuts render inside the bubble as a `<kbd>` badge via the `shortcut` prop.

**Behavior:** 500 ms mouse-open delay, 0 ms focus-open; 100 ms close delay with hoverable bubble (WCAG 2.1 SC 1.4.13); Escape dismisses; one tooltip open at a time; `top`-default auto-flipping position; no arrow; `@media (hover: none)` suppresses entirely (no long-press workaround — mobile-important content must be visible inline); `prefers-reduced-motion` disables the fade.

**Accessibility:** `labelMode="describe"` (default) wires `aria-describedby` — tooltip supplements the trigger's existing accessible name. `labelMode="label"` wires `aria-label` — tooltip text IS the name (use only for icon-only triggers with no other text source). Never duplicate the trigger's own `aria-label` in describe mode. Bubble uses `bg-content` + `text-content-inverse` + `border-edge` — inverted-surface tokens that pass AA across light / dark / high-contrast. `showOnDisabled` wraps the child in a focusable `<span>` so hover + focus fire when the underlying button is disabled; that span is the only sanctioned place to add `tabIndex={0}` to otherwise non-interactive content.

## Autosave feedback — MANDATORY

**Silent saves are a bug.** Any form that writes to the server without an explicit submit button — blur-commits, debounced inputs, optimistic toggles, inline-edit grids — must render a visible save-state indicator.

- **Source of truth**: `useAutosaveStatus()` from `@/hooks/useAutosaveStatus`. The hook exposes `{ status, wrap, lastSavedAt, lastError, reset }`. Wrap every server-action call with `save.wrap(action(fd))`.
- **Indicator**: `<SaveStatus status={...} lastSavedAt={...} />` from `@/components/SaveStatus`. Render it next to the form's header or frame title. Three-channel encoding (icon + color + text): spinner+muted "Saving…", check+success "Saved just now / Nm ago", alert+error "Save failed".
- **Surfaces that need it**: weekly timesheet, client/customer edit, project edit, settings pages, invoice editor, any future autosaving form.
- **Don't**: render a custom pill per form, log to console only, rely on React Transitions alone, or display "Saved" permanently without the relative timestamp.
- **Paired with undo**: if the autosave can destroy data (e.g., zeroing a timesheet cell soft-deletes entries), combine `<SaveStatus/>` with the Undo-toast pattern (see "Destructive confirmation flows").

## Keyboard shortcuts — MANDATORY

**Every primary action on a page must have a keyboard shortcut with a visible indicator.**

- **Primary actions** (New Client, Start Timer, Save) → single key (`N`) or modifier combo (`Cmd+S`)
- **Visual indicator** → show the shortcut as a `<kbd>` badge on or next to the button
- **kbd style** → use `kbdClass` from `@/lib/form-styles`
- **Activation rules** → shortcuts only fire when no text input is focused (except Cmd/Ctrl combos), no modal is open
- **Search focus** → `/` key focuses the search/filter field on any list page
- **Standard combos** → `Cmd+S` = save, `Cmd+Enter` = submit, `Escape` = close/cancel, `N` = new item
- **Timer** → `Space` to start/stop timer (when no input focused)

## Internationalization (i18n) — MANDATORY

**Every user-facing string must use translation keys.** No hardcoded text in components.

- **Library**: `next-intl` — server components use `getTranslations()`, client components use `useTranslations()`
- **Locale files**: `src/lib/i18n/locales/{locale}/{namespace}.json`
- **Default locales**: `en` (English), `es` (Spanish)
- **Namespaces**: `common` (shared: nav, buttons, statuses), `auth`, `clients`, `projects`, `time`, `invoices`, `settings`, `reports`
- **When adding a new page or component:**
  1. Add English strings to the appropriate namespace file in `src/lib/i18n/locales/en/`
  2. Add Spanish translations to the corresponding file in `src/lib/i18n/locales/es/`
  3. Use `t("key")` in the component — never hardcode user-facing text
- **What gets translated**: Navigation, labels, buttons, placeholders, error messages, status text, table headers
- **What does NOT get translated**: User-entered data (client names, project names), currency symbols (locale-aware formatting instead)
- **Pattern for server components**: `const t = await getTranslations("namespace");`
- **Pattern for client components**: `const t = useTranslations("namespace");`

## Popups & overlays — MANDATORY

**Three patterns, choose by task complexity:**

- **Inline expansion** (default): Form expands in-place, no overlay. Use for 1–3 field quick actions (add client, quick time entry).
- **Dropdown panel**: Positioned panel from trigger button. Use for forms needing more space (new project, template picker).
- **Centered modal**: Full overlay, dimmed backdrop. Use ONLY for destructive/irreversible confirmations (archive client, void invoice) or complex multi-step forms (MFA setup, invoice generation).

**Rules:**
- Default to inline expansion. Only escalate when justified.
- Every overlay must be dismissible via Escape.
- No nested modals — use inline state changes within the same modal.

## Unsaved changes guard — MANDATORY

**Any page with user-editable data must warn before navigation.**

- Use a `useUnsavedChanges(hasChanges)` hook
- Triggers the browser's native "Leave page?" confirmation on navigate/close/refresh
- Required on: client edit, project edit, settings page, invoice editor, manual time entry form

## Search & input feedback — MANDATORY

**Every search/filter field must show clear feedback for all states:**

- **Typing (< min chars)** → hint: "Type at least 2 characters"
- **Loading** → spinner or "Searching..."
- **Results found** → show results
- **No results** → "No results for '{query}'"
- **Error** → "Search unavailable" with retry
- **Empty query** → placeholder describing what can be searched

## Documentation — MANDATORY

**"Shipped but undocumented" is not shipped.** Full layout + guide format in **`docs/reference/documentation.md`**. Critical rules:

- Docs live in `docs/` and are served in-app at `/docs` via `react-markdown` + `remark-gfm`.
- `docs/guides/features/` = cross-role feature docs; `docs/guides/{agency,bookkeeper,admin}/` = role-specific additions only (never duplicate feature content there, link to it). `docs/reference/` for technical, `docs/security/` for audit log, `docs/personas/` for AI personas.
- The `/docs` landing is role-aware: surfaces relevant links based on logged-in user's role mix.
- Every user-facing feature gets a guide in `docs/guides/features/` in the **same commit** as the feature. Required updates per change:
  - Schema / migration → `docs/reference/database-schema.md`
  - New module / shell concept → `docs/reference/modules.md`
  - New env var → `.env.example` AND `docs/guides/admin/env-configuration.md`
  - Security change → `docs/security/SECURITY_AUDIT_LOG.md` (append-only)
  - Deferred / unshipped → relevant guide + `docs/personas/README.md`
- Guide format: title → where it lives → how-to steps → constraints/permissions → keyboard shortcuts → related links. ≤ ~200 lines; split if it grows.
- Don't duplicate across guides (write once, link). Don't leave stale guides when features are removed. Don't skip the guide because the feature is "simple".

## Proactive development — MANDATORY

- **Fix issues as you find them** — do not defer, do not leave TODOs. If you encounter a bug, type error, lint issue, or security concern while working on something else, fix it immediately.
- **Be proactive** — if you see a better approach while implementing, take it. Don't ask for permission to improve code quality.
- **No TODO comments** — either fix it now or create a tracked issue. `// TODO` is not a plan.
- **No partial implementations** — every feature you touch must be complete, tested, documented, and localized before moving on.

## Personas — MANDATORY

Personas are stakeholder / craft / guardian lenses used by AI agents to review Shyre from perspectives other than the implementer's. Source of truth: `docs/personas/*.md` (8 personas: `solo-consultant`, `agency-owner`, `bookkeeper`, `ux-designer`, `accessibility-auditor`, `qa-tester`, `security-reviewer`, `platform-architect`). Full policy + auto-engagement mapping in **`docs/personas/README.md`**.

- **Tool wrappers** at `.claude/agents/<name>.md` and `.cursor/rules/persona-<name>.mdc` must reference the source, not duplicate it.
- **Persona sync — CRITICAL.** Every persona has three files — `docs/personas/<name>.md` (source), `.claude/agents/<name>.md`, `.cursor/rules/persona-<name>.mdc`. **Editing any one requires editing the other two in the same commit.** Add / rename / retire everywhere together. This is stricter than the general CLAUDE.md ↔ .cursorrules parity — for personas, `docs/personas/` is the source and wrappers must never drift.
- **Auto-engagement**: craft reviewers and system guardians (QA Tester, Security Reviewer, UX Designer, Accessibility Auditor, Platform Architect) auto-fire on relevant file patterns — see `docs/personas/README.md` for the current mapping. Stakeholder voices (Solo Consultant, Agency Owner, Bookkeeper) are **manual-invoke only** — running them on every change turns them into noise.
- **Personas review, they don't implement.** Each file ends with a concrete checklist, ≤100 lines. Personas are lenses, not gatekeepers — conflicting reviews are expected; the human decides.
- **Prune stale concerns.** When a persona's check becomes a lint rule, a test, or a general CLAUDE.md rule, delete that bullet. Update personas when prod surprises slip past them.
- **Using in prompts**: Claude Code `@<persona-name>` invokes the subagent; Cursor enables the rule from the rule picker.

## Code generation rules (Claude Code + Cursor)

> **Keep in sync**: These rules are duplicated in `.cursorrules`. If you modify rules here, update `.cursorrules` to match. Persona sync is stricter — see above.

- **All code must be TypeScript strict mode** — no `any`, no `@ts-ignore`. `npm run typecheck` must exit zero.
- **`npm run lint` must exit zero with `--max-warnings=0`.** Warnings are treated as errors. No `eslint-disable` to make it pass — fix the underlying code or, in a true exception, add a file-scoped override in `eslint.config.mjs` with a written rationale (see the Avatar example). The `.github/workflows/ci.yml` job enforces this; a failing lint run blocks the merge, no matter how trivial the warning looks. Run lint before declaring any work complete — it is never "a follow-up".
- **All code must have tests** — every new `.ts` file needs a `.test.ts` file
- **>90% test coverage** — enforced via Vitest coverage thresholds
- **Tests must be meaningful** — test behavior, not implementation
- **All user-facing strings must use i18n** — no hardcoded text
- **All interactive elements must have keyboard shortcuts** where applicable
- **All status/state UI must use redundant visual encoding** (2+ channels)
