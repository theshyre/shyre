# Personas

Shared persona definitions used by AI coding agents (primarily Claude Code) to review Shyre from different stakeholder perspectives.

Each persona file defines a role, their priorities, and what they look for when evaluating code, features, and workflows. These are the **single source of truth** — tool-specific agent configs (`.claude/agents/`, optionally `.cursor/rules/`) are thin wrappers that reference these files.

## All personas at a glance

| Persona | Type | Auto-engages on | Primary lens |
|---|---|---|---|
| [Solo Consultant](solo-consultant.md) | Stakeholder | Manual | Daily-use friction, data portability, fair pricing, default-period filters |
| [Agency Owner](agency-owner.md) | Stakeholder | Manual | Roles & RLS scope, bulk ops, cross-team leakage, audit trail |
| [Bookkeeper](bookkeeper.md) | Stakeholder | Manual | Exports, money precision, period close, category taxonomy |
| [UX Designer](ux-designer.md) | Craft | `src/app/**/*.tsx`, `src/components/**` | Hierarchy, consistency, redundant visual encoding, modal discipline |
| [Accessibility Auditor](accessibility-auditor.md) | Craft | Same as UX (separate pass) | Keyboard-first, screen-reader, AA contrast, focus management |
| [QA Tester](qa-tester.md) | Craft | Any `src/**/*.ts(x)` or `supabase/migrations/**` | Sad paths, RLS from both sides, regression pinning, coverage |
| [Security Reviewer](security-reviewer.md) | Guardian | `supabase/migrations/**`, `src/lib/supabase/**`, `**/actions.ts`, auth code | RLS correctness, secret handling, audit log, error logging |
| [Platform Architect](platform-architect.md) | Guardian | `src/lib/modules/**`, `supabase/migrations/**`, new top-level route groups | Shell vs module, table naming, layer violations, pagination primitives |

**Type legend:**

- **Stakeholder** — voice of a real user ("would I want to use this?"). Manual-invoke at feature-complete checkpoints; running them on every commit turns them into noise.
- **Craft** — reviewers for UI / test quality. Auto-fire because they catch issues where they happen.
- **Guardian** — system-level invariants (security, architecture). Auto-fire on the file patterns that put those invariants at risk.

## Usage

### Claude Code

Invoke with `@persona-name` in a prompt, or let auto-triggers fire (see `CLAUDE.md`):

```
@ux-designer review the /admin/sample-data redesign
@security-reviewer audit the sample-data server actions
@qa-tester evaluate test coverage for the expenses module
```

### Cursor (legacy)

`.cursor/rules/persona-*.mdc` mirrors exist for Cursor but are no longer kept in sync as a hard requirement — Shyre is Claude-Code-only as of 2026-04-29. Treat them as read-only references; new persona changes only need to land in `docs/personas/` and `.claude/agents/`.

## Working with personas

1. **Personas review, they don't implement.** Each file ends with a concrete checklist of things to flag, not prose.
2. **Personas are lenses, not gatekeepers.** Conflicting reviews are fine — the human decides.
3. **Prune stale concerns.** When a persona's check becomes a lint rule or a test, delete that bullet — don't let the persona become a tombstone.
4. **Each persona file stays under ~100 lines.** If it grows, split the role.
5. **Update personas as the product evolves.** When a prod surprise slips past a reviewer, add that concern to the relevant persona.

## Tool-sync requirement

Each persona has two files that must stay in sync:

- `docs/personas/<name>.md` — source of truth
- `.claude/agents/<name>.md` — Claude Code subagent wrapper

Editing one requires editing the other in the same commit. The `.cursor/rules/persona-<name>.mdc` mirror is optional (see Cursor note above).

See `CLAUDE.md` → "Persona sync" for the canonical rule.

## Deferred personas

Tracked here so we don't forget. Add when the trigger fires:

| Persona | Add when… | Notes |
|---|---|---|
| **Invoicing-domain reviewer** | Invoicing grows past basic CRUD (late fees, multi-currency, numbering schemes, AR aging) | For now, invoicing concerns are covered by Bookkeeper |
| **Customer (receiving party)** | Customer portal ships | Voice of the person who receives invoices and uses the shared view |
