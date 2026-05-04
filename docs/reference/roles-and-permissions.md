# Roles and permissions

Shyre has **two orthogonal admin axes**. They live in different tables, gate different surfaces, and a user can hold either, both, or neither. Most confusion in the codebase and in user docs traces back to conflating them — this is the one place that disambiguates.

## The two axes

### 1. System admin (instance-level)

- **Source of truth:** `system_admins` table; checked via the `is_system_admin()` SQL function and the `isSystemAdmin()` TypeScript helper in `src/lib/system-admin.ts`.
- **Scope:** the entire Shyre deployment.
- **Gates:** every route under `/system/*` (deploy automation, credentials index, all-instance teams view, error log, sample-data tool), the `/admin/errors` legacy view, and any RLS policy that mentions `is_system_admin()`.
- **Granted by:** existing system admin (or the bootstrap script when Shyre is first deployed). Not derivable from team membership.

A solo consultant on a self-hosted Shyre is *both* system admin and team admin / owner; on a multi-person agency install they're typically distinct people.

### 2. Team role (per-team)

- **Source of truth:** `team_members.role`, one row per (user, team).
- **Values:** `owner`, `admin`, `member`.
- **Scope:** a single team.
- **Gates:** every team-scoped action and surface — invoices, customers, time entries, email config, team settings, members, relationships.
- **Granted by:** the team's owner (and admins for invite / remove / role changes per the matrix below).

The pure predicate that maps role → write access is `isTeamAdmin(role)` from `@/lib/team-roles`. **Use it everywhere instead of inline `role === "owner" || role === "admin"`** — the upcoming `billing_admin` role per [rate-and-access-plan.md](rate-and-access-plan.md) will extend the set, and we want one place to evolve.

## Capability matrix

### System scope (`/system/*`)

| Surface | System admin | Team owner / admin (no system) | Team member (no system) |
|---|---|---|---|
| `/system/deploy` (Vercel + KEK + webhook secret) | ✓ | ✗ (403) | ✗ (403) |
| `/system/credentials` (instance credential scan) | ✓ | ✗ | ✗ |
| `/system/errors` (error log) | ✓ | ✗ | ✗ |
| `/system/users` (all accounts on the instance) | ✓ | ✗ | ✗ |
| `/system/teams` (all teams on the instance) | ✓ | ✗ | ✗ |
| `/system/sample-data` | ✓ | ✗ | ✗ |

A team admin who isn't a system admin sees informational copy on their own setup pages where instance state is relevant (e.g. "Master encryption key: Set up by your Shyre administrator") — never a clickable link they'd 403 on.

### Team scope (`/teams/[id]/*` and team-scoped data)

| Capability | Owner | Admin | Member |
|---|---|---|---|
| View team overview | ✓ | ✓ | ✓ |
| Rename team | ✓ | ✓ | ✗ |
| Edit business info, defaults, branding | ✓ | ✓ | ✗ |
| Edit time-entry visibility level | ✓ | ✓ | ✗ |
| Invite members | ✓ | ✓ | ✗ |
| Revoke pending invites | ✓ | ✓ | ✗ |
| Remove members (non-owner) | ✓ | ✓ | ✗ |
| Remove the owner | ✗ | ✗ | ✗ |
| Transfer ownership | ✓ | ✗ | ✗ |
| Delete the team | ✓ | ✗ | ✗ |
| Configure email (API key, From, signature) | ✓ | ✓ | ✗ |
| Verify domain | ✓ | ✓ | ✗ |
| Send test email | ✓ | ✓ | ✗ |
| Edit message templates | ✓ | ✓ | ✗ |
| Manage parent / child team relationships | ✓ | ✓ | ✗ |
| Set team-default rate | ✓ | only if delegated * | ✗ |
| Set per-member rate | ✓ | only if delegated * | ✗ |
| Toggle the "admins can set rate permissions" flag | ✓ | ✗ | ✗ |
| Manage customer contacts | ✓ | ✓ | ✗ |
| Send an invoice | ✓ | ✓ | ✗ |
| View invoices | ✓ | ✓ | ✓ (subject to per-customer permissions) |

\* Rate-setting is delegated via the `team_settings.admins_can_set_rate_permissions` flag. Owner sets it; when on, admins can set rates. When off, only the owner can. The flag itself is owner-only — admins can't elevate themselves. Rationale: rates are a money-impact lever; some teams want to delegate, some don't.

### Customer scope (per-customer permissions)

Customer-scoped reads layer on top of team membership. A team member who can otherwise see the team's customers may be restricted at the per-customer level:

| Permission level | Read customer | Edit customer | Manage shares / contacts |
|---|---|---|---|
| `viewer` | ✓ | ✗ | ✗ |
| `contributor` | ✓ | ✓ | ✗ |
| `admin` | ✓ | ✓ | ✓ |

Per-customer permissions are stored in `customer_permissions` and granted by team admins. See [rate-and-access-plan.md](rate-and-access-plan.md) for the broader permission model.

## Who-am-I in the UI

The team detail page shows a `role` chip next to the team name (`owner`, `admin`, or `member`). The chip is the at-a-glance signal for what the current user can act on. There's no separate "team admin" label — the schema value is `admin`, the predicate is `isTeamAdmin`, and the chip reads `admin`. One canonical term throughout.

## Enforcement layers

Defense in depth, top to bottom:

1. **UI gating** — pages render the affordances only when the current role can act. Example: the configure card on the team overview shows for everyone, but the destination's edit affordances disappear for `member`.
2. **Server-action gates** — `validateTeamAccess(teamId)` runs first. `requireTeamAdmin(teamId)` adds the owner/admin gate when the action mutates. Both throw before any DB write.
3. **RLS policies** — every team-scoped table has a policy that goes through `user_team_role(team_id) IN (...)`. Even a tampered server action can't escape RLS.
4. **DB constraints** — `CHECK (role IN ('owner','admin','member'))`, partial unique indexes (one owner per team, one invoice-recipient per customer, etc.).

If any layer says no, the request fails. The UI gate is for affordance / discoverability; RLS is the authoritative gate.

## Adding a new role-gated capability

When you add a server action or page that mutates team-scoped data:

1. Call `validateTeamAccess(teamId)` to confirm the user is in the team at all.
2. If the action mutates: `if (!isTeamAdmin(role))` throw a refusal. (Or call `requireTeamAdmin` upfront.)
3. Add an RLS policy on the touched tables: `WITH CHECK (user_team_role(team_id) IN ('owner', 'admin'))`.
4. Update this doc's capability matrix.
5. Do **not** introduce a new ad-hoc role check (`role === "owner"`, `role === "admin"`) inline. Use the helpers.

## Related

- [rate-and-access-plan.md](rate-and-access-plan.md) — the broader permissions roadmap including `billing_admin` and per-customer access groups.
- [docs/security/SECURITY_AUDIT_LOG.md](../security/SECURITY_AUDIT_LOG.md) — incidents and remediations that involved the role boundary.
- [docs/personas](../personas) — the eight reviewer personas, several of which weigh in on role boundaries (security-reviewer, agency-owner, platform-architect).
- [team-admin/email-setup.md](../guides/team-admin/email-setup.md) and [system-admin/email-infrastructure.md](../guides/system-admin/email-infrastructure.md) — the worked example of the two-axis model in user-facing docs.
