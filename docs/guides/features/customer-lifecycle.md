# Customer lifecycle — Active, Inactive, Archived

Customers have one lifecycle presented in three states:

- **Active** — the default. Nothing to set.
- **Inactive** — the relationship is dormant. The customer **stays visible**
  on the customers list with an Inactive badge, keeps every project, invoice,
  and report intact, and appears **bottom-grouped under "Inactive"** in the
  new-project / new-proposal / new-invoice pickers — still selectable, because
  a final invoice or a re-engagement proposal must always be possible. Nothing
  is ever blocked for an inactive customer.
- **Archived** — the trash layer. Hidden from lists and pickers entirely.
  Unchanged behavior, but now recoverable: the customers list's **Archived**
  filter shows archived customers with a **Restore** action (previously the
  only recovery was the short-lived undo toast).

## Marking a customer inactive

- **Customer page**: the **Mark inactive** button next to the name (and
  **Reactivate** to reverse it). No confirmation — it's non-destructive and
  the toast offers Undo.
- **Customers list**: select rows and use the **Mark inactive (N)** bulk
  action — the neutral-styled button next to the red Archive. Idempotent:
  already-inactive rows keep their original inactive-since date.

The customers list gains filter chips — **All / Active / Inactive /
Archived** — defaulting to All (active + inactive together, badged), because
"visible but dormant" is exactly what distinguishes Inactive from Archive.
Dashboards count active customers only; reports and CSV exports include
inactive customers always (the export gains an `inactive_at` column).

Stored as `customers.inactive_at` (timestamp — answers "since when?"),
orthogonal to `archived`.
