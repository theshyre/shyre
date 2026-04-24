# Documentation policy

> Full layout + guide format. The short version lives in `CLAUDE.md` → "Documentation — MANDATORY".

> **This is not optional.** Every piece of work must be documented before it is considered complete. "Shipped but undocumented" is not shipped.

## Layout

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
│   ├── migrations.md
│   ├── documentation.md     # this file
│   └── modules.md
├── security/                # audit log
└── personas/                # AI review personas
```

Guides have two layers:

- **`guides/features/`** — one doc per feature, written for the default Shyre user (most often a solo consultant). Apply to everyone; role-specific behavior is called out inline and linked to the relevant role guide.
- **`guides/{agency,bookkeeper,admin}/`** — role-specific docs that only matter if you have that role. Don't duplicate feature content here; link to it from `features/` instead.

The `/docs` landing is **role-aware**: it auto-shows the most relevant links based on the logged-in user's role mix (system-admin status + role across their orgs). Audience browse cards exist as a secondary section, not the hero.

## When you build, modify, or add anything

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

## What "documented" means

- A user of the relevant audience can follow the guide without asking anyone questions.
- A developer who wasn't in the conversation can understand what was built and why.
- Keyboard shortcuts listed on every page that has them; shown in the UI with a `<kbd>` badge.
- Limits and known work are called out in a "What isn't built yet" section when relevant — better to document absence than let users hunt for it.

## Guide format

Each audience-specific guide follows the same structure:

1. **Title** (H1 — feature name)
2. **Where it lives** — sidebar path + URL
3. **How to do X** — numbered steps for the primary flows
4. **Constraints / permissions** — who can do what
5. **Keyboard shortcuts** (if any)
6. **Related** — links to sibling guides

Keep each guide ≤ ~200 lines. If a feature grows beyond one guide, split by sub-feature.

## Rendering

`/docs` uses `react-markdown` + `remark-gfm`. GFM tables, task lists, strikethrough, and fenced code blocks all work. Relative `[text](./foo.md)` links are rewritten to `/docs/...` routes.

## Do not

- **Don't duplicate content across guides.** If solo and agency both need to know how customers work, write it once (solo), and link from agency.
- **Don't leave stale guides.** If a feature is removed, its guide is removed (or moved to a "Deprecated" section with the removal date).
- **Don't skip guides because the feature is "simple".** The guide is how someone NEW to Shyre learns it exists.
