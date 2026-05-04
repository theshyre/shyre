# State registrations

Every state where the business is formed or foreign-qualified. One row is the formation state; the rest are foreign qualifications that let the business operate in other states.

## Why this exists

A real consulting business registers in its formation state (e.g. Delaware LLC) and foreign-qualifies in every other state where it has nexus — customer work, employees, physical presence. Each registration has its own state entity number, renewal cadence, registered agent, and status. Keeping all of this in one free-text field hides the obligation; modeling each registration as a row surfaces what's due and where.

## Where it lives

Sidebar → **Business** → pick one → **Identity** tab → **State registrations** section.

Each row shows:

- **State** — two-letter USPS code (DE, CA, TX).
- **Formation badge** — present only on the formation row. Exactly one per business; enforced at the database level by a partial unique index.
- **Registration type** — `Domestic` (formation) or `Foreign qualification` (doing business here but formed elsewhere).
- **Status** — `Pending` / `Active` / `Delinquent` / `Withdrawn` / `Revoked`.
- **Entity number** — the state-assigned filing number.
- **Registered on** — when the state approved the registration.
- **Report frequency** — `Annual` / `Biennial` / `Decennial`.
- **Next due date** — when the next report or renewal is owed.

## Adding a registration

Click **Add state registration** → inline form appears:

- **State** — required, 2 letters.
- **Registration type** — required.
- **This is the formation state** — check only on the row that represents where the business was originally formed. A formation row must be `Domestic`; the database rejects `Foreign qualification` with the formation flag set.
- **State entity number** — optional; fill in when you have it (usually issued after filing).
- **State tax ID** — some states (CA, NY, MA) issue a state-specific tax ID distinct from the EIN.
- **Registered on / Nexus start date** — both matter. `Nexus start date` defends late-registration penalties; `Registered on` is when the state approved the filing.
- **Status** — defaults to `Pending` when you file and haven't heard back yet. Flip to `Active` when the state confirms.
- **Report frequency / Due rule / Annual report due / Next due date** — all optional, but together they power future reminder surfaces. `Due rule` tells Shyre how to compute due dates: `Fixed date` (always MM-DD), `Anniversary` (tied to the formation anniversary), or `Quarter end`.
- **Annual report fee (cents)** — stored as integer cents for reconciliation against your bank ledger.
- **Notes** — free text for state-specific quirks (e.g., "DE franchise tax due 06-01", "PA decennial report due 2030").

## Editing

Click the pencil icon on any row → inline edit form appears. Save applies the change immediately (owner/admin only).

## Deleting

Click the × icon → type `delete` to confirm (per Shyre's row-delete pattern) → soft-deleted. Hard-delete happens on cascade when the owning business is deleted.

## How formation works under the hood

The formation state lives in the same table as foreign qualifications (`business_state_registrations`), distinguished by `is_formation = true`. This symmetric shape preserves audit history through re-domestication — converting a DE LLC to a TX LLC becomes an `UPDATE` on the same row, not a delete-and-recreate.

The partial unique index `bsr_one_formation_per_business` enforces exactly one formation row per business.

## Permissions

Owner or admin of any team owned by this business can read, create, update, and delete registrations. Regular members can read but not modify. Role is derived via `user_business_role(business_id)` — see [Modules](../../reference/modules.md) for the platform-API surface modules can call.

## Limits of v1

- **Sales/use tax** is a separate concept from foreign qualification and lives in its own `business_tax_registrations` table (server actions exist; UI lands in a follow-up).
- **Registered agents** are shared entities with a dedicated `business_registered_agents` table (server actions exist; UI lands in a follow-up).
- **Next-due-date computation** is currently user-maintained. Automatic computation from `due_rule` + `registered_on` + `annual_report_due_mmdd` is planned; anniversary-based states make a generic formula non-trivial.

## Related

- [Business identity](business-identity.md)
- [Database schema](../../reference/database-schema.md) — `business_state_registrations`, `business_tax_registrations`, `business_registered_agents`
