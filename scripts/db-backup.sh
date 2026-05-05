#!/usr/bin/env bash
# Manual database backup.
#
# Dumps the linked Supabase Postgres database to a date-stamped
# `.sql.gz` file under $SHYRE_BACKUP_DIR (default ~/Backups/shyre/).
#
# Uses the Supabase CLI's `db dump` rather than a local pg_dump
# because the CLI bundles a version-matched pg_dump (the server
# runs Postgres 17; Homebrew's pg_dump typically lags). Same
# SUPABASE_DB_URL the migration pipeline uses.
#
# Restore:
#   gunzip < shyre-YYYYMMDD-HHMMSS.sql.gz | psql "$RESTORE_DB_URL"
#
# What this DOES NOT back up:
#   - EMAIL_KEY_ENCRYPTION_KEY (Vercel env var, not in pg). Without
#     it every team_email_config.api_key_encrypted blob in the
#     restored DB is unreadable garbage. Save the value in a
#     password manager separately. Same for RESEND_WEBHOOK_SECRET.
#   - Vercel deployment / domain / DNS state.
#   - Resend account state.
#
# What this DOES back up:
#   - public, auth, and storage schemas (schema + data).
#   - Migration state (so a restored DB knows which migrations
#     have applied).
#   - All encrypted secret blobs (which decrypt fine on restore as
#     long as the same EMAIL_KEY_ENCRYPTION_KEY is in env on the
#     restoring deployment).

set -euo pipefail

if [ ! -f .env.local ]; then
  echo "Error: .env.local not found" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "Error: SUPABASE_DB_URL not set in .env.local" >&2
  echo "Grab the Session pooler URI from Supabase dashboard → Connect → URI" >&2
  exit 1
fi

# Force session-pooler port (5432). Transaction pooler (6543)
# doesn't support pg_dump's prepared statements / consistent snapshot.
SESSION_URL=$(echo "$SUPABASE_DB_URL" | sed 's|:6543/|:5432/|')

# Where dumps land. Override with SHYRE_BACKUP_DIR=/path env var.
BACKUP_DIR="${SHYRE_BACKUP_DIR:-$HOME/Backups/shyre}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SCHEMA_FILE="$BACKUP_DIR/shyre-${TIMESTAMP}-schema.sql"
DATA_FILE="$BACKUP_DIR/shyre-${TIMESTAMP}-data.sql"
OUTFILE="$BACKUP_DIR/shyre-${TIMESTAMP}.sql.gz"

# Cleanup intermediate files on early exit.
cleanup() {
  rm -f "$SCHEMA_FILE" "$DATA_FILE"
}
trap cleanup EXIT

echo "Dumping schema..."
supabase db dump \
  --db-url "$SESSION_URL" \
  -f "$SCHEMA_FILE" \
  2> >(sed -E 's|(postgresql://[^:]+):[^@]+@|\1:REDACTED@|g' >&2)

echo "Dumping data..."
supabase db dump \
  --db-url "$SESSION_URL" \
  --data-only \
  --use-copy \
  -f "$DATA_FILE" \
  2> >(sed -E 's|(postgresql://[^:]+):[^@]+@|\1:REDACTED@|g' >&2)

echo "Combining + compressing..."
cat "$SCHEMA_FILE" "$DATA_FILE" | gzip -9 > "$OUTFILE"

# Print size + restore hint.
SIZE=$(du -h "$OUTFILE" | cut -f1)
echo
echo "Backup complete: $OUTFILE ($SIZE)"
echo
echo "Restore (into a new project / fresh DB):"
echo "  gunzip < \"$OUTFILE\" | psql \"\$RESTORE_DB_URL\""
echo
echo "REMINDER — also save these in your password manager:"
echo "  - EMAIL_KEY_ENCRYPTION_KEY  (master encryption key; Vercel env)"
echo "  - RESEND_WEBHOOK_SECRET     (webhook signing secret; Vercel env)"
echo
echo "Without the master key, encrypted secrets in the restored DB"
echo "(team_email_config.api_key_encrypted, dek_encrypted, etc.) are"
echo "unreadable garbage — users have to re-paste their API keys."
