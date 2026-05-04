# Email setup

Shyre sends invoices as email from your own domain (e.g. `info@malcom.io`) — not from a generic `notifications@shyre.io` sender. This walks through the one-time setup. ~10 minutes start to finish.

## Why this setup exists

Shyre uses [Resend](https://resend.com) as the actual email-delivery service ("transactional email" — built for app-generated mail). Resend signs your outgoing mail with **DKIM** + **SPF** so the recipient's mail server can prove the message really came from your domain. Without that, modern Gmail / Outlook quarantines invoice emails as phishing-adjacent.

Bring-your-own API key is intentional. The `From:` address is *your* domain; you own the deliverability. Shyre never sees the customer's reply.

## What you need

| Step | What | Where | One-time? |
|---|---|---|---|
| 1 | Master encryption key in `EMAIL_KEY_ENCRYPTION_KEY` env var | Vercel | Yes (per Shyre instance) |
| 2 | Resend account + API key | resend.com | Yes (per business) |
| 3 | Domain verified at Resend (DKIM + SPF DNS records) | Your DNS registrar | Yes (per domain) |
| 4 | Resend webhook secret in `RESEND_WEBHOOK_SECRET` env var | Vercel + Resend | Yes (per Shyre instance) |
| 5 | API key + From + Reply-To + signature saved in Shyre | `/teams/<id>/email` | Yes (per team) |
| 6 | Test send to yourself | `/teams/<id>/email` | Yes (verify it works) |

## Step-by-step

### 1. Master encryption key (one time, per Shyre instance)

Shyre encrypts every team's stored Resend API key using AES-256-GCM. The master key (KEK) lives in your deployment's environment variables. Generate one:

```sh
openssl rand -hex 32
```

Add it to Vercel:

- Vercel dashboard → your project → Settings → Environment Variables
- Name: `EMAIL_KEY_ENCRYPTION_KEY`
- Value: the hex string from `openssl`
- Apply to: **Production** + **Preview** + **Development**
- Save → trigger a redeploy

> ⚠️ **Lose this key and every stored API key becomes unrecoverable garbage.** Users have to re-paste their keys. Store the value somewhere durable (your password manager) before pasting it into Vercel.
>
> **Do NOT share the key between dev and prod.** Use different keys for `Development` / `Preview` / `Production` so dev data and prod data are mutually unreadable.

### 2. Resend API key (one time, per business)

- Sign up at [resend.com](https://resend.com) (free tier: 3,000 emails/month — covers any solo invoice volume)
- Resend dashboard → API Keys → Create API key → "Sending access"
- Copy the key (it starts with `re_…`)

You'll paste this in step 5.

### 3. Verify your domain at Resend (one time, per domain)

Resend needs to publish DKIM + SPF records on your domain so receiving mail servers can authenticate the messages. You'll do this once per domain.

- In Shyre, open your team page (sidebar → Teams → click the team) and click the **Email** button in the top-right of the header. (Owner/admin only — the button is hidden for plain members. The URL is `/teams/<your-team>/email` if you'd rather paste it.)
- Save the API key first (paste + Save)
- Under "Verified domains" → Add domain → enter `malcom.io` (your domain)
- Shyre returns a list of DNS records (TXT + CNAMEs)
- In your DNS registrar, add each record exactly as shown
- Wait 1–5 minutes for DNS to propagate
- Click "Verify" — Shyre re-asks Resend if the records check out
- Status flips to ✓ Verified

> **If you use Google Workspace / Gmail for incoming mail**: this setup *does not affect inbound delivery*. MX records control where mail TO `@malcom.io` goes (Google). DKIM + SPF control authentication of mail FROM `@malcom.io`. Different concerns.
>
> ⚠️ **SPF is a single TXT record per domain.** If you already have `v=spf1 include:_spf.google.com ~all`, MERGE Resend's include into that line — don't add a second SPF record. Two SPF records breaks both.

### 4. Webhook secret (one time, per Shyre instance)

Resend sends Shyre webhooks when an invoice email is delivered, bounces, or gets a complaint. Shyre verifies the signature so an attacker can't forge "delivered" events.

- Resend dashboard → Webhooks → Add endpoint
- URL: `https://<your-shyre-domain>/api/messaging/webhook/resend`
- Events: `email.delivered`, `email.bounced`, `email.complained`
- Save → copy the signing secret (`whsec_…`)

Add to Vercel:

- Name: `RESEND_WEBHOOK_SECRET`
- Value: the `whsec_…` string
- Apply to: Production (+ Preview if you test there)
- Save → redeploy

### 5. Save email config in Shyre (one time, per team)

Back at `/teams/<your-team>/email`:

- **Resend API key**: paste the `re_…` key from step 2 → Save (it gets encrypted with the KEK from step 1)
- **From address**: `info@malcom.io` (must use the verified domain from step 3)
- **From name**: your business name
- **Reply-To**: `marcus@malcom.io` (your real mailbox; customer replies land here)
- **Signature**: auto-appended below every invoice email body
- **Daily cap**: how many sends per 24h (default 50; defends against compromised-account abuse)
- **Save email config**

### 6. Send a test to yourself

- "Send test to me" button on the same page
- Goes to your logged-in email
- Confirms: API key works, domain is verified, signature renders, attachment delivers

If the test fails, the error message tells you which step needs fixing.

## After setup

Every invoice detail page (`/invoices/<id>`) gets a **Send Invoice** button. Open it, review the email in the Preview tab, hit Send (`⌘↵`).

The email arrives from `info@malcom.io`, replies thread to `marcus@malcom.io`, and Shyre's audit trail records: who sent it, when, the rendered subject + body, the PDF SHA-256, and (a few seconds later when Resend's webhook fires) delivered / bounced / complained status.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Email is not configured for this team" | Team has no `team_email_config` row | Save API key + From in `/teams/<id>/email` |
| "Domain ${x} is not verified" | Step 3 not complete or DNS hasn't propagated | Wait, then click Verify |
| "Email API key could not be decrypted" | `EMAIL_KEY_ENCRYPTION_KEY` env var changed since the key was saved | Restore the original master key, OR re-paste the API key (re-encrypts with the new master) |
| "Daily send cap reached" | Hit the per-team cap | Wait until midnight UTC, or raise the cap |
| Webhook events not arriving (status stays "sent") | `RESEND_WEBHOOK_SECRET` missing or wrong, or webhook URL not pointed at your Shyre deployment | Verify env var matches Resend dashboard's signing secret; verify the webhook URL is your prod hostname |
| Invoice email lands in spam | Domain not actually verified, or DMARC misalignment | Re-check DNS records; for stricter DMARC, add a `_dmarc` TXT record per Resend's recommendation |

## Architecture / security notes

- **Encryption at rest**: API keys are encrypted with AES-256-GCM before storage. The DB stores opaque ciphertext; the master key never reaches Postgres. (SAL-015.)
- **From-domain enforcement**: every send checks the domain against `verified_email_domains` for the calling team. Resend's check is one layer; Shyre's is the second. (SAL-016.)
- **Header injection**: all header-bound values (subject, from-name, reply-to) strip CR/LF before being passed to Resend. (Defends `Bcc:`-injection via crafted invoice descriptions.)
- **Webhook signing**: every webhook payload is HMAC-SHA256 verified against the signing secret + a 5-minute replay window. (SAL-017.)
- **Rate limit**: per-team daily cap on outbound sends. Defaults to 50; configurable.
- **Bounce / complaint**: customer's email is auto-flagged via `customers.bounced_at` so future sends skip them by default.

## Roadmap

- **Phase 1.5** — Vercel automation: Shyre writes `EMAIL_KEY_ENCRYPTION_KEY` and `RESEND_WEBHOOK_SECRET` directly to your Vercel project from `/system/deploy`. Removes steps 1 + 4 from this guide.
- **Phase 1.6** — Hosted invoice page: a magic link in the email body that opens a render-only invoice view. Some AP systems strip attachments; magic link is a fallback.
- **Phase 2** — Auto-reminders: T-5 pre-due, "3 days late + every 7 days," cap-3.
- **Phase 3** — Resend automation: Shyre creates the webhook + verifies the domain on your behalf via Resend's API.
