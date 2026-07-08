# Shyre

**Shyre is a platform for running a consulting business** — time tracking, customers, projects, invoicing, and expenses under one roof. The time-and-invoicing surface ships as the **Stint** module inside the platform shell.

- 🌐 **Production:** https://shyre.malcom.io
- 📚 **Docs:** [`docs/`](docs/) (also served in-app at [`/docs`](https://shyre.malcom.io/docs))
- 🤝 **Contributing / full setup:** [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router), React 19 |
| Database / Auth | Supabase — Postgres, Auth (TOTP MFA), RLS |
| Styling | Tailwind CSS 4 + `@theshyre/design-tokens` |
| Shared UI | `@theshyre/ui` (private GitHub Packages) |
| i18n | next-intl (`en`, `es`) |
| PDF | `@react-pdf/renderer` (client-side invoices) |
| Email | Resend (per-team, envelope-encrypted keys) |
| Testing | Vitest + Testing Library, Playwright (E2E) |
| Deploy | Vercel + Supabase Cloud, auto-deploy on push to `main` |

See [`docs/reference/architecture.md`](docs/reference/architecture.md) for the module layout and data flow.

## Quick start

> **Requires Node 24** (`>=24 <25`) and read access to the `theshyre` GitHub org for the private `@theshyre/*` packages. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the one-time GitHub Packages and Supabase CLI setup.

```bash
git clone git@github.com:theshyre/shyre.git
cd shyre

# NODE_AUTH_TOKEN (read:packages) must be exported — see CONTRIBUTING.md
npm install

cp .env.example .env.local   # then fill in Supabase credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (`--max-warnings=0` — warnings are errors) |
| `npm run typecheck` | `tsc --noEmit` (strict, zero `any`) |
| `npm run test` | Vitest unit/integration run |
| `npm run test:coverage` | Vitest with the >90% coverage gate |
| `npm run test:e2e` | Playwright critical-flow specs |
| **`npm run ci:local`** | **Pre-commit gate:** lint → typecheck → coverage → build |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npm run db:new <name>` | Scaffold a new migration file |

Run **`npm run ci:local`** before every commit that adds production code — it mirrors the CI `check` job that blocks merge.

## Project structure

```
src/
├── app/
│   ├── (dashboard)/    — authenticated route group (clients, projects,
│   │                     time-entries, timer, invoices, reports, settings)
│   ├── login/          — auth
│   └── docs/           — in-app documentation
├── components/         — shared UI primitives
├── hooks/              — shared React hooks
├── lib/
│   ├── supabase/       — browser / server / admin / middleware clients
│   ├── modules/        — module registry (Stint, Customers, Invoicing, …)
│   ├── messaging/      — email outbox / encryption / providers
│   └── i18n/           — next-intl config + locale files
└── __tests__/          — integration tests
supabase/migrations/    — SQL migrations
docs/                   — project documentation (also served at /docs)
```

## Documentation

- **[Getting started](docs/guides/getting-started.md)** — first login to first invoice
- **[Feature guides](docs/guides/features/)** — time tracking, customers, projects, invoicing, expenses
- **[Architecture](docs/reference/architecture.md)** · **[Database schema](docs/reference/database-schema.md)** · **[Modules](docs/reference/modules.md)**
- **[Admin guides](docs/guides/admin/)** — [env configuration](docs/guides/admin/env-configuration.md), error log, sample data
- **[Security audit log](docs/security/SECURITY_AUDIT_LOG.md)** — append-only findings + resolutions

Conventions and mandatory rules (TypeScript strict, forms/buttons, i18n, migrations, testing) live in [`CLAUDE.md`](CLAUDE.md) and [`docs/reference/`](docs/reference/).

## Deployment

Pushes to `main` trigger a Vercel deploy and the `db-migrate` GitHub Action **in parallel** — there is no ordering between them. Migrations must be backward-compatible with the currently-deployed code; destructive changes are split across two PRs. See [`docs/reference/migrations.md`](docs/reference/migrations.md) before writing a migration.
