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
│   ├── admin/               # Role-specific: System Admin
│   ├── team-admin/          # Audience-split leaf docs routed from admin/ (email setup)
│   └── system-admin/        # Audience-split leaf docs routed from admin/ (email infrastructure)
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

## Online docs are part of "documented" (rule added 2026-07-18)

The `docs/` tree deploys with the app and renders at `/docs` — but the docs
hub (`src/app/(dashboard)/docs/page.tsx`) is a **curated nav, not an auto
index**. Curation is allowed to prioritize; it is not allowed to orphan: a
guide that exists on disk but isn't reachable from a hub card is invisible
to users. Therefore, for every user-facing feature:

1. Guide in `docs/guides/features/` (same commit as the feature — existing rule).
2. Linked from `docs/guides/features/README.md` (existing rule).
3. **Reachable from the docs hub page** (this rule): the configuration/how-to
   guide is the card's `primary`; API/reference material goes in `more`. New
   surface areas get their own card.

Both directions are enforced by `src/__tests__/docs-links.test.ts`:

- **Hub → files**: every `/docs/...` href in the hub page resolves to a real
  file under `docs/` (either `<path>.md` or `<path>/README.md`).
- **Files → hub**: every `.md` under `docs/guides/**` is reachable from the
  hub by following links — either linked directly from a hub card, or linked
  from a README / guide that is itself reachable from the hub. Deliberate
  exceptions go in the test's explicit allow-list with a comment saying why.

Additionally, every guide directory that has a `README.md` must link **all**
of its sibling `.md` files from that README — the section index is the
canonical table of contents for its directory.

Practical consequence: when you add a guide, add it to its section README in
the same commit, and add a hub card entry when the guide starts a new surface
area (new module, new top-level concept). The test fails the build otherwise.

## Topic navigation & quick guides — MANDATORY

The hub organizes docs into **topics** (the hub cards: Stint, Integrations,
Customers, Business, Invoicing, Proposals, Reports, …). A reader must be able
to see everything a topic contains, walk it end-to-end, and get oriented in
under a minute. Four rules make that true everywhere the app renders docs.

1. **Topic manifest is the single source of truth.** Every topic's articles
   are an ORDERED list defined ONCE, in `src/lib/docs/topics.ts`
   (`DOC_TOPICS: DocTopic[]`). The hub, the topic-index route, and the
   article prev/next footer all import this manifest — never a second
   hand-maintained list. Adding an article means adding it to the manifest
   in the same commit as the guide (the "shipped but undocumented" rule
   above still applies in full: guide file + `README.md` entry + manifest
   entry, one commit).
2. **Every topic has a topic-index page** at `/docs/topics/<slug>` listing
   ALL of that topic's articles in manifest order, each with its one-line
   blurb — the "see everything in this topic" view Marcus asked for. The
   hub card links both its title and a "See all N articles →" affordance to
   this index; a reader is never more than one click from the full list.
3. **Every article page shows Previous / Next within its topic**, derived
   from manifest order, in addition to breadcrumbs — so a reader can walk a
   topic start to finish without bouncing back to the hub. The lookup is by
   the article's `/docs/...` href against the manifest; articles that
   aren't in any topic (e.g. role-browse or reference pages reached other
   ways) simply render no prev/next.
4. **Every topic leads with a Quick guide.** Position zero in a topic's
   `articles` array is always its Quick guide (`quick: true`) — a short,
   task-first "get started" article that fits roughly on one screen.
   Deeper reference and configuration articles follow it. The Quick guide
   is visually distinguished on the topic-index page (not just another row
   in the list) and is the CTA surfaced directly on the hub card, ahead of
   the "see all" link. A Quick guide is short by design — do not pad it to
   look more thorough.

Manifest integrity (every article href resolves to a real file under
`docs/`, the Quick guide is first and unique per topic, no duplicate hrefs)
is enforced by `src/lib/docs/topics.test.ts`.
