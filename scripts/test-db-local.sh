#!/usr/bin/env bash
# Runs the MatIQ migrations and database security tests against a plain
# PostgreSQL 15+ server (no Docker, no Supabase CLI). Uses a throwaway
# database that is dropped afterwards.
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./scripts/test-db-local.sh
#
# The connecting role must be a superuser (it creates roles and schemas).
# `supabase test db` against the real local stack remains the source of truth.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="matiq_test_$$"

createdb -E UTF8 -T template0 --locale=C.UTF-8 "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true; psql -d postgres -qc "drop role if exists anon, authenticated, service_role" >/dev/null 2>&1 || true' EXIT

run() { psql -v ON_ERROR_STOP=1 -X -q -d "$DB" "$@"; }

echo "==> Installing Supabase platform stub"
run -f "$ROOT/supabase/tests/local/00_supabase_stub.sql"

echo "==> Applying migrations"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$migration")"
  run -f "$migration"
done

echo "==> Running database tests"
for test_file in "$ROOT"/supabase/tests/database/*.test.sql; do
  echo "    $(basename "$test_file")"
  # The real pgTAP extension is replaced by the shim from the stub.
  sed '/create extension if not exists pgtap/d' "$test_file" | run -At | grep -E '^(ok|all) ' | tail -n 1
done
echo "==> Database tests passed"
