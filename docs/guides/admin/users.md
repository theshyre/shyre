# Users (all)

`/admin/users`. Lists every user on the platform. System admins only.

## What's shown

Per row:

- Display name + email
- System admin badge (if they are one)
- Number of orgs they belong to
- Crown icon if they own any org
- Shield icon if they are a system admin

## What you can do

- **View** — read-only today. Editing a user's profile happens via their own `/profile`; you can't impersonate.
- **Make system admin / revoke** — not in the UI today. Adjust directly in the `system_admins` table. See below.

## Promoting a user to system admin

Direct SQL only, by design (irreversible unless explicitly granted; no UI that could be mis-clicked):

```sql
INSERT INTO public.system_admins (user_id)
SELECT id FROM auth.users WHERE email = 'name@example.com'
ON CONFLICT DO NOTHING;
```

To revoke:

```sql
DELETE FROM public.system_admins
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'name@example.com');
```

## Data model

- `auth.users` — managed by Supabase Auth.
- `public.user_profiles` — display name, avatar, preferences.
- `public.user_settings` — theme, timezone, GitHub token (secret).
- `public.system_admins` — who is a system admin.

Deleting a user in Supabase cascades to their memberships; their personal org (created by `handle_new_user` trigger on signup) is NOT deleted by cascade because orgs don't FK to users. Delete manually if needed.

## Implementation notes

- Uses `createAdminClient()` → requires `SUPABASE_SERVICE_ROLE_KEY` in the env. If missing, the page throws and the `/admin` layout shows a red banner (see [env configuration](env-configuration.md)).
- `auth.users` is read via `supabase.auth.admin.listUsers()` — paginated with a 1000-row default.

## Related

- [All teams](teams.md)
- [Env configuration](env-configuration.md)
