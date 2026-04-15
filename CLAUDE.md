@AGENTS.md

# CLAUDE.md — Stint

> **Dual-tool project**: This repo uses both Claude Code and Cursor. This file (`CLAUDE.md`) is for Claude Code. Cursor reads `.cursorrules`. Both files enforce identical conventions — if you update one, update the other.

## Project overview

Stint is a time-tracking and invoicing app for a solo consultant. Built with Next.js 16 (App Router), Supabase (Postgres + Auth + RLS), and Tailwind CSS 4. Deployed free on Vercel + Supabase Cloud.

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
- Table headers: `text-xs font-semibold uppercase tracking-wider text-content-muted`
- Page titles: `text-2xl font-bold text-content` with icon

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
2. **Require typed confirmation for irreversible actions** — delete org, void invoice, etc. Require the user to type the exact name.
3. **Confirm button disabled until confirmation matches** — typed name must match exactly before the destructive button enables.
4. **Cancel button always present** — easy escape from destructive flows.

## Supabase patterns

- **Server Components**: use `createClient()` from `@/lib/supabase/server`
- **Client Components**: use `createClient()` from `@/lib/supabase/client`
- **Server Actions**: use `createClient()` from `@/lib/supabase/server`, always verify `auth.getUser()` first
- **RLS handles authorization** — every table has `user_id`, every policy scopes to `auth.uid() = user_id`
- **Never bypass RLS** — no service role key in the client app

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

> **This is not optional.** Every piece of work must be documented before it is considered complete. "Shipped but undocumented" is not shipped.

### Layout

Documentation lives in `docs/` and is served in-app at `/docs`:

```
docs/
├── README.md                # index
├── guides/                  # user-facing how-tos, by audience
│   ├── getting-started.md
│   ├── features/            # Cross-role feature docs (apply to every user)
│   ├── agency/              # Role-specific: Agency Owner
│   ├── bookkeeper/          # Role-specific: Bookkeeper
│   └── admin/               # Role-specific: System Admin
├── reference/               # technical
│   ├── architecture.md
│   ├── database-schema.md
│   └── modules.md
├── security/                # audit log
└── personas/                # AI review personas
```

Guides have two layers:
- **`guides/features/`** — one doc per feature, written for the default Shyre user (most often a solo consultant). Apply to everyone; role-specific behavior is called out inline and linked to the relevant role guide.
- **`guides/{agency,bookkeeper,admin}/`** — role-specific docs that only matter if you have that role. Don't duplicate feature content here; link to it from `features/` instead.

The `/docs` landing is **role-aware**: it auto-shows the most relevant links based on the logged-in user's role mix (system-admin status + role across their orgs). Audience browse cards exist as a secondary section, not the hero.

### When you build, modify, or add anything

The relevant user-facing guide gets created or updated **in the same commit**.

| Change | Must update |
|---|---|
| New user-facing feature | Doc in `docs/guides/features/`. Add a role-specific doc in `agency/` / `bookkeeper/` / `admin/` only if there's something genuinely role-specific to say beyond what the feature doc covers. |
| UI / flow change | Existing guide entry for that feature |
| Schema / migration | `docs/reference/database-schema.md` |
| New module / shell concept | `docs/reference/modules.md` |
| New env var | `.env.example` AND `docs/guides/admin/env-configuration.md` |
| Security change | `docs/security/SECURITY_AUDIT_LOG.md` (append-only) |
| Deferred / unshipped feature | Note in the relevant guide + in `docs/personas/README.md` Deferred section |

### What "documented" means

- A user of the relevant audience can follow the guide without asking anyone questions.
- A developer who wasn't in the conversation can understand what was built and why.
- Keyboard shortcuts listed on every page that has them; shown in the UI with a `<kbd>` badge.
- Limits and known work are called out in a "What isn't built yet" section when relevant — better to document absence than let users hunt for it.

### Guide format

Each audience-specific guide follows the same structure:

1. **Title** (H1 — feature name)
2. **Where it lives** — sidebar path + URL
3. **How to do X** — numbered steps for the primary flows
4. **Constraints / permissions** — who can do what
5. **Keyboard shortcuts** (if any)
6. **Related** — links to sibling guides

Keep each guide ≤ ~200 lines. If a feature grows beyond one guide, split by sub-feature.

### Rendering

`/docs` uses `react-markdown` + `remark-gfm`. GFM tables, task lists, strikethrough, and fenced code blocks all work. Relative `[text](./foo.md)` links are rewritten to `/docs/...` routes.

### Do not

