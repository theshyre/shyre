#!/usr/bin/env bash
# Show pending migrations without applying. Safe to run anytime.

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
  exit 1
fi

SESSION_URL=$(echo "$SUPABASE_DB_URL" | sed 's|:6543/|:5432/|')

supabase db push --db-url "$SESSION_URL" --dry-run 2>&1 \
  | sed -E 's|(postgresql://[^:]+):[^@]+@|\1:REDACTED@|g'
