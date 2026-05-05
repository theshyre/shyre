# System admin guides

The tools behind the System Admin section of the sidebar.

- [Going live: Harvest → Shyre cutover checklist](going-live-checklist.md) — pre-import setup, year-by-year strategy, cutover day, and what to verify after.
- [Email setup](email-setup.md) — audience router. Splits into:
  - [Team admin: email setup](../team-admin/email-setup.md) — Resend account, domain verification, From / Reply-To / signature, test send (8 min).
  - [System admin: email infrastructure](../system-admin/email-infrastructure.md) — master encryption key + Resend webhook secret via `/system/deploy` (3 min).
- [Deployment automation](deployment.md) — connect Vercel from `/system/deploy` so Shyre can push the master encryption key + webhook secret to your hosting environment without copy-pasting.
- [Credentials](credentials.md) — every API token + key Shyre tracks, rotate-by dates, dashboard banner behavior, and where to update each one.
- [Env configuration](env-configuration.md)
- [Error log](error-log.md)
- [Users (all)](users.md)
- [All teams](teams.md)
- [Sample data tool](sample-data.md)
- [Backups](backups.md) — manual `npm run db:backup` workflow today, Supabase Pro / off-site / key-escrow upgrade path tomorrow.
