#!/usr/bin/env bash
# Apply pending Supabase migrations to the linked project.
#
# Uses SUPABASE_DB_URL from .env.local, forcing the session-pooler port (5432)
# because `supabase db push` needs prepared-statement support, which the
# transaction pooler (6543) does not provide.
#
# Passwords are scrubbed from CLI output.

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

# Force session-pooler port (5432). Transaction pooler (6543) can't run migrations.
SESSION_URL=$(echo "$SUPABASE_DB_URL" | sed 's|:6543/|:5432/|')

# Run, scrubbing any password leaked into error messages.
supabase db push --db-url "$SESSION_URL" "$@" 2>&1 \
  | sed -E 's|(postgresql://[^:]+):[^@]+@|\1:REDACTED@|g'
