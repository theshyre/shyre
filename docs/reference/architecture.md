# Architecture Overview

> Last regenerated: 2026-05-05.

## Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 16 (App Router) | Full-stack React, SSR, server actions |
| Database | Supabase (PostgreSQL) | Hosted Postgres, Auth, RLS |
| Auth | Supabase Auth + TOTP MFA | Email/password, optional MFA enrollment |
| Styling | Tailwind CSS 4 + `@theshyre/design-tokens` | Semantic typography scale, themes |
| Shared UI | `@theshyre/ui` (private GitHub Packages) | Avatar, Tooltip, AlertBanner, FieldError, Modal, etc. |
| i18n | next-intl | Server + client; locale files per namespace |
| Icons | Lucide React | Consistent iconography |
| PDF | `@react-pdf/renderer` (client-side) | Invoice PDFs rendered in-browser |
| Email | Resend (per-team config) + svix | Outbound mail with envelope-encrypted API keys |
| Testing | Vitest + Testing Library | Unit + integration; coverage gate enforced |
| Integration | Vitest with real Supabase | RLS regression suite at `src/__integration__/rls/` |
| E2E | Playwright | Critical-flow specs at `e2e/` |
| Deployment | Vercel + Supabase Cloud | Auto-deploy from GitHub on push to `main` |
| CI | GitHub Actions | `check` (lint/typecheck/test/coverage) blocks merge; `integration` + `e2e` jobs run when staging secrets are configured |

## Module shell vs. modules

Shyre is a platform host for consulting modules. The first module is **Stint** (time + invoices). The shell owns:

- `src/app/layout.tsx`, `src/app/(dashboard)/layout.tsx` — root chrome, sidebar, theme/text-size sync
- `src/components/**` — shared primitives (Avatar wrapper, Tooltip, Toast, Modal, SubmitButton, EntryAuthor, etc.)
- `src/lib/supabase/**` — server / browser / admin / middleware clients
- `src/lib/team-context.ts` — `getUserContext`, `getUserTeams`, `validateTeamAccess`, `isTeamAdmin`
- `src/lib/modules/registry.ts` — module manifests (Stint, Customers, Invoicing, Reports, Business)
- `src/lib/messaging/**` — email outbox / encryption / providers (currently invoice-only consumer)

Each module composes its own server actions, route segments, and tables. See `docs/reference/modules.md` for the per-module map and the naming-rules table.

## Route map (dashboard)

```
src/app/(dashboard)/
├── page.tsx                 — Dashboard (recent activity, stats, expiring credentials banner)
├── customers/
│   ├── page.tsx             — Pattern B multi-select list (archive bulk)
│   └── [id]/page.tsx        — Customer detail: contacts / sharing / permissions / projects
├── projects/
│   ├── page.tsx             — Pattern B list (archive bulk)
│   └── [id]/page.tsx        — Project detail + categories + classification
├── time-entries/
│   ├── page.tsx             — Day + week views, Pattern A multi-select
│   └── trash/page.tsx       — Pattern B trash list (restore + permanently delete bulk)
├── invoices/
│   ├── page.tsx             — Pattern B list (mark-paid bulk)
│   ├── new/page.tsx         — Invoice composer
│   └── [id]/
│       ├── page.tsx         — Invoice detail
│       └── send/page.tsx    — Send-to-customer modal
├── reports/page.tsx         — Hours/revenue summary (date filter required)
├── categories/page.tsx
├── templates/page.tsx
├── import/page.tsx          — Harvest CSV import + undo
├── docs/[...slug]/page.tsx  — In-app documentation viewer
├── profile/page.tsx         — Per-user preferences, MFA, integrations
├── settings/page.tsx        — Settings hub
├── teams/                   — Team management
│   ├── page.tsx
│   └── [id]/
│       ├── page.tsx         — Members + invites + danger zone (transfer ownership / delete)
│       ├── general/page.tsx
│       ├── members/page.tsx
│       ├── email/page.tsx   — Resend config + verified domains
│       └── relationships/page.tsx
├── business/                — Business identity + people + expenses
│   ├── page.tsx
│   ├── info/page.tsx
│   └── [businessId]/
│       ├── identity/page.tsx + history/
│       ├── people/page.tsx + history/
│       ├── expenses/page.tsx + import/
│       └── period-locks/page.tsx
├── security-groups/page.tsx
└── system/                  — System-admin only
    ├── page.tsx
    ├── credentials/page.tsx
    ├── deploy/page.tsx
    ├── errors/page.tsx
    ├── sample-data/page.tsx
    ├── teams/page.tsx
    ├── test-error/page.tsx
    └── users/page.tsx
```

