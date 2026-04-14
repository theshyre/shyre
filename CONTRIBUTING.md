# Contributing to Stint

## Prerequisites

- Node.js 22+
- npm
- A Supabase project (free tier)

## Setup

1. Clone the repo:
   ```bash
   git clone git@github.com:Malcom-IO/stint.git
   cd stint
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

4. Fill in your Supabase credentials in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL` — your project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your anon/public key
   - `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-only, never expose)
   - `SUPABASE_ACCESS_TOKEN` — personal access token from https://supabase.com/dashboard/account/tokens (for CLI migrations)
   - `SUPABASE_DB_URL` — **Session pooler URI** from Supabase dashboard → Connect → URI tab. Must use port 5432. Transaction pooler (6543) will NOT work for migrations.

5. Install the Supabase CLI (one-time):
   ```bash
   brew install supabase/tap/supabase
   npm run db:link                    # link this repo to the Supabase project
   ```

6. Apply migrations:
   ```bash
   npm run db:status                  # shows pending migrations (dry run)
   npm run db:push                    # applies pending migrations
   ```

7. Start the dev server:
   ```bash
   npm run dev
   ```

## Creating a new migration

```bash
npm run db:new my_migration_name     # creates supabase/migrations/<timestamp>_my_migration_name.sql
# edit the generated file
npm run db:status                    # preview
npm run db:push                      # apply
```

Existing migrations `001_`-`014_` pre-date the CLI workflow and are already applied in production. New migrations follow the CLI's `<timestamp>_name.sql` format automatically.

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:integration` | Run integration tests against live Supabase |
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run db:status` | Show pending migrations (dry run) |
| `npm run db:push` | Apply pending migrations |
| `npm run db:new <name>` | Create a new migration file |
| `npm run db:link` | Link this repo to the Supabase project (one-time) |

## Code Conventions

See `CLAUDE.md` for the complete set of project rules including:
- TypeScript strict mode (no `any`, no `@ts-ignore`)
- >90% test coverage
- All strings via i18n (`next-intl`)
- Lucide icons only
- Semantic design tokens (never raw hex)
- Redundant visual encoding (icon + text + color)

## Git Workflow

- Work on `main` (solo project)
- Commit messages: imperative mood, describe what and why
- Every commit should pass `npm test` and `npx tsc --noEmit`
