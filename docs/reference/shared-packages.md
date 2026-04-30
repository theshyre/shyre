# Shared packages — `@theshyre/*`

> Authoritative reference. CLAUDE.md links here. Shyre consumes UI, theme, and design-token primitives from `@theshyre/ui`, `@theshyre/theme`, `@theshyre/design-tokens` (source: `/Users/marcus/projects/theshyre-core`, published to GitHub Packages). Liv consumes the same packages. Keeping all three repos in step is load-bearing for cross-repo sharing — drift here is never local.

## Stay on the latest published version

- Shyre's `@theshyre/*` caret ranges in `package.json` must be ≥ the latest version published to GitHub Packages at all times.
- When `theshyre-core` publishes a new version, the follow-up in Shyre (and Liv) is same-day: bump the caret, `npm install`, run `typecheck` + `lint` + `test` + `next build`, commit. Don't carry drift into the next feature commit.
- Compiler + `@types/node` majors stay in lockstep with `theshyre-core` and Liv. A TS major upgrade is not a Shyre-local change — plan it across all three repos.
- **Automated drift check.** A SessionStart hook (`.claude/settings.json` → `scripts/check-theshyre-versions.sh`) compares the three caret ranges to the registry on every Claude Code session and prints a warning if anything is behind. Silent when current. Requires `NODE_AUTH_TOKEN` in your shell env; if unset, the hook skips silently rather than nagging.

## When something belongs in `@theshyre/*`

Code belongs in the shared packages when **all four** hold:

1. **App-agnostic.** No references to Shyre-specific domain (time entries, invoices, customers, projects, teams) or Liv-specific domain.
2. **No Supabase or DB knowledge.** If it imports from `@/lib/supabase/*` or reads a Shyre table, it stays in Shyre.
3. **Framework-level compatible.** React 19 + Next.js 16 is assumed; Next-specific hooks are acceptable (both apps are Next).
4. **Concrete consumer beyond Shyre.** Liv uses it, or is planned to — "could in theory be generic" isn't enough. Over-promoting pollutes the package API surface.

Fail any one → keep in Shyre.

## Prefer author-in-core for new generic primitives

Before writing a new generic primitive in Shyre (a modal variant, a utility hook, a hashing helper), stop and author it in `theshyre-core/packages/ui` first. Import from `@theshyre/ui`. The "inline today, promote later" pattern consistently creates migration churn — write it once in the right place.

## Promotion workflow

1. **Open a PR in `theshyre-core`** (not Shyre) that adds the primitive + its tests + a changeset entry.
2. Keep the export name stable — renaming at promotion time breaks every Shyre re-exporter on the same day.
3. Publish: `pnpm version-packages` → commit → push → `pnpm release`. Patch or minor per semver.
4. **Then** open a PR in Shyre that:
   - Bumps the caret in `package.json` to the new version.
   - Deletes the local copy (or turns it into a re-export if Shyre call sites use `@/components/Foo` and you don't want to touch every one).
   - Rewires imports: `@/hooks/useFoo` → `@theshyre/ui`.
5. Don't merge the Shyre PR before `npm view @theshyre/<pkg> version` returns the new version.

## Re-export wrappers — when they're OK

Shyre's `src/components/Foo.tsx` re-exporting from `@theshyre/ui` is the right pattern when:
- The wrapper adds i18n labels the base can't know about (e.g. `SaveStatus.tsx`, `InlineDeleteButton.tsx` — they pass next-intl strings into generic primitives).
- Shyre callers use `@/components/Foo` widely and you don't want to touch every site on the promotion day.

Don't create re-export wrappers for their own sake — only when there's a concrete reason.

## App-specific — never promotion candidates

These stay in Shyre regardless of how generic-looking they seem:
- Anything that renders `time_entries`, `invoices`, `customers`, `projects`, `teams`, etc. (`EntryAuthor`, `InvoicePDF`, `Timer`, `Sidebar`, `TeamFilter`)
- Server actions, `safe-action.ts`, RLS helpers, `team-context.ts`, Supabase clients
- Next.js pages, route-group layouts, the dashboard shell
- Shyre-specific Zod schemas and i18n message bundles

If the concept itself moves — e.g. an address-input pattern Liv wants too — the answer is a new package in `theshyre-core`, not cramming it into `@theshyre/ui`.
