# Email setup (team admin)

> **Audience:** team owner / admin who wants to send invoices from their own domain.
> **Not your role?** If you're the person who deployed Shyre, see [system-admin/email-infrastructure.md](../system-admin/email-infrastructure.md) for the one-time instance setup. On a solo / self-hosted Shyre you do both — start there, then come back here.

Shyre sends invoices as email from your own domain (e.g. `info@malcom.io`) instead of a generic `notifications@shyre.io` sender. This guide walks the team-admin half of the setup. Roughly **8 minutes** if your DNS is responsive.

## Before you start

Two things need to already be true on your Shyre instance — your system admin owns these:

- **Master encryption key** is provisioned (`EMAIL_KEY_ENCRYPTION_KEY` env var). Without it, your API key has nowhere to be encrypted to.
- **Resend webhook secret** is provisioned (`RESEND_WEBHOOK_SECRET` env var). Optional for sending, but required to see delivered / bounced status on your invoices.

Open `/teams/<your-team>/email`. The setup checklist at the top tells you. If you see "Set up by your Shyre administrator" on either item, ask them to follow [system-admin/email-infrastructure.md](../system-admin/email-infrastructure.md). The rest of this guide assumes both green.

## Quick reference (~8 min)

1. Resend account + Full-access API key
2. Domain verification (DNS records + Verify)
3. From / Reply-To / signature in `/teams/<id>/email`
4. Test send to yourself

## Step-by-step

### 1. Resend API key (one time, per business)