## Top-level src tree

```
src/
├── app/
│   ├── layout.tsx               — Root layout (fonts, theme, i18n provider, ToastProvider)
│   ├── login/page.tsx           — Auth (email/password; signup creates a personal team)
│   ├── auth/callback/route.ts   — Supabase OAuth callback (next= validated for open-redirect)
│   ├── auth/accept-invite/      — Team invite acceptance
│   ├── (dashboard)/             — Authenticated route group (see Route Map above)
│   ├── api/                     — REST endpoints (CSV exports, GitHub issues, webhooks)
│   └── docs/                    — Markdown documentation served by the app
├── components/                  — Shared UI primitives (~50 files)
├── hooks/                       — useAutosaveStatus, useFormAction, useUnsavedChanges, etc.
├── lib/
│   ├── supabase/                — server / browser / admin / middleware clients
│   ├── i18n/                    — next-intl config + locale files (en + es)
│   ├── messaging/               — Outbox / encryption / Resend provider / send-invoice
│   ├── modules/                 — Module registry + nav helpers
│   ├── tickets/                 — GitHub + Jira ticket-link lookup
│   ├── time/                    — TZ + week + CSV helpers
│   ├── invoice-status.ts        — Status enum + transition graph + isValid checks
│   ├── invoice-utils.ts         — Money math + payment summary (currency-aware)
│   ├── form-styles.ts           — Shared form classes (text-body / text-body-lg semantic)
│   ├── team-context.ts          — getUserTeams / validateTeamAccess / isTeamAdmin
│   ├── safe-action.ts           — runSafeAction wrapper (auth + logError on throw)
│   ├── errors.ts                — AppError + toAppError (severity + userMessageKey)
│   └── logger.ts                — logError (admin-client → SECURITY DEFINER RPC fallback)
├── __integration__/             — Vitest integration tests (real Supabase)
│   ├── rls/                     — RLS regression suite (13 files)
│   ├── helpers/                 — Test fixtures + cleanup
│   ├── setup.ts
│   └── global-setup.ts
└── instrumentation.ts           — Next.js onRequestError hook → logError
```

## Data flow

1. **Server components** fetch via the cookie-bound Supabase server client (`@/lib/supabase/server`). RLS gates every read.
2. **Server actions** wrapped in `runSafeAction` — verifies `auth.getUser()`, runs the action body, logs unhandled throws to `error_logs`, returns `{success: true} | {success: false, error}`.
3. **Client components** use the browser client (`@/lib/supabase/client`) for direct queries that benefit from real-time / streaming. Most reads still happen server-side.
4. **API routes** (`src/app/api/**/route.ts`) verify `auth.getUser()` themselves — they don't go through `runSafeAction`. Errors must be logged via `logError` explicitly (audit-mandated).

## Auth flow

1. User submits email/password on `/login`. Email is autofocused; errors get `role="alert"` + `aria-live="assertive"`.
2. Supabase Auth returns a session in HTTP-only cookies via `@supabase/ssr`.
3. `proxy.ts` middleware refreshes the session on every request.
4. Unauthenticated requests redirect to `/login`.
5. `/auth/callback?next=...` validates `next` is a same-origin path (no `//evil.com` open-redirect; SAL-029).
6. `/auth/accept-invite?token=...` validates token shape, looks up the invite, refuses on email mismatch / expired / already-accepted, and `logError`s an unexpected member-insert failure.

## Theme + text-size system

- CSS custom properties per theme live in `@theshyre/design-tokens`.
- `data-theme` on `<html>` switches between `system` / `light` / `dark` / `high-contrast` / `warm`. Anti-flash inline script reads localStorage before first paint.
- `data-text-size` on `<html>` scales root font-size between `compact` / `regular` / `large` so semantic typography utilities (`text-label` / `text-body` / `text-page-title` / etc.) all scale together. Raw Tailwind `text-xs` / `text-sm` is banned by ESLint (typography sweep landed 2026-05-05).

