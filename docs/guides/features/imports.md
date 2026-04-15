# Importing from other tools

Shyre can bulk-import time data from Harvest today. More integrations will come as they become common requests.

## Harvest import

1. Sidebar → **Import**
2. Enter your Harvest account credentials (account ID + personal access token).
3. Pick the date range and the target team in Shyre.
4. Shyre fetches customers, projects, and time entries from Harvest and creates matching records.

**Before you run the import:**
- Run it against a fresh org if you can, or at least back up your existing data first. The importer is idempotent on re-runs (won't create duplicates of the same Harvest entries) but creates new customers and projects every time if there are naming mismatches.
- Harvest "clients" map to Shyre **customers**, preserving the name and default rate.
- Harvest projects map to Shyre projects. Hourly rate, code, and status are carried over.
- Harvest time entries map to Shyre time entries, preserving project, start/end, duration, description, and billable flag.

**What isn't imported:**
- Invoices — ongoing billing should be done in Shyre, not imported mid-flight.
- Expenses (on the roadmap; categories don't map cleanly yet).
- Tasks — Shyre uses [categories](categories.md) instead; Harvest tasks are logged in the description field.

## After the import

- Spot-check totals in a report: "does Q1's total from Harvest match my Q1 in Shyre?"
- Archive the Harvest projects on their side to avoid double-tracking.
- Clean up imported customers if any were duplicated by typo differences.

## What's planned

- **Ongoing Harvest sync** — one-way mirror so you can run both for a while during migration. Deferred; tell me if you need it.
- **Toggl, Clockify importers** — TBD based on demand.

## Related

- [Customers](customers.md)
- [Projects](projects.md)
- [Time tracking](time-tracking.md)
