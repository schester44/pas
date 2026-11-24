#!/bin/sh
# Empties the database: drops the queue and workflow schemas, then resets and re-applies every
# Prisma migration. Env: DATABASE_URL_OWNER (falls back to DATABASE_URL).
set -eu
cd "$(dirname "$0")"

if [ -f ../../../.env ]; then
  url_owner="${DATABASE_URL_OWNER:-}" url="${DATABASE_URL:-}"
  set -a
  . ../../../.env
  set +a
  [ -n "$url_owner" ] && DATABASE_URL_OWNER="$url_owner"
  [ -n "$url" ] && DATABASE_URL="$url"
fi

owner_url="${DATABASE_URL_OWNER:-${DATABASE_URL:-}}"
if [ -z "$owner_url" ]; then
  echo "Set DATABASE_URL_OWNER (or DATABASE_URL) to a connection string for the owner role." >&2
  exit 1
fi

psql "$owner_url" -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA IF EXISTS workflows CASCADE;"
cd .. && pnpm exec prisma migrate reset --force
