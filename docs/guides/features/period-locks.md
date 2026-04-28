# Period locks

Lock a closed accounting period so retroactive edits to time entries, expenses, or invoices are blocked at the database layer.

## Why this exists

Bookkeepers close a period when they send the books to a client, file taxes, or hand off to an accountant. After the close, the numbers are *immutable* — a member silently editing a March time entry on April 5 produces a discrepancy that's invisible to the books and the client.

Period locks make that immutability explicit. After a lock:

- Inserting / updating / deleting a `time_entries` row whose `start_time` falls on or before the locked date raises a `check_violation`.
- Same for `expenses` (gated on `incurred_on`).
- Same for `invoices` whose `issued_date` falls in the locked window — except status-only transitions (sent → paid) are still allowed because a payment landing in a later month is normal even for a locked invoice.

The DB-layer guard is enforced by SECURITY DEFINER triggers, so RLS-capable callers cannot bypass it via a different code path.

## Where it lives

Sidebar → **Business** → pick one → **Period locks** tab.

The tab is hidden for non-admins. Plain members never see the surface.

## How to lock a period

1. Pick the team (multi-team businesses get a team picker; single-team ones don't).
2. Pick the period-end date (e.g. `2026-03-31` to lock through end of March).
3. Optional notes — useful for "Q1 2026 — sent to accountant."
4. Click **Lock period**.

Once saved, the lock is immutable. To change the date, unlock and re-lock.

## How to unlock

1. Click **Unlock** on the lock row.
2. Type the literal word `unlock` to arm the red **Unlock period** button.
3. Confirm.

The unlock event is recorded in `team_period_locks_history` (append-only). Both lock and unlock events are kept forever for audit.

## Permissions

- **Lock / unlock**: owner or admin of the team.
- **View locks**: owner or admin of the team.
- **Members**: locks are invisible. They'll see a "Period closed" error if they try to edit a row inside the window.

## What's blocked, what's not

| Operation | Blocked? |
|-----------|----------|
| Insert a time entry with start_time inside the lock | ✓ |
| Update a time entry whose start_time is inside the lock | ✓ |
| Move a time entry's start_time INTO a locked period | ✓ |
| Delete a time entry whose start_time is inside the lock | ✓ |
| Insert / update / delete an expense in the lock | ✓ |
| Issue a new invoice with `issued_date` in the lock | ✓ |
| Edit an invoice's totals when `issued_date` is in the lock | ✓ |
| Update only an invoice's status (sent → paid → void) | not blocked |
| Edit time entries / expenses dated AFTER the lock | not blocked |

## Keyboard shortcuts

None today. Locking is a deliberate action — no shortcut keeps it hard to do by accident.

## Related

- [Expenses](expenses.md)
- [Invoicing](invoicing.md)
- [Audit trails](../../reference/database-schema.md#audit-trails)
