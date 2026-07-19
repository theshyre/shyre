# Customer sharing

When two teams work on the same customer — subcontracting, agency + freelancer, parent / subsidiary — Shyre can share a single customer record across them without exposing either org's unrelated data.

## The shapes of sharing

### 1. Customer share (most common)

Org A owns the customer. Org B is granted access to *that customer only*.

- Org B can see the customer, log time against it (on Org B's projects), and optionally see Org A's time entries on that customer (governed by share settings).
- Org B does not see any of Org A's other customers, projects, or time.

### 2. Team relationship (roster-level)

Org A shares *its entire customer roster* with Org B. Child-parent relationship.

- Useful for a parent org + subsidiary setup.
- Requires acceptance on both sides.
- This is configured under **Teams → (team) → Relationships**, not on a customer's detail page — see [Teams and roles](teams-and-roles.md).

### 3. Per-user or per-group customer permissions

Fine-grained: a specific user (or security group) in your org gets `viewer`, `contributor`, or `admin` on a specific customer, regardless of their general org role.

- Useful for "this contractor sees only Acme; nothing else in my org."

## Creating a customer share

1. Customer detail page → **Sharing** section
2. **Add Team**
3. Pick the org to share with (must exist).
4. Optional: allow the other org to see your time entries on this customer (`can_see_others_entries`).
5. Save.

The recipient org sees the customer in their list immediately. Their members can log time on the customer using *their own* projects.

## Revoking a share

Same page → delete the share row. The recipient org loses access immediately; their historical entries are untouched.

## Changing the primary team

The **Sharing** section also lets the customer's owner transfer the customer to another of their teams (**Change primary team**). Ownership — and which team's roles govern the record — moves; shares and history stay attached.

## Permissions at the customer level

On the customer detail page → **Permissions** section:

- Grant a specific user or security group `viewer`, `contributor`, or `admin` on this customer.
- `viewer`: can see the customer and its projects. The default for new grants.
- `contributor`: can also log time entries on it.
- `admin`: full control of this customer — manage sharing, permissions, delete.

A user's effective access on a customer is the union of:
- Their org role (if they're in the customer's primary org)
- Any direct customer permission
- Any group-based permission via security groups
- Any share access (if they're in a participating org)

## Security notes

- Shares are enforced by RLS — the UI just reflects what RLS allows.
- Cross-org entry visibility is gated by `can_see_others_entries` on each share. Default is off; turn on only when both sides have agreed.
- Shares never expose the sharing org's *other* customers, projects, or entries. Isolation is at the customer level.

## Related

- [Teams and roles](teams-and-roles.md)
- [Security groups](security-groups.md)
