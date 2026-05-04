# Credentials

Every API token and key Shyre stores carries a **rotate-by date**. The
dashboard surfaces a banner before the date arrives, the
`/system/credentials` page lists everything in one place, and forms
auto-fill "today + 1 year" any time you save a fresh secret without
picking a date — so the reminder loop closes without you having to
add a calendar event yourself.

## Where you'll see it

### Dashboard banner

Anything that's expired, expiring within 7 days, or expiring within
30 days renders an `<ExpiringCredentialsBanner />` at the top of the
home dashboard. Up to three items show inline; a "+N more" link goes
to the full list.

| State | When | Tone |
|---|---|---|
| Expired | days < 0 | error |
| Critical | 0 ≤ days ≤ 7 | error |
| Warning | 8 ≤ days ≤ 30 | warning |
| Healthy | days > 30 (no banner) | — |

### `/system/credentials`

The full picture. System admin only — gated by the `/system` layout.
Groups every tracked credential by severity (Expired / Critical /
Warning / Healthy), shows the rotate-by date, and links each row
straight to the form that rotates it.

Credentials with **no rotate-by date set** show in the Healthy
group with a "pick one to enable reminders" hint. The whole point of
the page is to make that gap visible — silent credentials are the
scenario the feature was built to prevent.

## What's tracked

| Credential | Scope | Form | Column |
|---|---|---|---|
| Vercel API token | Instance | `/system/deploy` | `instance_deploy_config.api_token_expires_at` |
| Resend API key | Team | `/teams/{id}/email` | `team_email_config.api_key_expires_at` |
| GitHub PAT | User | `/profile` | `user_settings.github_token_expires_at` |
| Jira API token | User | `/profile` | `user_settings.jira_api_token_expires_at` |

Adding a new credential? Add a column to its table (matching pattern,
nullable `DATE`), then extend `scanCredentials()` in
`src/lib/credentials/scan.ts`. The banner + system page pick it up
automatically.

## Autofill behavior

Every credential form has a "Rotate by" date field. Two paths:

1. **You pick a date.** Saved verbatim. Standard.
2. **You leave it blank AND paste a fresh secret.** Shyre fills in
   today + 365 days. The banner will warn you 30, 7, and 0 days out.

If you save the form **without** pasting a new secret and **without**
changing the date, nothing changes — the existing rotate-by date
stays put.

> The +1 year default is centralized in
> [`src/lib/credentials/expiry.ts`](../../../src/lib/credentials/expiry.ts).
> Computed in UTC so the same paste from two timezones produces the
> same date — `DATE` columns are tz-naive.

## Phase 2 (planned)

Phase 1 (this guide) is in-app only. Phase 2 adds out-of-app
reminders so you're warned even when you aren't logged in: pg_cron
daily sweep emitting an admin email per band-transition, per-credential
"snooze 30 days" button, calendar feed at `/system/credentials.ics`,
optional Slack webhook. Tracked in
[`docs/reference/roadmap.md`](../../reference/roadmap.md#credential-expiration-phase-2-proactive-reminders).
