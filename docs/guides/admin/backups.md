# Backups

How Shyre's Postgres data is backed up today, what's NOT in the backup, restore steps, and what to upgrade to when the manual workflow stops being enough.

## TL;DR

| Tier | Backup story | When you outgrow it |
|---|---|---|
| **Free (today)** | `npm run db:backup` — manual, on-demand, stored locally. Set yourself a calendar reminder. | When you can't tolerate >24h of data loss after a missed backup. |
| **Pro** | Supabase Pro nightly automated backup, 7-day retention, point-in-time recovery (PITR) add-on. | When you have multiple paying customers and SLA-style guarantees. |

## What we have today: manual local backups

`scripts/db-backup.sh` — invoked via `npm run db:backup`. Single command, no flags.

### What it does

1. Reads `SUPABASE_DB_URL` from `.env.local`.
2. Forces port `5432` (session pooler) — the transaction pooler on `:6543` can't take a consistent snapshot.
3. Runs two `supabase db dump` passes:
   - **Schema** (DDL only): structure, indexes, RLS policies, functions, triggers, migration state.
   - **Data** (`--data-only --use-copy`): all rows from `public`, `auth`, and `storage` schemas.
4. Concatenates + gzips the two passes into a single `.sql.gz` under `~/Backups/shyre/` (or `$SHYRE_BACKUP_DIR` if set).
5. Cleans up the intermediate uncompressed files on exit.

