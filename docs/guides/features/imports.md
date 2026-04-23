# Importing from other tools

Shyre can bulk-import time data from Harvest today. More integrations will come as they become common requests.

## Harvest import

1. Sidebar → **Import**
2. Enter your Harvest account credentials (account ID + personal access token).
3. **Connect & preview** — Shyre pulls counts, your Harvest users, and a suggested mapping from Harvest user → Shyre team member.
4. Review and adjust the **user mapping table** — pick a Shyre user for each Harvest user who logged time, fall back to "me" to attribute them to you, or "skip" to drop a user's entries entirely.
5. Click **Import** — Shyre fetches the full dataset and writes it into the target team. Re-runs dedupe automatically.

## How Harvest fields map to Shyre

| Harvest | Shyre | Notes |
|---|---|---|
| Client | Customer | Name and address preserved. |
| Project | Project | Hourly rate, description (from Harvest notes), budget, status. Inactive Harvest projects land as `archived` in Shyre (not skipped) so their historical entries still have somewhere to attach. |
| Task | Category (under set "Harvest Tasks") | Shyre creates one team-level category set per import with one category per unique task name. Entries are tagged with the matching category. |
| Time entry user | Time entry author | Resolved via the user mapping table on the preview step. Default: match by email, then display name, else fall back to the importing user. |
| Time entry `billable_rate` | Prefixed on the description when it differs from project rate | Shyre's `time_entries` has no per-entry rate column (rate is a project attribute). For historical entries where the rate differed, the snapshot is preserved as `[$200/hr] Task: notes`. |
| Time entry `started_time` / `ended_time` | `start_time` / `end_time` (UTC) | Parsed in the Harvest account's time zone, stored as UTC. DST handled correctly. |

## Time-zone correctness

Harvest stores wall-clock times ("09:30") in the account's time zone. Shyre stores UTC. The importer reads the account's `time_zone` field off the `/company` endpoint and converts each entry using the correct offset for the date — so a 9:30am entry on 2024-01-15 (EST) and 2024-07-15 (EDT) both round-trip to the right UTC moment.

## Multi-user imports

Each Harvest user who logged time becomes the author of their entries in Shyre. On the preview step, Shyre proposes a default mapping by matching on email, then display name. You can override any row:

- **Shyre team member** — attribute all entries from this Harvest user to that member.
- **Me (attribute to caller)** — fall back to you. Use when a Harvest user left or isn't in Shyre.
- **Skip** — drop every entry this user logged. Useful when importing a partial team.

## Idempotent re-runs

Each imported row stores `imported_from`, `imported_at`, `import_run_id`, and `import_source_id` (the external system's id). A partial unique index on `(team_id, imported_from, import_source_id)` means running the importer twice won't create duplicates — already-imported rows are detected by source id and counted as "skipped."

## Undoing an import

Every import creates a row in the `import_runs` table with a summary (who triggered it, counts, status). The **Import history** section at `/import` lists your runs with an **Undo** button per row.

Undo hard-deletes every row carrying that `import_run_id` across `customers`, `projects`, `time_entries`, `category_sets`, and `categories`, then marks the run as `undone_at`. The run record itself stays (not deleted) so the audit trail shows "imported on X, undone on Y."

**Undo refuses when imported data is load-bearing.** Two blockers:

- **Invoiced time entries.** If any time entry from this run has an `invoice_id` set, Undo tells you which invoice(s) and asks you to void or delete them first.
- **Invoices on imported customers.** If any invoice points at a customer this run created, Undo asks you to clean up those invoices first.

This is intentional — deleting the underlying data would leave stranded invoices or orphaned line items. The refusal path points at exactly what to clean up.

**Only owners and admins can undo a run** — same bar as running the import in the first place.

## Rate limiting

Harvest rate-limits the public API at ~100 requests per 15 seconds. Shyre retries on `429` with exponential backoff (1s, 2s, 4s) and respects the `Retry-After` header when Harvest sends one. Large imports may take several minutes; the importer keeps chugging without user intervention.

## What isn't imported

- **Invoices** — ongoing billing should be done in Shyre, not imported mid-flight.
- **Expenses** — on the roadmap; Harvest's categorization doesn't map cleanly to Shyre's expense taxonomy yet.

## Before you run the import

- Run it against a fresh team if you can, or at least back up your existing data first.
- **Import is owner/admin only** — plain team members can't trigger it.
- For large accounts, the full preview + import can take a few minutes. The UI retries automatically on rate limits.

## After the import

- Spot-check totals in a report: "does Q1's total from Harvest match my Q1 in Shyre?"
- Archive the Harvest projects on their side to avoid double-tracking.
- Clean up imported customers if any were duplicated by typo differences.

## What's planned

- Expense import from Harvest.
- Ongoing Harvest sync (one-way mirror during migration).
- Other providers on request.

## Related

- [Customers](customers.md)
- [Projects](projects.md)
- [Time tracking](time-tracking.md)
- [Categories](categories.md)
