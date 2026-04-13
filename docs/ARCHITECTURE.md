# Architecture Overview

## Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 16 (App Router) | Full-stack React, SSR, server actions |
| Database | Supabase (PostgreSQL) | Hosted Postgres, auth, RLS, real-time |
| Auth | Supabase Auth + MFA | Email/password, TOTP MFA |
| Styling | Tailwind CSS 4 | Utility-first CSS with design tokens |
| i18n | next-intl | Server + client internationalization |
| Icons | Lucide React | Consistent iconography |
| Testing | Vitest + Testing Library | Unit + integration tests (>90% coverage) |
| E2E | Playwright | End-to-end testing |
| Deployment | Vercel (hobby) | Auto-deploy from GitHub |

## App Structure

```
src/
├── app/
│   ├── layout.tsx              — Root layout (fonts, theme, i18n provider)
│   ├── login/                  — Auth pages
│   ├── auth/callback/          — Supabase OAuth callback
│   ├── (dashboard)/            — Authenticated route group
│   │   ├── layout.tsx          — Sidebar + main content
│   │   ├── page.tsx            — Dashboard
│   │   ├── clients/            — Client CRUD
│   │   ├── projects/           — Project CRUD
│   │   ├── time-entries/       — Time entry CRUD
│   │   ├── timer/              — Timer start page
│   │   ├── invoices/           — Invoice management (Phase 2)
│   │   ├── reports/            — Reporting (Phase 4)
│   │   └── settings/           — User/business settings + MFA
│   └── docs/                   — In-app documentation
├── components/                 — Shared components (Sidebar, Timer, ThemeProvider)
├── lib/
│   ├── supabase/               — Client helpers (browser, server, middleware)
│   ├── i18n/                   — Locale config + translation files
│   └── form-styles.ts          — Shared form field CSS classes
└── test/                       — Test setup + mock helpers
```

## Data Flow

1. **Server Components** fetch data via Supabase server client (with cookie-based auth)
2. **Server Actions** handle mutations, validate user session, revalidate paths
3. **RLS** enforces that users only see their own data at the database level
4. **Client Components** use Supabase browser client for real-time features (timer)

## Auth Flow

1. User submits email/password on `/login`
2. Supabase Auth returns session tokens (stored in HTTP-only cookies via `@supabase/ssr`)
3. Middleware refreshes session on every request
4. Unauthenticated requests redirect to `/login`
5. Auth callback at `/auth/callback` handles email confirmation links

## Theme System

- CSS custom properties defined per theme in `globals.css`
- `data-theme` attribute on `<html>` switches themes
- Anti-flash inline script reads localStorage before first paint
- ThemeProvider context for client-side switching
- 3 themes: light (default), dark, high-contrast

## i18n

- `next-intl` with server/client rendering
- Namespaced locale files: `common`, `auth`, `clients`, `projects`, `time`, `settings`
- English + Spanish from day one
- All user-facing strings use `t("key")` — no hardcoded text
