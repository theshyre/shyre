# Customer sharing

When two teams work on the same customer — subcontracting, agency + freelancer, parent / subsidiary — Shyre can share a single customer record across them without exposing either org's unrelated data.

## The shapes of sharing

### 1. Customer share (most common)

Org A owns the customer. Org B is granted access to *that customer only*.

- Org B can see the customer, log time against it (on Org B's projects), and optionally see Org A's time entries on that customer (governed by share settings).
- Org B does not see any of Org A's other customers, projects, or time.

### 2. Team share

Org A shares *its entire customer roster* with Org B. Child-parent relationship.

- Useful for a parent org + subsidiary setup.
- Requires acceptance on both sides.

### 3. Per-user or per-group customer permissions

Fine-grained: a specific user (or security group) in your org gets `admin` or `contributor` on a specific customer, regardless of their general org role.

- Useful for "this contractor sees only Acme; nothing else in my org."

## Creating a customer share

1. Customer detail page → **Sharing** tab
2. **Add share**
3. Pick the org to share with (must exist).
4. Optional: allow the other org to see your time entries on this customer (`can_see_others_entries`).
5. Save.

The recipient org sees the customer in their list immediately. Their members can log time on the customer using *their own* projects.

## Revoking a share

Same page → delete the share row. The recipient org loses access immediately; their historical entries are untouched.

## Permissions at the customer level

On the customer detail page → **Permissions** tab:

- Grant a specific user or security group `contributor` or `admin` on this customer.
- `contributor`: can view + edit the customer, log time on projects under it.
- `admin`: everything contributor can do, plus manage sharing and delete.

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

- [Orgs and roles](teams-and-roles.md)
- [Security groups](security-groups.md)
