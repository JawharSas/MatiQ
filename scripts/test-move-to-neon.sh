#!/usr/bin/env bash
# Tests scripts/move-to-neon.mjs end to end on one local PostgreSQL 15+
# server: a Supabase-shaped source (the platform stub plus the Supabase
# Auth columns the move reads, the migrations, neon/tests/move/seed-source.sql)
# and a Neon-shaped target (as in scripts/test-db-neon.sh). Clerk, Supabase
# Storage and Neon's S3 are local fakes (neon/tests/move/move.test.mjs).
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./scripts/test-move-to-neon.sh
#
# Needs `npm ci` first. The connecting role must be a superuser.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="matiq_move_source_$$"
export PGOPTIONS="--client-min-messages=warning"
TARGET="matiq_move_target_$$"

cleanup() {
  dropdb --if-exists "$SOURCE" >/dev/null 2>&1 || true
  dropdb --if-exists "$TARGET" >/dev/null 2>&1 || true
  psql -d postgres -qc "drop role if exists anon, anonymous, authenticated, service_role, authenticator" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Roles are cluster-wide: clear any left by an earlier run.
cleanup

echo "==> Supabase-shaped source"
createdb -E UTF8 -T template0 --locale=C.UTF-8 "$SOURCE"
src() { psql -v ON_ERROR_STOP=1 -X -q -d "$SOURCE" "$@"; }
src -f "$ROOT/supabase/tests/local/00_supabase_stub.sql"
# What real Supabase Auth has and the move reads.
src -c "alter table auth.users add column encrypted_password text, add column email_confirmed_at timestamptz,
          add column deleted_at timestamptz, add column is_anonymous boolean not null default false;
        alter table auth.mfa_factors add column secret text;"
for migration in "$ROOT"/supabase/migrations/*.sql; do src -f "$migration" >/dev/null; done
src -f "$ROOT/neon/tests/move/seed-source.sql"

echo "==> Neon-shaped target"
createdb -E UTF8 -T template0 --locale=C.UTF-8 "$TARGET"
dst() { psql -v ON_ERROR_STOP=1 -X -q -d "$TARGET" "$@"; }
dst -f "$ROOT/neon/tests/local/pg_session_jwt_stub.sql"
dst -f "$ROOT/neon/compat.sql" >/dev/null
for migration in "$ROOT"/supabase/migrations/*.sql; do node "$ROOT/scripts/neon-sql.mjs" "$migration" | dst >/dev/null; done
for migration in "$ROOT"/neon/migrations/*.sql; do dst -f "$migration" >/dev/null; done

echo "==> Moving"
url() { echo "postgresql://${PGUSER:-postgres}:${PGPASSWORD:-}@${PGHOST:-localhost}:${PGPORT:-5432}/$1"; }
SOURCE_URL="$(url "$SOURCE")" TARGET_URL="$(url "$TARGET")" \
  node --test "$ROOT/neon/tests/move/move.test.mjs"
