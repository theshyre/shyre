@AGENTS.md

# CLAUDE.md — Shyre

This file is the always-loaded index for Claude Code. Detailed rules live in `docs/reference/*` — follow the links when a section is relevant.

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
│   ├── supabase/               — browser/server clients, middleware
│   ├── i18n/                   — next-intl config + locale files
│   └── utils/                  — invoice calculations, formatting, etc.
├── __tests__/                  — integration tests
└── types/                      — shared TypeScript types
supabase/migrations/            — SQL migration files
docs/                           — project documentation (also served in-app)
```

## Tooling

- **npm** package manager · **TypeScript strict** (zero `any`) · **Vitest** unit/integration (>90% coverage) · **Playwright** for E2E · **ESLint flat config** · **next-intl** for i18n.

## Code conventions

### TypeScript — strict, no exceptions

- `strict: true` with `noUncheckedIndexedAccess` enabled. Never loosen it.
- No `any` — use `unknown` and narrow, or define a proper type.
- No `@ts-ignore` / `@ts-expect-error` — fix the type instead.
- No `eslint-disable` — fix the lint issue (file-scoped override in `eslint.config.mjs` only with a written rationale).
- No non-null assertions (`!`) unless the value is guaranteed by a preceding check within the same scope.
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Explicit return types on exported functions and server actions.
- Handle all error cases — no swallowed catches, no empty `catch {}` blocks.
- Use `import type` for type-only imports.

### File organization & naming

- Co-locate tests with source: `actions.test.ts` next to `actions.ts`.
- Co-locate page-specific components with their route: `clients/new-client-form.tsx`.
- Shared components → `src/components/`; shared hooks → `src/hooks/`; cross-feature types → `src/types/`.
- SQL columns: `snake_case`. TS interfaces/variables: `camelCase`. React components: `PascalCase`. Filenames: `kebab-case`. Server actions: `verbNounAction` (e.g. `createClientAction`).

## Design system → `docs/reference/design-system.md`

Tokens, typography scale, icons, theme provider, text-size preference, and the **layout-in-px / type-in-rem** rule. Read it before writing UI. Highlights:

- All colors use semantic CSS custom properties — no raw hex.
- Use shared form classes from `src/lib/form-styles.ts` (`inputClass`, `buttonPrimaryClass`, `kbdClass`, etc.). Never inline.
- Lucide icons only.
- Typography: use the semantic scale (`text-body`, `text-title`, …), never `text-[Npx]` or raw `text-xs`/`text-sm`/`text-base`.
- Layout dimensions in `px`, type and text-adjacent padding in `rem`.

## Form & button rules — MANDATORY → `docs/reference/forms-and-buttons.md`

Apply to EVERY form and button. Highlights:

- Forms submit on Enter, autofocus the primary field, use `<SubmitButton>` for visible pending state, disable cancel during submission, render server errors inline, render field errors with `<FieldError>`.
- Buttons use shared classes, look like their state, never silently succeed/fail.
- Destructive flows are tiered (inline `[Confirm][Cancel]` → typed-`delete` → typed-name) and ALWAYS pair with soft-delete + Undo toast where data could be wanted back. `/trash` exists for post-toast recovery.

## Multi-select tables — MANDATORY → `docs/reference/multi-select-tables.md`

Two patterns by column count:

- **Pattern A (overlay strip)**: ≤ 8 columns, headers restate-able. Reference `/time-entries`.
- **Pattern B (sibling strip above)**: > 8 columns, distinct semantic headers. Reference `/business/[id]/expenses`.

Both: zero layout shift on selection, `<col>`-owned widths, indeterminate master checkbox, destructive bulk actions use `<InlineDeleteRowConfirm />` + Undo toast.

## Supabase patterns

- **Server Components** & **Server Actions** → `createClient()` from `@/lib/supabase/server`. Server actions verify `auth.getUser()` first.
- **Client Components** → `createClient()` from `@/lib/supabase/client`.
- **RLS handles authorization** — every table has `user_id`, every policy scopes to `auth.uid() = user_id`.
- **Never bypass RLS** — no service role key in the client app.

## Shared packages — `@theshyre/*` — MANDATORY → `docs/reference/shared-packages.md`

Highlights: stay on the latest published version (caret bump same-day on theshyre-core release), author new generic primitives in `theshyre-core` first (don't inline-then-promote), follow the promotion workflow (publish → bump caret → rewire imports), re-export wrappers only when they add i18n or shield call sites.

## Migrations & deploy ordering — MANDATORY → `docs/reference/migrations.md`

Vercel and `db-migrate.yml` run in **parallel** on push to `main` — no sequencing. Read the playbook before writing a migration. Critical:

- **Additive** (`ADD COLUMN`, `CREATE TABLE/INDEX/POLICY`, nullable FK, new enum value): safe to ship code + migration in one PR. Use `IF NOT EXISTS`.
- **Destructive** (`DROP COLUMN/TABLE`, `ALTER ... NOT NULL` without default, narrowing): **two PRs.** PR 1 removes code references + waits for Vercel deploy; PR 2 is the migration alone. Renames use expand-contract.
- **Timestamps must be monotonic** — check the latest file under `supabase/migrations/`.
- **Allow-lists ↔ CHECK constraints must match.** `ALLOWED_*` sets in `allow-lists.ts`; `src/__tests__/db-parity.test.ts` enforces. Adding a value widens the constraint in the same PR.
- `SUPABASE_DB_URL` repo secret is required for prod migrations — a missing secret is a fire.

## Testing — MANDATORY

- **>90% coverage target** on unit/integration — enforced via Vitest thresholds.
- **Unit tests**: Vitest, co-located with source.
- **Integration tests**: Vitest + real Supabase queries where possible, mocked client for unit tests.
- **E2E**: Playwright for critical flows (auth, create client, track time, generate invoice).
- **Every new file must have a corresponding test file.** No exceptions.
- **Tests must be meaningful** — test behavior, not implementation; cover error paths and edge cases.
- See `docs/reference/testing-roadmap.md` for the catch-up plan.

### Pre-commit gate — `npm run ci:local`

Runs `lint && typecheck && test:coverage && build`. Run before every commit that adds production code. The coverage threshold has tripped twice on shipped-without-tests code; the `build` step catches Next.js-only checks (e.g. `"use server"` modules can only export async functions) that `tsc`/`eslint` miss. Reproduce locally before pushing. If coverage fails: add tests in the SAME commit. Do not lower the floor.

## Security — MANDATORY

- **MFA from day one** — Supabase Auth MFA (TOTP) configurable in user settings.
- **Short-lived sessions** — respect Supabase default token expiration.
- **No secrets in code** — env vars via `.env.local` (gitignored). Flag any hardcoded secret.
- **Never use string interpolation in queries** — always use Supabase client's parameterized methods.
- **Validate at system boundaries** — server actions validate with Zod or equivalent.
- **CORS / auth defaults restrictive** — fail closed.
- **GitHub tokens** (`user_settings.github_token`) are secrets — never log, never return in list queries.
- **Roles & permissions** → `docs/reference/roles-and-permissions.md` — the canonical capability matrix for system admin × team owner / admin / member, including the `isTeamAdmin(role)` predicate (use it instead of inline literal checks) and the four enforcement layers (UI, server action, RLS, DB constraint).

### Error logging — MANDATORY

Every caught error that returns a non-2xx response or falls into a user-visible error path must call `logError()` before returning. The `error_logs` table (viewed at `/admin/errors`) is the only place an admin can triage issues after the fact.

- **Server actions** wrapped in `runSafeAction` log automatically on throw.
- **API routes** (`src/app/api/**/route.ts`) do NOT go through `runSafeAction` — every `catch`, every `if (error) return NextResponse.json(...)`, every per-row collector must call `logError(err, { userId, teamId, url, action })`.
- **Background / fire-and-forget** work — same rule.
- **Don't log expected business outcomes** ("user chose skip on this row") — those go in `skipReasons` or response fields.
- `logError` is fire-and-forget and never throws.

### Security audit trail

When a security issue is discovered: log it in `docs/security/SECURITY_AUDIT_LOG.md` (severity, date, description, risk) → fix it (priority over feature work) → update entry with resolution + commit hash. Never delete entries — append-only.

## UX rules — MANDATORY

### Redundant visual encoding

Every meaningful UI element communicates through ≥2 of 3 channels: icon, text, color. Never color alone. Status indicators show a colored dot AND the word ("Paid"); buttons pair icon + text; error/warning/success pair all three.

### Time-entry authorship

Every time entry displayed anywhere in the app must show who logged it (avatar + display name, or avatar with name-on-hover in dense contexts). No conditional hide based on author count. Render via `<Avatar>` from `@theshyre/ui` paired with `user_profiles.display_name`. Fetch `user_profiles(display_name, avatar_url)` on every query that returns a time entry destined for display. Generalizes to any future user-authored content.

### Entity identity

Every recurring entity rendered as identifying context across multiple surfaces gets a stable, deterministic visual identity-mark in addition to its text name. ≥2 channels (text + identity-mark) on every surface where the entity appears. The identity-mark is type-specific:

- **Members** → round `<Avatar>` from `@theshyre/ui`, hashed on `user_id` via `presetAvatarUrl()`. Existing — satisfied.
- **Customers** → square `<CustomerChip>` with 2-letter initials, hashed on `customer.id` from the same `AVATAR_PRESETS` palette as Avatar. Round vs. square disambiguates "person" vs. "organization" at any size.
- **Categories** → colored dot (existing — see week-timesheet's category dot). The free-form category-color picker today is grandfathered; a follow-up audit will constrain it to the curated palette and verify contrast in light / dark / high-contrast.
- **Projects** → inherit the customer's chip + their own project-name text. No independent identity-mark (would double the visual vocabulary for no scanning gain).

Identity-marks are `aria-hidden="true"` — the accessible name comes from the text label rendered next to the chip. Screen readers never speak "EC" as the customer's identity. Initials collisions (`Atlas Corp` and `Acme Co` both → "AC") are acceptable because color is the disambiguator for sighted users and the full name is always paired.

Colors come from the per-theme `AVATAR_PRESETS` palette (CVD-audited, contrast-vetted) — never free-form HSL hashes. New entity types must reuse the same palette unless a documented contrast audit justifies a separate set.

Surfaces in scope today: time-entries (week / day / log views), customer list, project list / detail, invoice list / detail, dashboard widgets, reports breakdowns, search results, command palette. Out of scope: PDF invoices to clients, statement-of-work exports, customer-facing portals — internal scanning aid, not client-facing branding.

### Navigation feedback

Every nav-triggering action must give visible feedback within 100ms.
- **Global**: `<TopProgressBar />` (mounted in root layout) — don't roll a per-page bar.
- **Per-link**: `<LinkPendingSpinner />` inside any `<Link>`'s children. Mandatory in sidebar items and any other navigation list.
- **Per-route segment**: `loading.tsx` next to `page.tsx` whenever the route does non-trivial server work.
- For non-Link buttons: use `<SubmitButton>` (see Form rules).

### Tooltips → `docs/reference/tooltips.md`

Use `<Tooltip>` from `@theshyre/ui` (re-exported at `@/components/Tooltip`). Native `title=` is banned in new TSX (ESLint enforced). Required on icon-only controls, truncated text whose full value matters, abbreviations, color-only state chips. Forbidden for form errors and critical always-visible info.

### Autosave feedback

Silent saves are a bug. Any form that writes without an explicit submit button must render `<SaveStatus>` next to the form's header/frame title and wrap server-action calls with `useAutosaveStatus()` from `@/hooks/useAutosaveStatus`. If the autosave can destroy data, pair with the Undo-toast pattern.

### Keyboard shortcuts

Every primary action on a page has a keyboard shortcut with a visible `<kbd>` indicator (style via `kbdClass`). Standard combos: `Cmd+S` save, `Cmd+Enter` submit, `Escape` close/cancel, `N` new item, `/` focus search, `Space` start/stop timer (when no input focused). Shortcuts only fire when no text input is focused (except Cmd/Ctrl combos) and no modal is open.

### Popups & overlays

Three patterns by complexity: **inline expansion** (default; 1–3 field quick actions) → **dropdown panel** (forms needing more space) → **centered modal** (destructive confirmations or complex multi-step forms only). Every overlay must be Escape-dismissible. No nested modals.

### Unsaved changes guard

Any page with user-editable data uses `useUnsavedChanges(hasChanges)` to trigger the browser's native "Leave page?" confirmation. Required on: client edit, project edit, settings, invoice editor, manual time-entry form.

### Search & input feedback

Every search/filter field shows feedback for all states: typing-too-short hint, loading spinner, results, no-results with the query, error with retry, empty placeholder describing what can be searched.

## i18n — MANDATORY

Every user-facing string uses translation keys. No hardcoded text.

- **Library**: `next-intl`. Server: `await getTranslations("namespace")`. Client: `useTranslations("namespace")`.
- **Locales**: `src/lib/i18n/locales/{en,es}/{namespace}.json`.
- **Namespaces**: `common`, `auth`, `clients`, `projects`, `time`, `invoices`, `settings`, `reports`.
- **Translate**: nav, labels, buttons, placeholders, errors, status text, table headers.
- **Don't translate**: user-entered data, currency symbols (use locale-aware formatting).

## Documentation — MANDATORY → `docs/reference/documentation.md`

"Shipped but undocumented" is not shipped. Every user-facing feature gets a guide in `docs/guides/features/` in the **same commit** as the feature. Schema/migration → `docs/reference/database-schema.md`. New module → `docs/reference/modules.md`. New env var → `.env.example` AND `docs/guides/admin/env-configuration.md`. Security change → append to `docs/security/SECURITY_AUDIT_LOG.md`. Don't duplicate across guides — write once, link.

## Personas — MANDATORY → `docs/personas/README.md`

8 personas at `docs/personas/*.md` are the source of truth: `solo-consultant`, `agency-owner`, `bookkeeper`, `ux-designer`, `accessibility-auditor`, `qa-tester`, `security-reviewer`, `platform-architect`.

- **Persona sync — CRITICAL.** Each persona has two synced files: `docs/personas/<name>.md` (source) and `.claude/agents/<name>.md` (Claude Code wrapper). Editing one requires editing the other in the same commit. The `.cursor/rules/persona-<name>.mdc` mirrors are legacy (Shyre is Claude-Code-only as of 2026-04-29) and no longer required to stay in sync.
- **Auto-engagement**: craft reviewers and system guardians (QA, Security, UX, Accessibility, Platform) auto-fire on relevant file patterns. Stakeholders (Solo Consultant, Agency Owner, Bookkeeper) are manual-invoke only.
- **Personas review, they don't implement.** Lenses, not gatekeepers — the human decides.
- **Prune stale concerns** when a check becomes a lint rule, a test, or a general CLAUDE.md rule.

## Proactive development — MANDATORY

- **Fix issues as you find them** — bugs, type errors, lint, security concerns. Don't defer, don't leave TODOs.
- **Be proactive** — take a better approach when you see one. Don't ask permission for code-quality wins.
- **No `// TODO` comments** — fix it now or open a tracked issue.
- **No partial implementations** — every feature you touch is complete, tested, documented, and localized before moving on.

## Code generation rules

- **TS strict** — `npm run typecheck` exits zero, no `any`, no `@ts-ignore`.
- **Lint clean** — `npm run lint` exits zero with `--max-warnings=0`. Warnings are errors. CI enforces. Run before declaring any work complete.
- **Tests** — every new `.ts` file gets a `.test.ts`. >90% coverage. Tests are meaningful (behavior, not implementation).
- **i18n** — no hardcoded user-facing strings.
- **Keyboard shortcuts** on interactive elements where applicable.
- **Redundant visual encoding** (≥2 channels) on all status/state UI.
