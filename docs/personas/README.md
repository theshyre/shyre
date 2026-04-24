# Personas

Shared persona definitions used by AI coding agents (Claude Code, Cursor) to review Shyre from different stakeholder perspectives.

Each persona file defines a role, their priorities, and what they look for when evaluating code, features, and workflows. These are the **single source of truth** — tool-specific agent configs (`.claude/agents/`, `.cursor/rules/`) are thin wrappers that reference these files.

## Personas

### Stakeholder voices ("would I want to use this?")

| Persona | File | Focus |
|---|---|---|
| Solo Consultant | [solo-consultant.md](solo-consultant.md) | Daily time tracking friction, invoice-in-2-clicks, data portability, pricing fairness |
| Agency Owner | [agency-owner.md](agency-owner.md) | Multi-user scenarios, team roles, shared customers, cross-user reports |
| Bookkeeper | [bookkeeper.md](bookkeeper.md) | Categorization accuracy, CSV/QB exports, 1099 boundaries, audit trail |

### Craft reviewers

| Persona | File | Focus |
|---|---|---|
| UX Designer | [ux-designer.md](ux-designer.md) | Information hierarchy, progressive disclosure, redundant visual encoding, keyboard shortcuts |
| Accessibility Auditor | [accessibility-auditor.md](accessibility-auditor.md) | WCAG AA, keyboard-first nav, color-independent signals, screen-reader labels |
| QA Tester | [qa-tester.md](qa-tester.md) | Happy + sad paths, edge cases, regression protection, coverage, critical flows |

### System guardians

| Persona | File | Focus |
|---|---|---|
| Security Reviewer | [security-reviewer.md](security-reviewer.md) | RLS correctness, secrets handling, session/MFA, CORS, audit log |
| Platform Architect | [platform-architect.md](platform-architect.md) | Shyre shell vs module boundaries, module registry, schema prefixing |

## Usage

### Claude Code

Invoke with `@persona-name` in a prompt, or let auto-triggers fire (see `CLAUDE.md`):

```
@ux-designer review the /admin/sample-data redesign
@security-reviewer audit the sample-data server actions
@qa-tester evaluate test coverage for the expenses module
```

### Cursor

Persona rules live in `.cursor/rules/persona-*.mdc`. They are **manual rules** (not always-apply) — enable them from the rule picker or reference them in your prompt.

## Auto-engagement policy

Apply the relevant persona review alongside regular work whenever these file patterns are touched. Auto-engagement is proactive — the agent initiates the review without being asked.

| Persona | Auto-engages on |
|---|---|
| QA Tester | Any `src/**/*.ts(x)` or `supabase/migrations/**/*.sql` change |
| Security Reviewer | `supabase/migrations/**`, `src/lib/supabase/**`, `src/lib/safe-action.ts`, `src/lib/system-admin.ts`, `src/lib/team-context.ts`, any `**/actions.ts`, `src/app/auth/**` |
| UX Designer | `src/app/**/*.tsx`, `src/components/**/*.tsx` |
| Accessibility Auditor | Same as UX Designer (separate pass, different lens) |
| Platform Architect | `src/lib/modules/**`, `supabase/migrations/**`, new top-level `src/app/(dashboard)/*/page.tsx` |

Rule of thumb:

- **Craft reviewers and system guardians** auto-fire, because they catch bugs where they happen.
- **Stakeholder voices** (Solo Consultant, Agency Owner, Bookkeeper) are invoked manually at feature-complete checkpoints, because running them on every small change turns them into noise.

## Working with personas

1. **Personas review, they don't implement.** Each file ends with a concrete checklist of things to flag, not prose.
2. **Personas are lenses, not gatekeepers.** Conflicting reviews are fine — the human decides.
3. **Prune stale concerns.** When a persona's check becomes a lint rule or a test, delete that bullet — don't let the persona become a tombstone.
4. **Each persona file stays under ~100 lines.** If it grows, split the role.
5. **Update personas as the product evolves.** When a prod surprise slips past a reviewer, add that concern to the relevant persona.

## Tool-sync requirement

Every persona has three files that must stay in sync:

- `docs/personas/<name>.md` — source of truth
- `.claude/agents/<name>.md` — Claude Code subagent wrapper
- `.cursor/rules/persona-<name>.mdc` — Cursor rule wrapper

**Editing any one requires editing the other two.** See `CLAUDE.md` → "Persona sync".

## Deferred personas

Tracked here so we don't forget. Add when the trigger fires:

| Persona | Add when… | Notes |
|---|---|---|
| **Invoicing-domain reviewer** | Invoicing grows past basic CRUD (late fees, multi-currency, numbering schemes, AR aging) | For now, invoicing concerns are covered by Bookkeeper |
| **Customer (receiving party)** | Customer portal ships | Voice of the person who receives invoices and uses the shared view |
