# Email setup

Sending invoice email from your own domain has two parts. They're owned by different roles on a multi-person Shyre install, and by the same person on a solo / self-hosted one — but the steps don't get blurry, so the docs are split.

## Pick your guide

### → [Team admin: email-setup.md](../team-admin/email-setup.md)

You own a team and want to send invoices from your domain. You'll set up Resend, verify your domain, configure From / Reply-To / signature on `/teams/<your-team>/email`, and send a test.

You don't need Vercel access for this — but two things on your Shyre instance need to already be true: a master encryption key, and a webhook secret. The team-admin guide tells you up-front whether they are.

### → [System admin: email-infrastructure.md](../system-admin/email-infrastructure.md)

You deployed Shyre. You hold the Vercel project. You'll provision two instance-level secrets through `/system/deploy` so every team can configure email.

## Solo? Read both, in order.

Read the system-admin guide first (provisions the two env vars). Then the team-admin guide (configures your team). It's roughly 12 minutes end to end if your DNS is responsive.

## Related

- [Deployment automation](deployment.md) — connect Vercel from `/system/deploy` so the system-admin steps can push env vars without manual dashboard hops.
- [Credentials](credentials.md) — how Shyre tracks rotate-by dates on every API token + key, and how the dashboard banner warns you before expiry.
- [docs/reference/roles-and-permissions.md](../../reference/roles-and-permissions.md) — what "system admin" and "team owner / admin" can each do.
