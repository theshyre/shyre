# Promotion candidates for `@theshyre/ui`

Components and primitives in this repo that should move to
`theshyre-core/packages/ui` so Liv (and any future consumer) can
share them. Promotion is a separate workflow from this repo's commit
flow — see `docs/reference/shared-packages.md` "Promotion workflow"
for the PR / publish / caret-bump steps.

The list comes from a platform-architect review of the recent
session's work. Three picks, in priority order.

## 1. `DateField` — strongest pick (calendar widget)

**Path:** `src/components/DateField.tsx`

**Why promote:** zero Supabase, zero domain coupling, zero
next-intl dependence. Wire format is ISO strings; locale-aware
display layer; callers supply preset menus. Custom popover with
roving-tabindex APG calendar pattern, tested across DST / leap-day
edges. Replaces native `<input type="date">` — both Shyre and Liv
need it. The author's own docstring explicitly mentions the intent
to promote.

**Before promotion:**
- Verify no remaining Shyre-only imports inside the component.
- The `formatDate` / `formatDateTime` helpers it uses are already
  in `@theshyre/ui` — no chicken/egg.
- Keep the existing tests; port them to the package.

**Caller migration:** swap `import { DateField } from "@/components/DateField"`
to `import { DateField } from "@theshyre/ui"`. Drop the local file.

## 2. `LocalDateTime` — trivial promote

**Path:** `src/components/LocalDateTime.tsx`

**Why promote:** 35 lines, no Shyre concepts, already imports
`formatDateTime` from `@theshyre/ui`. Solves "server renders UTC,
hydrates differently in viewer's TZ" — Liv has the same problem.

**Before promotion:** the small SSR-placeholder behavior (em-dash
until hydration) should stay; document it as the package's
contract.

**Caller migration:** Shyre has 2 call sites today
(`invoice-activity.tsx`, `system/errors/page.tsx`). Both swap
imports.

## 3. `SkipLink` — verify-then-promote

**Path:** `src/components/SkipLink.tsx`

**Why verify first:** generic enough that it might already be in
`@theshyre/ui` under a different name. If it's not, it should be
— accessibility skip-link is a primitive both apps need on their
dashboard layouts.

**If absent in core:** lift it as-is (it's tiny — visually-hidden
anchor with focus-visible reveal). Replace local copy with import.

## NOT promotion candidates (kept Shyre-local)

The platform-architect review explicitly called these out as
**not** ready to promote:

- **`TicketChip`** — imports Shyre server actions
  (`refreshTicketTitleAction`, `applyTicketTitleAsDescriptionAction`),
  uses Shyre's i18n namespace, knows Jira/GitHub as a Shyre
  integration. Could split a generic `<Chip>` primitive later if a
  second consumer appears.
- **`ProfilePopover`** — sidebar-shaped, knows Shyre's settings /
  docs / sign-out routes.
- **`invoice-grouping.ts`** — domain logic on time_entries →
  invoice line items.
- **`breadcrumbs/*`** — split candidate: generic `<Breadcrumbs>`
  rendering primitive could move to `@theshyre/ui`, route registry
  stays local. Not urgent.
- **`InvoiceActivity`** — every event renderer references invoice /
  payment / customer concepts. Premature to extract a generic
  `<ActivityTimeline>`; revisit when a second activity log appears.

## Workflow reminder

Per `docs/reference/shared-packages.md`:

1. Open PR in `theshyre-core/packages/ui` adding the component.
2. Publish the new version of `@theshyre/ui` to GitHub Packages.
3. Bump caret here (`package.json`) and rewrite imports.
4. Delete the local component file (and its test).
5. Verify Shyre still builds; verify Liv still builds.
6. Stay on the latest published version (caret bump same day on
   theshyre-core release).

Do not author new generic primitives in Shyre and inline-then-
promote — author them in `theshyre-core` first when the genericness
is clear at design time.
