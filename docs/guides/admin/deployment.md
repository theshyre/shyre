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

You'll collect four values from Vercel and paste them into `/system/deploy`. The whole walk takes ~5 minutes.

### 1. API token

Direct link: [vercel.com/account/settings/tokens](https://vercel.com/account/settings/tokens) (or click your avatar in the top-right of any Vercel page → **Settings** → **Tokens** in the left sidebar).

In the **Create Token** form:

- **Token name** — anything memorable, e.g. `Shyre API Token`.
- **Scope** — Vercel shows two options:
  - `<Your team> projects` — grants the token write access to every project owned by that Vercel team. **Recommended** for least-privilege if you're OK with the token having reach across all your Vercel projects (Shyre will only ever touch the one you connect to it).
  - `Full Account` — same project access plus account-level operations Shyre doesn't use. Fine but slightly broader.
- **Expiration** — `1 Year` is the sensible default. Shorter is more secure but means you re-issue more often. Set a calendar reminder when the token is due to expire — Shyre doesn't auto-warn (yet).

Click **Create**. Vercel shows the token value **once** — copy it now into a password manager *and* paste it into Shyre. If you lose it before saving in Shyre, just create another.

### 2. Project ID

1. Go to **vercel.com → Dashboard** (the main page after login).
2. Click your **Shyre project** in the project list.
3. Click the **Settings** tab in the project's top nav (between *Deployments* and *Logs*).
4. The **General** sub-page is the default landing — scroll to **Project ID** in the right column. Copy the value — it starts with `prj_…`.

### 3. Vercel Team ID *(team / organization accounts only)*

Personal Vercel accounts skip this — leave it blank in Shyre.

For team accounts:

1. **vercel.com → top-left team-switcher** → click the team name.
2. Click **Settings** in the team's top nav.
3. **General** sub-page → **Team ID** (starts with `team_…`).

Without it, Shyre's Vercel API calls 404 because team-owned projects aren't reachable from the personal-account scope.

### 4. Deploy hook URL

1. Same Vercel project as step 2 → **Settings** tab.
2. In the Settings left sidebar, click **Git** (under "Project").
3. Scroll to the **Deploy Hooks** section near the bottom.
4. Click **Create Hook**.
   - **Name** — e.g. `Shyre env push`.
   - **Git Branch Name** — your production branch (usually `main`).
5. Click **Create Hook**, then **copy the resulting URL**. It looks like `https://api.vercel.com/v1/integrations/deploy/prj_…/…`.

⚠️ **The URL itself is the secret.** Anyone who has it can trigger a redeploy of your project. Treat it like a password — don't paste it in Slack or commit it. If it ever leaks, delete the hook from this same page and create a new one.

### Paste into Shyre

Open `/system/deploy` (Shyre sidebar → System → Deployment, or visit directly). Paste all four values into the Connection form → **Save connection**. Shyre validates the token by listing your project's env vars before persisting; an invalid token fails inline rather than saving a broken config.

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