## i18n

- `next-intl` with server (`getTranslations`) + client (`useTranslations`) APIs.
- Locales: `en` + `es`. Files at `src/lib/i18n/locales/{en,es}/{namespace}.json`.
- Namespaces: `auth`, `business`, `categories`, `common`, `customers`, `dashboard`, `errors`, `expenses`, `import`, `invoices`, `messaging`, `paymentTerms`, `profile`, `projects`, `reports`, `sampleData`, `settings`, `sharing`, `templates`, plus `time`.
- Hardcoded user-facing English strings are a code-review fail.

## Module registry

`src/lib/modules/registry.ts` is the canonical list of modules + sidebar nav items. Modules: `time-entries` (Stint), `customers`, `projects`, `invoices`, `reports`, `business`. Plus `PLATFORM_TOOLS` for cross-cutting entries (`/import` today; `/system` and trash should follow per architect-persona finding H6).

## CI / deploy

- `.github/workflows/ci.yml`:
  - **`check`** — lint, typecheck, vitest unit + coverage. Mandatory gate; blocks merge.
  - **`integration`** — RLS suite (13 files) against staging Supabase. Auto-skips when secrets missing.
  - **`e2e`** — Playwright suite. Auto-skips when secrets missing. Uploads report on failure.
- `.github/workflows/db-migrate.yml` — applies new migrations on push to `main`. Runs **in parallel** with Vercel deploy; ordering rules in `docs/reference/migrations.md`.
- `npm run ci:local` — local pre-commit gate. Runs lint + typecheck + test:coverage + `next build`. The build step catches Next.js-only checks (e.g. `"use server"` modules can only export async functions).

## Encryption & secret handling

- `EMAIL_KEY_ENCRYPTION_KEY` env var — single instance KEK that wraps per-team DEKs.
- `SUPABASE_SERVICE_ROLE_KEY` — admin client (server-only via `import "server-only"`).
- `NEXT_PUBLIC_*` — client-readable; only the Supabase URL + anon key.
- GitHub PAT + Jira API token — per-user, on `user_settings`, plaintext today (SAL-015 phase-2 deferred). Read paths use generated `has_*_token` boolean columns instead of selecting the secret.
- Vercel API token — single-instance, encrypted, on `instance_deploy_config`.

## Cross-cutting primitives

- **`<Modal>`** (`src/components/Modal.tsx`) — local wrapper of `@theshyre/ui` Modal with focus trap, return-focus, accessible name (audit a11y #3).
- **`<FieldError>`** (`src/components/FieldError.tsx`) — local wrapper that adds `id` / `role="alert"` / `aria-live="assertive"` (audit a11y #2).
- **`<EntryAuthor>`** — Avatar + display name. Mandatory on every surface that displays a `time_entries` row (CLAUDE.md authorship rule).
- **`<InlineDeleteRowConfirm>`** — typed-`delete` confirm for row-level destructive actions.
- **`<InlineDeleteButton>`** — two-click confirm for cheaper inline ops.
- **`<SubmitButton>`** — pending state + success acknowledgment, mandatory on all forms.
- **`<TopProgressBar>`** + **`<LinkPendingSpinner>`** — global navigation feedback (CLAUDE.md UX rule).
- **`<SaveStatus>`** + `useAutosaveStatus()` — autosave "Saving / Saved / Error" indicator.
- **`<Tooltip>`** (`src/components/Tooltip.tsx`) — wrapper of `@theshyre/ui`. Native `title=` is banned by ESLint.

## Pattern B multi-select

Every list page with bulk actions follows the sibling-strip pattern documented in `docs/reference/multi-select-tables.md`. Implemented on `/customers`, `/projects`, `/invoices`, `/time-entries/trash`. Pattern A (overlay strip) is the dense-grid variant used on `/time-entries` (day + week).

## Persona reviewers

`docs/personas/*.md` — 8 personas (4 craft reviewers auto-fire on file-pattern, 4 stakeholders are manual-invoke). Editing any persona requires editing the matching `.claude/agents/*.md` (and historically `.cursor/rules/*.mdc`, but Cursor support was dropped 2026-04-29 per memory).
