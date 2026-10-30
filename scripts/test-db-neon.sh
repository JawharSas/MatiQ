#!/usr/bin/env bash
# Runs the MatIQ migrations and database tests the way they run on Neon
# (docs/NEON_CLERK_MIGRATION.md), against a plain PostgreSQL 15+ server:
#
#   pg_session_jwt stand-in -> neon/compat.sql -> supabase/migrations
#   rewritten by scripts/neon-sql.mjs -> neon/migrations -> the pgTAP tests
#   (rewritten the same way) and neon/tests/database.
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./scripts/test-db-neon.sh
#
# The connecting role must be a superuser (it creates roles and schemas).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="matiq_neon_test_$$"

createdb -E UTF8 -T template0 --locale=C.UTF-8 "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true; psql -d postgres -qc "drop role if exists anon, anonymous, authenticated, service_role" >/dev/null 2>&1 || true' EXIT

run() { psql -v ON_ERROR_STOP=1 -X -q -d "$DB" "$@"; }
neon_sql() { node "$ROOT/scripts/neon-sql.mjs" "$1"; }

echo "==> Installing the pg_session_jwt stand-in and the pgTAP shim"
run -f "$ROOT/neon/tests/local/pg_session_jwt_stub.sql"
run -f "$ROOT/supabase/tests/local/01_pgtap_shim.sql"

echo "==> Applying neon/compat.sql"
run -f "$ROOT/neon/compat.sql"

echo "==> Applying migrations"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$migration")"
  neon_sql "$migration" | run
done
for migration in "$ROOT"/neon/migrations/*.sql; do
  [ -e "$migration" ] || continue
  echo "    neon/$(basename "$migration")"
  run -f "$migration"
done

echo "==> Running database tests"
for test_file in "$ROOT"/supabase/tests/database/*.test.sql "$ROOT"/neon/tests/database/*.test.sql; do
  [ -e "$test_file" ] || continue
  echo "    $(basename "$test_file")"
  neon_sql "$test_file" | sed '/create extension if not exists pgtap/d' | run -At | grep -E '^(ok|all) ' | tail -n 1
done
echo "==> Database tests passed"