- Sign up at [resend.com](https://resend.com) — free tier covers 3,000 emails/month, fine for any solo or small-agency invoice volume.
- Resend dashboard → API Keys → Create API key.
- **Permission: Full access.** Not "Sending access." Sending-only keys can't read or write the domain endpoints Shyre uses for verification — Resend will return `401 restricted_api_key` and you can't recover without making a new key.
- Copy the key (it starts with `re_…`). You'll paste it next.

> Resend keys are scope-locked at creation. If you already made a sending-only key, delete it and create a new one with Full access.

### 2. Verify your domain at Resend

Resend needs to publish DKIM + SPF records on your domain so receiving mail servers can authenticate the messages. Once per domain.

- In Shyre, open your team page (sidebar → Teams → click the team) and click the **Email setup** card. (Owner / admin only — the URL is `/teams/<your-team>/email` if you'd rather paste it.)
- **Save the API key first** — domain verification calls Resend's API, which needs the key.
- Under "Verified domains" → Add domain → enter `malcom.io` (your domain).
- Shyre returns a list of DNS records (one TXT for DKIM, one MX for return-path, one TXT for SPF). Each row shows Type, Name, Priority, Value, Status.
- In your DNS registrar, add each record exactly as shown:
  - **TXT (DKIM)** — copy `Name` (`resend._domainkey`) and the long `p=…` value. TTL default is fine.
  - **MX (return-path)** — copy `Name` (`send`), `Value` (`feedback-smtp.us-east-1.amazonses.com`), and **Priority `10`**. Don't accept the registrar default unless it's already 10.
  - **TXT (SPF)** — see Google Workspace coexistence below if you already have an SPF record.
- Wait 5–30 minutes. DNS is slow.
- Click **Verify**. Resend re-resolves DNS; the per-row Status column tells you which records are good.
- Status flips to ✓ Verified.

> **Verification feels stuck?** You can confirm DNS yourself before clicking Verify with `dig`:
>
> ```sh
> dig +short TXT resend._domainkey.<your-domain> @1.1.1.1
> dig +short MX send.<your-domain> @1.1.1.1
> dig +short TXT send.<your-domain> @1.1.1.1
> ```
>
> All three should return non-empty. Resend's verifier runs asynchronously, so even after dig confirms it, give Verify another 30–60 seconds before you worry.

#### Google Workspace / Gmail coexistence

**Short version:** nothing about your normal Google Workspace mail changes. Gmail keeps receiving mail addressed to `@malcom.io` and keeps sending from Gmail / Workspace exactly as before. Shyre / Resend sends invoice mail in addition to Google.

| DNS record | Controls | Touched by this setup? |
|---|---|---|
| `MX` | Where mail TO `@malcom.io` is delivered (your inbox) | **No** — untouched |
| `TXT resend._domainkey` | Resend's DKIM signing key (FROM auth, Resend only) | **Added** (new selector) |
| `TXT google._domainkey` | Google's DKIM signing key (FROM auth, Google only) | **No** — untouched |
| `TXT @` (SPF) | Which servers may send AS `@malcom.io` | **Merged** — see below |

⚠️ **SPF is the one record you have to merge.** A domain may have only one `v=spf1` TXT record. If you already have:

```
v=spf1 include:_spf.google.com ~all
```

…edit the existing record to include both senders. The merged form looks like:

```
v=spf1 include:_spf.google.com include:amazonses.com ~all
```

(Resend currently delegates outbound to Amazon SES — hence the `amazonses.com` include. Whatever string Resend's "Add domain" panel shows, use that.) Two SPF records breaks both. Adding the DKIM record is purely additive.

### 3. Save email config in Shyre

Back at `/teams/<your-team>/email`:

- **Resend API key** — paste the `re_…` key from step 1 → Save. The key is encrypted at rest with the master encryption key your system admin provisioned.
- **Rotate by** — leave blank when you save a new key and Shyre auto-fills today + 1 year so the dashboard banner can warn you 30, 7, and 0 days out. You'll never get blindsided by a key expiry.
- **From address** — `info@malcom.io` (must use the verified domain). The cleanest pattern is a generic role address like `info@` or `invoices@`, separate from your real mailbox.
- **From name** — your business name.
- **Reply-To** — your real Google Workspace mailbox (e.g. `marcus@malcom.io`). Customer replies thread there.
- **Signature** — auto-appended below every invoice email body.
- **Daily cap** — default 50. A safety belt against abuse if a key is ever compromised.
- **Save email config**.

### 4. Customer contacts (optional but recommended)

Each customer can have multiple contacts (AP manager, project sponsor, etc.). Flag one as **Send invoices to** and the To: field on the Send Invoice modal pre-fills with that contact's email. Without contacts, the To: falls back to the customer's bare `email` field.

- Open `/customers/<customer-id>` → Contacts section.
- Add the people. Click the star to flag the default invoice recipient.

### 5. Test send

- "Send test to me" on the email config page.
- Goes to your logged-in mailbox.
- Confirms: API key works, domain verified, signature renders, attachment delivers.

If the test fails, the error tells you which step needs fixing.

## After setup

Every invoice detail page (`/invoices/<id>`) gets a **Send Invoice** button. Open it, review the email in the Preview tab, hit Send (`⌘↵`).

The email arrives from `info@malcom.io`, replies thread to your real mailbox, and Shyre's audit trail records who sent it, when, the rendered subject + body, the PDF SHA-256, and (within seconds, when the webhook fires) delivered / bounced / complained status.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Resend /domains returned 401: ...restricted_api_key` | API key was created with "Sending access" only | Delete it in Resend, create a new **Full access** key, paste it on the email config page, retry |
| Verify shows "Still pending. Resend's verifier runs asynchronously…" | DNS hasn't propagated, or Resend's worker hasn't re-resolved yet | Wait 30–60 seconds, click Verify again. `dig +short ... @1.1.1.1` confirms DNS independently |
| One row in the records table shows `failed` after Verify | That specific record's Name / Value / Priority doesn't match | Double-check the row — common: registrar appended your apex twice, MX priority isn't 10, or SPF is on a second record instead of merged |
| The saved Resend API key can't be decrypted | Master encryption key was rotated since the key was saved | Re-paste the `re_…` key, Save |
| Invoice email lands in spam | Domain not actually verified, or DMARC misalignment | Re-check DNS via `dig`; for stricter DMARC, add a `_dmarc` TXT record per Resend's recommendation |

## Architecture / security notes (for the curious)

- **Encryption at rest**: API keys are encrypted with AES-256-GCM before storage. The DB stores ciphertext; the master key never reaches Postgres. (SAL-015.)
- **Per-team key isolation**: each team has its own data-encryption key, wrapped under the instance master key. (SAL-018.) A compromised KEK doesn't directly expose any single team's key without also unwrapping their DEK.
- **From-domain enforcement**: every send checks the From domain against `verified_email_domains` for the calling team. (SAL-016.)
- **Header injection guard**: header-bound values (subject, From-name, Reply-To) strip CR/LF before being passed to Resend.
- **Webhook signing**: webhook payloads are HMAC-SHA256 verified against the signing secret + a 5-minute replay window. (SAL-017.)
- **Daily rate limit**: per-team cap on outbound sends. Default 50; configurable on the email config form.

## Roadmap

- **Phase 1.5** — Hosted invoice page: a magic link in the email body that opens a render-only invoice view. Some AP systems strip attachments; the link is a fallback.
- **Phase 2** — Auto-reminders: T-5 pre-due, "3 days late + every 7 days," cap-3.
- **Phase 3** — Resend automation: Shyre creates the webhook + verifies the domain on your behalf via Resend's API.
- **Credentials Phase 2** — pg_cron-driven email reminders before any tracked credential expires (Vercel, Resend, GitHub, Jira).

See [docs/reference/roadmap.md](../../reference/roadmap.md) for the full picture.
