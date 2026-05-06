# Sub-project rollup filter

Scope the **Time** view and the **Reports** dashboard to a single
project — and when that project is a parent of sub-projects, the
filter rolls up to include every phase underneath it automatically.
You don't have to tick boxes for each phase or hunt them down on
separate views.

## Where it lives

- **Time** (`/time-entries`) — sidebar → Track → Time. The
  **Project** chip sits in the toolbar between **Members** and
  **Billable only**.
- **Reports** (`/reports`) — sidebar → Reports. The **Project** chip
  sits next to the team picker at the top of the page.

The chip reads **"All projects"** when no filter is applied; click it
to open the picker.

## What rollup means

A sub-project (sometimes called a "phase") is a project that has
another project as its parent. For example, you might run
**Engagement** as the umbrella project and **Phase 1**, **Phase 2**,
**Phase 3** as sub-projects underneath it. When you pick:

- **A leaf project** (any project without sub-projects, or a
  sub-project itself): only entries logged on that project show up.
- **A parent project** (one with sub-projects): the parent itself
  *plus* every sub-project beneath it is included.

The chip shows **"+N sub-projects"** next to the name when rollup
is active, so you can tell at a glance whether you're scoped to one
project or a whole engagement.

## Reading the picker

Open the chip and the dropdown lists every project the team has
access to:

- Top-level projects appear first, with a folder icon when they have
  sub-projects.
- Sub-projects render indented underneath their parent.
- Each row shows the customer name underneath (or **Internal** for
  internal projects) so two phases named the same thing across
  customers are easy to tell apart.

Picking **All projects** clears the filter and brings every
in-scope project's entries back.

## What the filter does NOT do

- **Doesn't change project totals on the parent's detail page.** The
  rollup card on `/projects/[id]` already sums parent + children
  regardless of any filter.
- **Doesn't filter the new-entry picker.** When you log time, the
  project picker is leaf-only (you can't log time on a parent
  project — its sub-projects exist precisely because the work
  happens at that level). The rollup filter is a *display* filter,
  not a *data-entry* filter.
- **Doesn't multi-select.** This is a single-project filter. If you
  want "Phase 1 + Phase 2 but not Phase 3," scope to the parent and
  keep an eye out — or open an issue, since nobody has asked for
  multi-select yet. (See `docs/reference/sub-projects-roadmap.md`
  Phase C "out of scope.")

## URL parameter

Both pages serialize the selection as `?project=<id>`. The id is the
selected project's UUID; rollup happens server-side, so a parent id
in the URL automatically pulls children too. Bookmark or share a URL
with the param to land somebody on the same scope.

## Related

- **Engagement structure:** `docs/reference/sub-projects-roadmap.md`
  for the trigger invariants, the rollup totals card, and what's
  intentionally deferred.
- **Filter parity across surfaces:** the invoice form's project
  filter (when picking which entries to invoice) is a separate
  multi-select pattern — same concept, different ergonomics. It's
  not yet rollup-aware; that's tracked in the same roadmap doc.