- **Don't duplicate content across guides.** If solo and agency both need to know how customers work, write it once (solo), and link from agency.
- **Don't leave stale guides.** If a feature is removed, its guide is removed (or moved to a "Deprecated" section with the removal date).
- **Don't skip guides because the feature is "simple".** The guide is how someone NEW to Shyre learns it exists.

## Proactive development — MANDATORY

- **Fix issues as you find them** — do not defer, do not leave TODOs. If you encounter a bug, type error, lint issue, or security concern while working on something else, fix it immediately.
- **Be proactive** — if you see a better approach while implementing, take it. Don't ask for permission to improve code quality.
- **No TODO comments** — either fix it now or create a tracked issue. `// TODO` is not a plan.
- **No partial implementations** — every feature you touch must be complete, tested, documented, and localized before moving on.

## Personas — MANDATORY

> Personas are stakeholder / craft / guardian lenses used by AI agents to review Shyre from perspectives other than the implementer's.

### Source of truth

- `docs/personas/*.md` holds the canonical persona definitions. There are 8 today: `solo-consultant`, `agency-owner`, `bookkeeper`, `ux-designer`, `accessibility-auditor`, `qa-tester`, `security-reviewer`, `platform-architect`. See `docs/personas/README.md` for the index.
- Tool wrappers at `.claude/agents/<name>.md` and `.cursor/rules/persona-<name>.mdc` must reference the source, not duplicate it.

### Auto-engagement policy

Apply the relevant persona review alongside regular work whenever these file patterns are touched. Auto-engagement is proactive — the agent initiates the review without being asked.

| Persona | Auto-engages on |
|---|---|
| QA Tester | Any `src/**/*.ts(x)` or `supabase/migrations/**/*.sql` change |
| Security Reviewer | `supabase/migrations/**`, `src/lib/supabase/**`, `src/lib/safe-action.ts`, `src/lib/system-admin.ts`, `src/lib/org-context.ts`, any `**/actions.ts`, `src/app/auth/**` |
| UX Designer | `src/app/**/*.tsx`, `src/components/**/*.tsx` |
| Accessibility Auditor | Same as UX Designer (separate pass, different lens) |
| Platform Architect | `src/lib/modules/**`, `supabase/migrations/**`, new top-level `src/app/(dashboard)/*/page.tsx` |

**Stakeholder voices** (Solo Consultant, Agency Owner, Bookkeeper) are **not** auto-engaged. Invoke them manually at feature-complete checkpoints — running them on every small change turns them into noise.

### Persona sync — CRITICAL

Every persona has **three** files that must stay byte-compatible in scope and instruction:

1. `docs/personas/<name>.md` (source)
2. `.claude/agents/<name>.md` (Claude Code wrapper)
3. `.cursor/rules/persona-<name>.mdc` (Cursor rule wrapper)

> **Editing any one requires editing the other two.** When adding a new persona, add all three files in the same commit. When renaming, rename everywhere. When retiring, delete everywhere.

This rule is stricter than the general CLAUDE.md ↔ .cursorrules parity — for personas, a third directory (`docs/personas/`) is the source of truth, and the wrappers must never drift from it.

### Writing and maintaining personas

- **Personas review; they do not implement.** Each file ends with a concrete checklist of what to flag, not prose.
- **Personas are lenses, not gatekeepers.** Conflicting reviews are expected — the human decides.
- **Each persona file stays ≤ ~100 lines.** If it grows, split the role.
- **Prune stale concerns.** When a persona's check becomes a lint rule, a test, or a general CLAUDE.md rule, delete that bullet.
- **Update personas when prod surprises slip past them.** The persona is living doc — the checklist should reflect real near-misses.
- **Document deferred personas.** Don't add speculative personas; track "add when X" in `docs/personas/README.md`.

### Using personas in prompts

- Claude Code: `@<persona-name>` invokes the subagent (e.g., `@security-reviewer audit the new migration`).
- Cursor: enable the persona rule from the rule picker or reference by name in-prompt.

## Code generation rules (Claude Code + Cursor)

> **Keep in sync**: These rules are duplicated in `.cursorrules`. If you modify rules here, update `.cursorrules` to match. Persona sync is stricter — see above.

- **All code must be TypeScript strict mode** — no `any`, no `@ts-ignore`
- **All code must pass ESLint** — run lint before considering any code complete
- **All code must have tests** — every new `.ts` file needs a `.test.ts` file
- **>90% test coverage** — enforced via Vitest coverage thresholds
- **Tests must be meaningful** — test behavior, not implementation
- **All user-facing strings must use i18n** — no hardcoded text
- **All interactive elements must have keyboard shortcuts** where applicable
- **All status/state UI must use redundant visual encoding** (2+ channels)