The script uses `supabase db dump` (the CLI's bundled, version-matched `pg_dump`) instead of a system `pg_dump`. Without the bundled binary, Homebrew's `pg_dump 16` fails to dump a Supabase `pg_dump 17` server.

### What's IN the backup

- Every `public.*` table — time entries, projects, customers, invoices, expense rows, the message outbox audit trail, encrypted email-config blobs, **all of your business data**.
- `auth.users` and related tables (Supabase Auth state, hashed passwords, MFA secrets).
- `storage` schema metadata (file objects' rows; the binary blobs themselves live in Supabase Storage and are NOT in the dump — see below).
- Migration ledger: a restored DB knows which migrations have been applied, so re-running `db:push` is a no-op against a fresh restore.

### What's NOT in the backup

These are critical and live OUTSIDE the database:

| Item | Where it actually lives | Why it matters |
|---|---|---|
| **`EMAIL_KEY_ENCRYPTION_KEY`** | Vercel env var | Without it, every encrypted email-config blob (`team_email_config.api_key_encrypted`, `dek_encrypted`, etc.) in the restored DB is unreadable garbage. Users would have to re-paste their Resend API keys. |
| **`RESEND_WEBHOOK_SECRET`** | Vercel env var | Required to verify inbound Resend delivery webhooks. Without it the message-outbox state machine can't progress past `sent`. |
| **Vercel deployment / domain / DNS state** | Vercel | A restore brings back the database; a fresh app deployment is a separate path (re-link the domain, push code, etc.). |
| **Resend account state** | Resend | Verified domains, API keys, webhook configurations. Recreated by re-running team-admin email setup against a restored DB. |
| **Supabase Storage binaries** | Supabase Storage S3-compatible bucket | The dump captures the *rows* in `storage.objects` but not the underlying file bytes (avatars, invoice PDFs you stored, etc.). On free tier this is small; download manually if you depend on it. |
| **Vercel Blob, R2, etc.** | Wherever you put them | None today — but if you add them, document them in this list. |

**Action: Save `EMAIL_KEY_ENCRYPTION_KEY` and `RESEND_WEBHOOK_SECRET` in your password manager.** Without them the backup decrypts to scrambled bytes for every email-related row.

### Where backups land

`~/Backups/shyre/shyre-YYYYMMDD-HHMMSS.sql.gz` (override path with `SHYRE_BACKUP_DIR=/path` env var).

Typical size on a small dataset: 250-500 KB compressed. After the 6-year Harvest backfill: estimated 5-15 MB.

### Restoring

Into a brand-new Supabase project (or any Postgres 17 you control):

```bash
gunzip < ~/Backups/shyre/shyre-20260504-170000.sql.gz \
  | psql "$RESTORE_DB_URL"
```

`$RESTORE_DB_URL` is the Session-pooler URI of the destination (Connect → URI in the Supabase dashboard, port 5432).

A clean restore expects an empty target. The dump includes `CREATE TABLE` statements that will fail against a non-empty schema; reset the target first if you're restoring over existing data. **Never** restore over a production DB without a fresh dump of the current production state taken minutes earlier.

After restore, re-set the env vars on your hosting environment to the SAME `EMAIL_KEY_ENCRYPTION_KEY` you saved before — different values mean encrypted blobs decrypt to garbage.

### When to run `db:backup`

- **Before any risky migration** — the migration playbook (`docs/reference/migrations.md`) calls out destructive changes; back up first regardless of whether the migration looks "clearly safe."
- **Before any large import** — a Harvest cutover, a CSV import of historical expenses, anything that adds 1000+ rows in a single shot.
- **Before any package upgrade that touches Supabase clients** (`@supabase/ssr`, `@supabase/supabase-js`).
- **Weekly cadence** during development, daily once you have paying users (until you upgrade to Pro auto-backups).

### Failure modes the manual workflow can't cover

- **You forget to run it.** No reminder, no alert, no enforcement. After the first paying customer, this becomes the #1 risk.
- **Your laptop is the only copy.** Hard-drive failure, theft, ransomware → backup is gone.
- **No PITR.** If a destructive bug ships at 9am and you notice at 3pm, the most recent backup might be from yesterday — six hours of data loss.
- **Single-developer assumption.** The script reads `.env.local`. There's no team workflow.

These limitations are explicitly acceptable for an early-stage solo build. They become unacceptable the day you have a paying customer.

## Future direction

### Short-term (when paying users land): Supabase Pro

Pro tier ($25/month per project) includes:

- **Daily automated backups, 7-day retention.** Stored in Supabase's own infrastructure. Point-and-click restore from the dashboard.
- **Point-in-time recovery (PITR) — additional $100/month add-on.** Restore to any second within the retention window. Mitigates "destructive bug shipped at 9am" scenario.
- **No project pause-after-7-days-idle.** Same upgrade also kills the cold-start problem (see `docs/reference/performance.md`).

Once on Pro, the manual `db:backup` workflow becomes a belt-and-suspenders extra rather than the primary defense. Keep it for the cases where you want a known-good local copy before a risky migration.

### Medium-term: off-site automated backup

Even with Supabase Pro backups, an offsite copy in cold storage (S3 Glacier / Backblaze B2) protects against:

- Supabase account compromise / billing failure / service shutdown.
- Region-level Supabase outage where the Pro backups are also unavailable.

Sketch:

- Cron job on a small box (or GitHub Actions schedule) runs `db:backup` nightly.
- Encrypts the resulting `.sql.gz` with a separate key (NOT `EMAIL_KEY_ENCRYPTION_KEY`).
- Uploads to S3 Glacier Deep Archive ($0.00099/GB/month — pennies for years of weekly snapshots).
- Sends a heartbeat to a Healthchecks.io URL on success; you get paged when the heartbeat goes silent.

Cost: ~$1/month on top of Pro. Don't bother before there's revenue at risk.

### Long-term: encryption-key escrow

The most fragile part of any restore is the encryption key. Today, `EMAIL_KEY_ENCRYPTION_KEY` lives in Vercel and a password manager. If both are gone (account compromise + you forgot to write it down), every encrypted blob in the restored DB is unrecoverable.

When this matters:

- Two-of-three Shamir secret sharing — split the key among trusted parties.
- Hardware security module — AWS KMS, GCP KMS, or self-hosted. Costs ~$1/month per key.
- Documented break-glass procedure: who has access, how to retrieve, who has to be in the room.

Not worth doing before there are users whose business operations depend on the secrets the key protects.

### Retention policy (when it matters)

For a SaaS with customers, "how far back can we restore?" is a governance question, not a technical one:

| Tier | Retention | Cost | Use case |
|---|---|---|---|
| Pro auto-backups | 7 days | included | Operational mistakes, recent bugs |
| Pro PITR | up to 7 days, second-precision | +$100/month | "Restore to 9:43am, before the migration" |
| Off-site nightly | indefinite (cheap cold storage) | ~$1-5/month | Account compromise, region outage |
| Compliance archive (immutable) | 7 years | varies | If you ever sell to enterprise / regulated industries |

Today: free tier + manual local. Don't pay for what you don't yet need.

## See also

- `scripts/db-backup.sh` — the actual script.
- `docs/reference/performance.md` — the cost-benefit framing for tier upgrades.
- `docs/reference/migrations.md` — when to run a backup before a migration.
- `docs/guides/admin/credentials.md` — what other secrets need to be saved alongside `EMAIL_KEY_ENCRYPTION_KEY`.
