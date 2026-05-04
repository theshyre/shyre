# Email infrastructure (system admin)

> **Audience:** the person who deployed Shyre. You hold the Vercel project, you have system-admin access in Shyre (gates `/system/*`), and you need to provision two instance-level secrets so team admins can configure email per team.
> **Not your role?** If you're a team owner / admin trying to send invoices, see [team-admin/email-setup.md](../team-admin/email-setup.md) instead. The two parts are independent.

This guide walks the **two instance-level secrets** that have to exist before any team can save a Resend API key or see delivered / bounced status. Both are now provisioned through Shyre itself — no manual Vercel-dashboard hops.

Roughly **3 minutes** end to end if Vercel is already connected.

## What you're configuring

| Secret | Why | Affects | Owner |
|---|---|---|---|
| `EMAIL_KEY_ENCRYPTION_KEY` | Master key (KEK) that wraps every team's data-encryption key. Required for any team to save a Resend API key. | Every team | You |
| `RESEND_WEBHOOK_SECRET` | HMAC signing secret Resend sends with every webhook. Without it, sending still works but delivered / bounced status doesn't flow back. | Every team | You |

After these, every team admin runs through their own setup at `/teams/<id>/email` (the [team-admin guide](../team-admin/email-setup.md)).

## Prerequisite: connect Vercel from /system/deploy

Both steps below push their value to Vercel through Shyre's deploy automation. If you haven't connected Vercel yet, do that first:

- See [deployment.md](../admin/deployment.md) for the full walkthrough (API token, project ID, optional team ID, deploy hook URL).
- The connection lives in `/system/deploy` — the very same page you'll use for steps 1 and 2 below.

## 1. Master encryption key (one time, per Shyre instance)

Shyre encrypts every team's stored Resend API key (and any future per-team secret) using AES-256-GCM. The master key (KEK) lives in your deployment's environment as `EMAIL_KEY_ENCRYPTION_KEY`. Shyre generates and pushes it for you.

- `/system/deploy` → Master encryption key panel → **Provision encryption key**.
- Shyre generates a fresh 32-byte hex key, writes it to Vercel as `EMAIL_KEY_ENCRYPTION_KEY` for Production / Preview / Development, and triggers a redeploy.

When the redeploy lands, the setup checklist on every team's `/teams/<id>/email` page flips the "Master encryption key configured" item to ✓.

> ⚠️ **Lose this key and every stored team API key becomes unrecoverable garbage.** Users have to re-paste their Resend keys. The key only lives in Vercel — Shyre never persists it. Rotating it (running Provision again, with the typed `regenerate` confirm) wipes out every existing team's encrypted secrets, so don't rotate casually.

> **Manual fallback (rarely needed)**: if you'd rather generate the key yourself, `openssl rand -hex 32` produces the right value. Paste it as `EMAIL_KEY_ENCRYPTION_KEY` in Vercel for all three environments and redeploy. Use *different* keys for Development / Preview / Production so dev data and prod data stay mutually unreadable.

## 2. Resend webhook secret (one time, per Shyre instance)

Resend POSTs Shyre when an email is delivered, bounces, or gets a complaint. Shyre verifies the HMAC signature on every webhook so an attacker can't forge "delivered" events. The signing secret is `RESEND_WEBHOOK_SECRET`.

In Resend (any team-admin's account, since the webhook is instance-wide):

- Resend dashboard → Webhooks → Add endpoint.
- URL: `https://<your-shyre-domain>/api/messaging/webhook/resend`
- Events: `email.delivered`, `email.bounced`, `email.complained`
- Save → copy the `whsec_…` signing secret.

In Shyre:

- `/system/deploy` → Resend webhook secret panel → paste the `whsec_…` string → **Save & deploy**.
- Shyre writes `RESEND_WEBHOOK_SECRET` to Vercel for every environment and triggers a redeploy.

Pasting a new value later replaces the previous one — same flow, no Vercel UI required. If you'd rather set it manually, the variable is `RESEND_WEBHOOK_SECRET` and the value is the `whsec_…` string; redeploy after.

## Verification

After both redeploys land, open `/teams/<any-team>/email` (you can pick any team you're a member of). The setup checklist shows:

- ✓ Master encryption key configured
- ✓ Resend webhook secret configured

If either still says "Set up by your Shyre administrator," the env var didn't make it into the running deployment — check the redeploy in Vercel's dashboard.

## Credential expiration reminders

Every API token Shyre stores carries a rotate-by date and the dashboard surfaces a banner before it expires. Two relevant credentials here:

- **Vercel API token** — used by `/system/deploy` to push env vars. Stored in `instance_deploy_config.api_token`. Rotate-by date defaults to today + 1 year on save.
- **Resend API key** — per-team. Same rotate-by treatment, but managed by team admins (you don't see other teams' rotate-by dates).

`/system/credentials` lists every credential the instance tracks across all teams. See [docs/guides/admin/credentials.md](../admin/credentials.md) for the full feature.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `EMAIL_KEY_ENCRYPTION_KEY env var not set. Generate with openssl…` thrown by team-admin save | Provision step never ran, or redeploy didn't pick up the value | `/system/deploy` → Master encryption key → Provision; verify the redeploy completed in Vercel |
| Webhooks fire (Resend dashboard shows 200) but invoice status doesn't update | Wrong `RESEND_WEBHOOK_SECRET`, or Shyre's webhook URL doesn't match what Resend has | Re-paste the `whsec_…` from Resend dashboard via `/system/deploy`; verify the URL in Resend matches your prod hostname |
| `EMAIL_KEY_ENCRYPTION_KEY must be 32 bytes…` on save | A manual paste used an 8-byte / wrong-length value | Use Provision (it generates the right length), or `openssl rand -hex 32` |
| Lost the master key after a Vercel project migration | Backup wasn't kept | Re-provision (creates a NEW key), then have every team admin re-paste their Resend key — the old encrypted blobs are unrecoverable |

## Architecture notes

- **Two-layer envelope encryption.** The KEK wraps each team's per-team data-encryption key (DEK). Saved Resend API keys are encrypted with the team's DEK. SAL-018 documents the upgrade path.
- **The KEK only ever lives in env**, never in the DB. A pg_dump leak doesn't expose the master key.
- **The webhook secret is not chained to the KEK.** It's just the HMAC signing secret Resend uses; rotating it doesn't invalidate any stored data.
- **Both env vars apply to all three Vercel environments** so dev / preview behave identically to prod when you test there. Use different KEK values per environment to keep dev/prod data mutually unreadable.

## Roadmap

- **Encrypt `instance_deploy_config.api_token`** (the Vercel API token Shyre stores). Today RLS-only; Phase 2 wraps under the master key. SAL-019.
- **Bootstrap automation**: Shyre provisions the Resend webhook + verifies domain via Resend's API on team-admin's behalf. Reduces this guide's manual Resend hop.

See [docs/reference/roadmap.md](../../reference/roadmap.md) for the full picture.
