#!/bin/sh
# Create/update the non-owner `pas_app` role. See app-role.sql.
# Env: DATABASE_URL_OWNER (falls back to DATABASE_URL), PAS_APP_PASSWORD. Values already in the
# environment win over the root .env.
set -eu
cd "$(dirname "$0")"

if [ -f ../../../.env ]; then
  url_owner="${DATABASE_URL_OWNER:-}" url="${DATABASE_URL:-}" password="${PAS_APP_PASSWORD:-}"
  set -a
  . ../../../.env
  set +a
  [ -n "$url_owner" ] && DATABASE_URL_OWNER="$url_owner"
  [ -n "$url" ] && DATABASE_URL="$url"
  [ -n "$password" ] && PAS_APP_PASSWORD="$password"
fi

owner_url="${DATABASE_URL_OWNER:-${DATABASE_URL:-}}"
if [ -z "$owner_url" ]; then
  echo "Set DATABASE_URL_OWNER (or DATABASE_URL) to a connection string for the owner role." >&2
  exit 1
fi
if [ -z "${PAS_APP_PASSWORD:-}" ]; then
  echo "Set PAS_APP_PASSWORD to the password for the pas_app role." >&2
  exit 1
fi

exec psql "$owner_url" -v ON_ERROR_STOP=1 -v app_password="$PAS_APP_PASSWORD" -f app-role.sql
