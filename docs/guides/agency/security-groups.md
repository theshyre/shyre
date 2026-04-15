# Security groups

Named groups of users within an team, used to manage customer access at scale. Think "the Acme squad" instead of granting permissions to five users one at a time.

## When to use groups

- You have 3+ customers and 3+ members, and not everyone should see everything.
- You want to onboard a new teammate to an existing customer set in one action.
- You want to offboard (revoke access) in one action.

If you've got 2 people in an org, you probably don't need groups — use per-user customer permissions instead.

## Creating a group

1. Sidebar → **Security Groups**
2. **New group**
3. Name (e.g. "Acme team", "Finance"), choose org, save.

## Adding members

Open the group → **Members** → pick from the org's members. You can only add users who are already in the org.

## Granting customer access to a group

Open any customer → **Permissions** → **Add group permission** → pick group + role (contributor / admin). Every member of the group inherits that role on that customer.

Adding a user to the group → they get access to every customer the group has permission on. Removing them → they lose all of it.

## Common patterns

- **Customer team**: one group per customer, contains the contractors working on that customer.
- **Function team**: "Finance" group with admin on every customer, used for the bookkeepers.
- **Temporary access**: contractor group with permission on specific customers, removed when the engagement ends.

## Constraints

- Groups are per-org. You can't add a user to a group in an org they don't belong to.
- A user can be in many groups.
- Permissions from different groups combine additively (union of access, with the highest role winning per customer).

## Related

- [Orgs and roles](teams-and-roles.md)
- [Customer sharing](customer-sharing.md)
