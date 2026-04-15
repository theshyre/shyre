# Organizations and roles

In Shyre, every user belongs to at least one **organization** — their personal org, created automatically on signup. When you operate as an agency, you'll run most work in a second org with multiple members.

## Creating an organization

1. Sidebar → **Organizations** → **Create organization**
2. Name it. A slug is generated; it's visible in admin views but users don't see it.
3. You become its owner.

## Inviting members

From the org detail page:

1. **Members** → **Invite**
2. Enter an email address and a role (see below).
3. Shyre creates an invite; the invitee gets an email / accept-invite link.
4. On accept, they become a member at the chosen role.

## Roles

- **owner** — full control. Can delete the org, transfer ownership, change any setting, see everything.
- **admin** — manage members, customers, projects, settings. Cannot delete the org or transfer ownership.
- **member** (aka contributor) — track time on projects they have access to, see their own data, see org-wide aggregates their role permits.

Roles apply per-org. Being an owner of Org A doesn't give you anything in Org B.

## What each role sees

Enforced by Postgres RLS, not just UI.

|  | owner | admin | member |
|---|---|---|---|
| Time entries (own) | ✓ | ✓ | ✓ |
| Time entries (others in org) | ✓ | ✓ | — (unless shared) |
| Customers | ✓ R/W | ✓ R/W | ✓ R (write depends on customer permission) |
| Projects | ✓ R/W | ✓ R/W | ✓ R/W on projects they can access |
| Invoices | ✓ R/W | ✓ R/W | — |
| Org settings / identity | ✓ R/W | ✓ R/W | ✓ R |
| Members / invites | ✓ R/W | ✓ R/W | ✓ R |
| Delete org / transfer ownership | ✓ | — | — |

## Personal org vs team org

Your personal org is still an org with you as the owner. It's where your personal consulting / experiments live. Shyre doesn't hide or treat it specially except that it's flagged `is_personal = true`, which blocks deletion (you can't delete your personal org — only leave all others).

## Leaving or removing

- **Leave** — remove yourself as a member. Available unless you're the sole owner. Transfer ownership first if needed.
- **Remove a member** — owners and admins can remove members. Their historical data stays; they just lose access.

## Transferring ownership

Owner → member → **promote to owner** → previous owner becomes admin (or they leave). Shyre enforces at-least-one-owner invariant.

## Related

- [Customer sharing](customer-sharing.md) — share a customer across orgs
- [Security groups](security-groups.md) — named access groups for customer permissions
