# Ticket linking — Jira + GitHub

Type a ticket key into a time-entry description and Shyre auto-fetches the title from Jira or GitHub.

## Why this exists

Most consulting work is anchored to a ticket somewhere. Re-typing the ticket title on every entry is tedious and drift-prone — paste the key (`PROJ-123`, `octokit/rest.js#42`) and Shyre handles the rest. Your description stays exactly what you typed; the resolved title lands in dedicated metadata so a Jira rename later doesn't silently mutate the entry's note.

## Where it lives

- **Settings**: Profile → Integrations.
- **Display**: every time-entry row that links to a ticket shows a small chip below the description with the provider icon, the key, and the resolved title.

## How to set up

### GitHub

1. Visit https://github.com/settings/tokens (Personal Access Tokens → Fine-grained or Classic).
2. Mint a token with `repo` scope (Classic) or "Contents: read" + "Issues: read" on the repos you'll link to (Fine-grained).
3. Paste into Profile → Integrations → GitHub Personal Access Token. Save.

### Jira

1. Visit https://id.atlassian.com/manage-profile/security/api-tokens.
2. Click **Create API token**, copy the value.
3. In Profile → Integrations → Jira:
   - **Base URL**: `https://yourcompany.atlassian.net`
   - **Email**: your Atlassian account email
   - **API token**: paste from step 2
4. Save.

Both tokens are personal — they inherit your permissions. They're stored encrypted, scoped to your user, and never visible to teammates.

## How linking works

### Long-form keys (always work)

Type any of these in a time-entry description and Shyre detects + resolves on save:

- `PROJ-123` — Jira issue (uppercase project key + number)
- `octokit/rest.js#42` — GitHub issue or PR

The first match wins; long-form GitHub takes precedence over Jira when both appear in the same description.

### Short-form GitHub (project default)

If your Shyre project has a default GitHub repo set (Project → Settings → GitHub repo), a bare `#42` in the description resolves to `<that-repo>#42`. Saves you typing the owner/repo on every entry when you're heads-down on one repo.

### What happens on save

1. Shyre scans your description for the first match.
2. If a match is found AND you have the right credentials configured, it fetches the title from Jira/GitHub.
3. The title + URL get stored on the entry alongside (not in) your description.
4. The chip appears below the description with the provider icon, the key, and the title.

If you haven't set up credentials yet, the chip still appears with just the key — and a refresh button you can click once you've added the token.

## Refreshing a stale title

Tickets get renamed. Click the ↻ button on the chip and Shyre re-fetches the latest title from Jira/GitHub. Only the entry's author can refresh (the same person who typed the description and would notice the rename).

## What's intentionally out of scope

- Browser extensions — clicking "Start timer" inside Jira/GitHub. Use the description-paste flow instead.
- Webhooks — pushing ticket-status changes from Jira/GitHub into Shyre.
- Auto-assigning a project from a ticket reference. The user picks the project; Shyre attaches the ticket once they paste the key.

## Troubleshooting

- **No chip appears after I typed the key.** Make sure the key matches the pattern: Jira keys are uppercase (`PROJ-123`, not `proj-123`); GitHub long-form needs `owner/repo#NNN`. The detection regex is conservative on purpose — false positives on lowercase strings would generate confusing chips.
- **Chip shows but no title.** No credentials configured for that provider, or the lookup got a 404. Configure credentials in Settings, then click ↻.
- **Title in chip is outdated.** Click ↻ to refresh.
- **My token works but Jira lookup fails.** Verify the base URL ends in `.atlassian.net` (no trailing slash needed) and the email matches the Atlassian account that minted the token.

## Permissions

- **See ticket chip on someone else's entry**: visible on any entry you can read.
- **Refresh title on someone else's entry**: not allowed. Only the entry's author can refresh.
- **Edit credentials**: each user manages their own. Tokens are never shared across teammates.

## Related

- [Time entries](time-entries.md)
- [Imports](imports.md) — Harvest entries with attached Jira/GitHub keys carry through during import (when the description contains the key).
