# Env configuration

Environment variables Shyre requires to function, split by where they're used.

## Required in every environment (local + Vercel)

| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Everything | Public; safe in client bundles. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Everything | Public; RLS protects data. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin pages, logger primary path | **Secret.** Bypasses RLS. Never commit. |

If `SUPABASE_SERVICE_ROLE_KEY` is missing at runtime, `/admin/users` and `/admin/teams` crash; the `/admin` layout shows a red banner identifying the missing var. The error logger falls back to a `SECURITY DEFINER` RPC so errors are still captured.

## Required on the server for migrations + CLI

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | `npx supabase` CLI | Personal access token. |
| `SUPABASE_DB_PASSWORD` | `npx supabase db push` | Pooler password. |
| `SUPABASE_DB_URL` | Direct DB operations | Full pooler connection string with creds. |

These aren't set in Vercel — only on your local machine.

## Required for email-invoice sending

| Variable | Used by | Notes |
|---|---|---|
| `EMAIL_KEY_ENCRYPTION_KEY` | `src/lib/messaging/encryption.ts` | **Secret.** 32-byte hex (generate with `openssl rand -hex 32`). Master key for envelope encryption — wraps every team's per-team data key. **Never lose** — losing it makes every stored Resend API key unrecoverable. Set per-tier; do NOT share the same value across dev / preview / prod. |
| `RESEND_WEBHOOK_SECRET` | `src/app/api/messaging/webhook/resend/route.ts` | **Secret.** `whsec_…` from Resend dashboard → Webhooks. HMAC-SHA256 verifies every incoming webhook payload. Without it, the endpoint returns 500 and delivered/bounced status never updates. |

Both can be provisioned automatically from `/system/deploy` if you've connected Vercel — Shyre generates the master key, posts both env vars to your project, and triggers a redeploy. See [Email setup](email-setup.md) and [Deployment automation](deployment.md).

## Optional

- `NEXT_PUBLIC_APP_URL` — base URL of this Shyre deployment (e.g. `https://shyre.malcom.io`). Used by the messaging renderer to build the `%invoice_url%` link in invoice email bodies. When unset, the placeholder renders as empty.
- `GITHUB_TOKEN` — at the user level (stored in `user_settings.github_token`). Not a process env var.

## Where to set them

### Local dev

`.env.local` at the project root. Loaded automatically by Next.js and by Vitest's integration test setup. Gitignored.

### Vercel prod / preview / development

vercel.com → project → Settings → Environment Variables. Set each of the three required vars in **Production**, **Preview**, and **Development** scopes. Alternately:

```
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY preview
vercel env add SUPABASE_SERVICE_ROLE_KEY development
```

Redeploy after changing env vars (Deployments → ⋯ → Redeploy, or push a commit).

## Verifying

- Hit `/admin` — no banner = env looks good.
- `/admin/test-error?log=1` — click the button, then check `/admin/errors`. If the test error shows up, the full logging path works.
- `/admin/users` and `/admin/teams` — should render without error.

## Related

- [Error log](error-log.md) — what to do when errors land with the service-role key missing
- [Security audit log](../../security/SECURITY_AUDIT_LOG.md) — historical incidents related to env / RLS
