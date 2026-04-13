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

5. Run the SQL migration in your Supabase SQL Editor:
   - Open `supabase/migrations/001_initial_schema.sql`
   - Paste and run in the Supabase dashboard SQL Editor

6. Start the dev server:
   ```bash
   npm run dev
   ```

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |

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
