# Reports

The reporting dashboard: hours, billability, estimated revenue, and collected cash for any period, sliceable by team, project, and source.

## Where it lives

Sidebar → **Reports** → `/reports`.

## Filters

- **Team** — scope to one of your teams, or all.
- **Project** — scope to a single project. Selecting a **parent** project automatically rolls up every sub-project underneath it — see [Sub-project rollup filter](sub-project-rollup-filter.md). The picker includes non-archived projects, including `completed` ones.
- **Period** — presets **This Month** (default, month-to-date), **Last Month**, **This Quarter**, **Last Quarter**, **This Year**, or a custom **From / To** range. All presets are **calendar-based (UTC)** — they do not follow `fiscal_year_start`; use a custom range for a non-calendar fiscal period.
- **Source** — **All sources / Human / Agent**. Human and Agent partition All exactly (Human = everything not agent-tracked). See [Reviewing agent-tracked time](agent-time-review.md). The Source lens applies to the hours/revenue numbers, not to the Collected section.

## Summary cards

- **Total Hours** and **Billable Hours** for the period.
- **Time-Based Revenue** — an accrual **estimate**: billable hours × the rate cascade (project `hourly_rate` → customer `default_rate` → team default).
- **Billable %**.

## Collected (cash basis)

A separate section sums actual **invoice payments** whose *Paid on* date falls in the period — cash basis, so it includes fixed-price and proposal-derived invoices that never touched hourly rates.

- Totals are **per currency** — amounts in different currencies are never summed together.
- Each currency bucket shows the payment count and a top-clients rollup.

Time-Based Revenue (what the hours are worth) and Collected (what actually hit the books) are deliberately different numbers — don't reconcile one against the other.

## Breakdown tables

- **Hours by Client**
- **Hours by Project**
- **Hours by Member** — only shown when the team has more than one member.

## Related

- [Time tracking](time-tracking.md)
- [Sub-project rollup filter](sub-project-rollup-filter.md)
- [Reviewing agent-tracked time](agent-time-review.md)
- [Invoicing](invoicing.md)
- Bookkeeper's [exports guide](../bookkeeper/exports.md)
