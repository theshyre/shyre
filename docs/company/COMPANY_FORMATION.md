# Shyre — Company Formation

> Status: Pre-incorporation, building under Malcom IO LLC
> Last updated: 2026-05-01

---

## Guiding Principles

Same four-line charter as Liv (`/Users/marcus/projects/liv/docs/company/COMPANY_FORMATION.md`).
Both projects run under the same equity / contribution rules so any
future cross-pollination of contributors doesn't need a separate
framework conversation.

1. **Equity should reflect contribution.** No one gets a free ride. No one gets shorted.
2. **The model must be fair to future contributors.** The system should work whether there's 1 person or 10.
3. **Keep it simple until complexity is earned.** Don't incorporate, don't lawyer up, don't over-structure — until a real trigger demands it.
4. **Everything is tracked and transparent.** Time, money, and resources — all logged, all visible.

---

## Equity Model: Slicing Pie (Dynamic Equity Split)

Shyre uses the **Slicing Pie** framework (Mike Moyer) — same shape as Liv.
Equity isn't negotiated upfront, it's **earned proportionally** based on
each person's at-risk contributions over time.

| Contribution Type | How It's Valued | Multiplier | Rationale |
|---|---|---|---|
| **Time** | Hours × fair market rate (FMR) | 1x | Time is the most common input and the baseline |
| **Cash** | Dollars contributed | 2x | Cash is riskier — you can't un-spend money |
| **Equipment/Resources** | Fair market value | 2x | Same logic as cash — tangible, non-recoverable |
| **Intellectual Property** | Appraised or agreed-upon | 2x | IP brought in — not IP created during work (that's covered by time) |

### Default rates

| Contributor | Role | Rate | Notes |
|---|---|---|---|
| Marcus | Founder + lead engineer | $150/hr | Same FMR as Liv. Aligns with consulting market for senior full-stack + product. |

Adjust the rate column when a contributor's role / market changes.
Past entries don't get retroactively re-rated — the slice was earned at the rate of the day.

---

## How time gets logged

Two surfaces, one source of truth:

1. **`time-log.csv`** in this directory is the canonical contributor record. Append-only, one row per work session, dated.
2. **Shyre time entries** for the same hours, in Shyre itself. Lets us dogfood our own product against real data, and gives the contributor an in-app view of their accrued hours per project.

The `time-log.csv` is the equity record. The Shyre time entries are the operational copy. When they disagree, fix the in-app entries — the CSV is authoritative for slice math.

To bulk-load `time-log.csv` into Shyre, run:

```sh
npm run setup:company
```

That applies any pending migrations (e.g. the **Product Development**
category set), then seeds the entries on the **Shyre** project under
your primary owned team. Both steps read connection details from
`.env.local`, so no env-var juggling at the prompt.

If you only need to re-seed (migrations already applied):

```sh
npm run seed:company
```

The seed script is idempotent — every inserted row carries a sentinel
marker in the description, and re-runs delete-then-reinsert. Manual
entries on the same project are untouched.
