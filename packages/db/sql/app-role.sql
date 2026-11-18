-- Non-owner application role so row-level security applies.
--
-- Postgres superusers and table owners bypass RLS, so the API and worker must not connect as the
-- role that owns the tables. This script creates `pas_app`: it can read and write data but owns
-- nothing and cannot run DDL.
--
-- Run it as the OWNER role (the one that runs `prisma migrate deploy` and installs the pg-boss
-- and pg-workflows schemas), after migrations, `pnpm queues:setup` and `pnpm workflows:setup`.
-- It is idempotent: re-running it re-applies grants and resets the password.
--
--   psql "$DATABASE_URL_OWNER" -v ON_ERROR_STOP=1 -v app_password="$PAS_APP_PASSWORD" -f sql/app-role.sql
--
-- Or `pnpm db:app-role` (reads DATABASE_URL_OWNER, falling back to DATABASE_URL, and
-- PAS_APP_PASSWORD from the root .env).
--
-- ALTER DEFAULT PRIVILEGES only covers objects created later BY THE ROLE RUNNING THIS SCRIPT, so
-- run it as the same role that runs migrations and pg-boss installs.

\set ON_ERROR_STOP on

\if :{?app_password}
\else
  \echo 'app_password is required: psql -v app_password=... -f app-role.sql'
  \quit
\endif

-- Role ------------------------------------------------------------------------------------------

SELECT format('CREATE ROLE pas_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pas_app')
\gexec

SELECT format('ALTER ROLE pas_app LOGIN PASSWORD %L', :'app_password')
\gexec

-- Make sure the role can never bypass RLS or run DDL, even if someone altered it by hand.
ALTER ROLE pas_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

SELECT format('GRANT CONNECT ON DATABASE %I TO pas_app', current_database())
\gexec

-- pg-boss and pg-workflows install into these schemas (as the owner). Create them up front so the
-- grants below have something to attach to; both are fine with a pre-existing empty schema.
CREATE SCHEMA IF NOT EXISTS pgboss;
CREATE SCHEMA IF NOT EXISTS pgworkflows;

-- Existing objects ------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public, pgboss, pgworkflows TO pas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, pgboss, pgworkflows TO pas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, pgboss, pgworkflows TO pas_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO pas_app;

-- Future objects created by this (owner) role ---------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA public, pgboss, pgworkflows
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, pgboss, pgworkflows
  GRANT USAGE, SELECT ON SEQUENCES TO pas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT EXECUTE ON FUNCTIONS TO pas_app;
