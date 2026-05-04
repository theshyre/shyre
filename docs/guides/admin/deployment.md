# Deployment automation

`/system/deploy` lets you connect Shyre to your hosting environment (Vercel today; Cloudflare Pages / Fly.io / Render later) and push instance-wide secrets directly from Shyre — no copy-pasting into a dashboard.

System admin only. Single Shyre instance per row (`instance_deploy_config.id = 1` enforced).

## What it does

| Action | What happens |
|---|---|
| **Save connection** | Stores Vercel API token + project ID + (optional) team ID + deploy hook URL. Token is RLS-protected (system admins only). The save validates the token by hitting Vercel's project endpoint. |
| **Provision encryption key** | Generates a fresh 32-byte hex `EMAIL_KEY_ENCRYPTION_KEY`, writes it to all three env tiers (Production / Preview / Development) via Vercel API, triggers a redeploy. Rotation requires `confirm=regenerate` to avoid orphaning every stored team API key. |
| **Set webhook secret** | Takes the `whsec_…` from Resend dashboard and writes it to Vercel as `RESEND_WEBHOOK_SECRET` + redeploys. The value never lands in Shyre's DB; it lives only in Vercel's encrypted env. |
| **Trigger redeploy** | Hits the deploy hook without changing env vars. Useful if you edited a value directly in Vercel. |

## One-time Vercel setup

1. **API token** — vercel.com → account → Settings → Tokens → Create. Scope: full account, or scoped to just the Shyre project. Copy it (Vercel only shows the value once).
2. **Project ID** — Vercel project → Settings → General → Project ID (starts with `prj_…`).
3. **Team ID** (only for team / org accounts) — Vercel team → Settings → General → Team ID (starts with `team_…`). Personal accounts skip.
4. **Deploy hook URL** — Vercel project → Settings → Git → Deploy Hooks → Create. Pick a name (`Shyre env push`), branch (`main`). Copy the URL — it's the secret; treat it like a password.

Paste all four into `/system/deploy` → Save connection.

## Provisioning the encryption key

Hit "Provision encryption key" once. Shyre:

1. Generates 32 random bytes, hex-encodes (matches `openssl rand -hex 32`).
2. Calls Vercel API to upsert `EMAIL_KEY_ENCRYPTION_KEY` on Production + Preview + Development.
3. POSTs to your deploy hook URL → Vercel queues a redeploy with the new env.

Within ~60 seconds the new key is live. Visit `/teams/<id>/email` — the setup checklist's "Master encryption key" item flips to ✓.

⚠️ **Rotating an existing key invalidates every stored Resend API key.** Each `team_email_config.api_key_encrypted` is wrapped (directly, or via the team's DEK) under the current master key. Changing it makes those rows unrecoverable. The page requires you to type `regenerate` before allowing the rotate. Plan re-paste with affected users beforehand.

## Provisioning the webhook secret

Get the secret from Resend:

- resend.com → Webhooks → your webhook → "Signing Secret" → Reveal → copy

Paste into `/system/deploy` → "Save & deploy". Same flow as the encryption key minus the generation step (you supply the value).

## Status panel

The page shows:

- **Vercel connection saved** — `instance_deploy_config` has a row with API token + project ID
- **EMAIL_KEY_ENCRYPTION_KEY set in deployment** — detected via `process.env` at request time, so a redeploy is needed for newly-provisioned values to flip the indicator
- **RESEND_WEBHOOK_SECRET set in deployment** — same detection mechanism
- **Last synced** — when Shyre last touched the deploy provider

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Could not reach Vercel with that token" | Token revoked / wrong scope / wrong project ID | Re-create the token; verify the project ID matches the project you want to push secrets to |
| "Deploy hook URL must start with https://api.vercel.com/" | Pasted the wrong URL — sometimes Vercel's UI shows multiple URLs (production / preview / etc.) | Copy specifically the Deploy Hook URL, not a preview URL |
| Status flag stays warning after provisioning | Redeploy hasn't completed yet | Wait 30–60s and reload `/system/deploy`; if it still shows warning, check Vercel's Deployments tab for build errors |
| `EMAIL_KEY_ENCRYPTION_KEY is already set. To rotate, type 'regenerate'` | The page detected the env var is already configured | Type `regenerate` in the confirm field. Note: existing Resend API keys will become unrecoverable; users will need to re-paste them |
| Provisioning fails with `Vercel /v9/projects/.../env returned 403` | Token scope doesn't include env-var write | Re-create the token with full project access (Settings → Tokens → Create → "Full Account") or fine-grained env-var scope |

## Architecture notes

- **Provider abstraction**: `src/lib/deploy/provider.ts` defines the `DeployProvider` interface. Vercel implementation in `providers/vercel.ts` uses the REST API directly (no SDK). Adding Cloudflare Pages / Fly.io is one new file in `providers/`.
- **Why deploy hook (not API redeploy)**: Vercel's `/v13/deployments` API requires Git context Shyre doesn't track. Deploy hooks are the standard "fire-and-forget redeploy" pattern. Trade-off: the hook URL is a secret you paste; we store it RLS-protected like the API token.
- **Why allow-list `setEnvVarAction`**: Phase 1 only writes `RESEND_WEBHOOK_SECRET`. The action's allow-list (in `src/app/(dashboard)/system/deploy/actions.ts`) prevents a forged action POST from setting an arbitrary env var. New env-var keys require an explicit add to the allow-list.
- **Token storage**: Vercel API token sits as plaintext in `instance_deploy_config.api_token` under system-admin-only RLS — same pattern as `user_settings.github_token`. SAL-019 documents the planned Phase 2 upgrade to encrypt under the master key (chicken-and-egg with the bootstrap UX).

## Related

- [Email setup](email-setup.md) — what these env vars enable
- [Env configuration](env-configuration.md) — full list of Shyre's env vars
- [Security audit log](../../security/SECURITY_AUDIT_LOG.md) — SAL-018 (envelope encryption), SAL-019 (deploy token storage)
