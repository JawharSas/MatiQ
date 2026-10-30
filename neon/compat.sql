-- =============================================================================
-- Neon compatibility layer, applied before the MatIQ migrations.
--
-- The migrations in supabase/migrations were written for Supabase. On Neon
-- (see docs/NEON_CLERK_MIGRATION.md) they are applied after
-- scripts/neon-sql.mjs rewrites the few Supabase Auth names they use:
--
--   auth.uid() / auth.jwt() / auth.role()     ->  app.uid() / app.jwt() / app.role()
--   auth.users / sessions / audit_log_entries /
--   mfa_factors                               ->  app.users / ...
--
-- The `auth` schema itself belongs to Neon's pg_session_jwt extension (the
-- Data API's JWT session: auth.user_id(), auth.session()). Everything else
-- the migrations expect from Supabase is provided here: the API roles, the
-- `extensions` schema, Supabase Storage's tables (kept as the permission
-- and metadata layer; the files live in Neon Object Storage, see the
-- `files` function). Supabase's Realtime publication and its `authenticator`
-- role are left out: the migrations only touch them when they exist.
--
-- Idempotent: safe to run on every deploy.
-- =============================================================================

-- Roles -------------------------------------------------------------------------
-- The Data API runs requests as `authenticated` (valid token) or `anonymous`.
-- `anon` and `service_role` are Supabase's names; the migrations grant to
-- them, but nothing logs in as them here: Neon Functions connect as the
-- database owner.
do $$
declare
  name text;
begin
  foreach name in array array['anon', 'anonymous', 'authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = name) then
      execute format('create role %I nologin noinherit', name);
    end if;
  end loop;
  -- Like Supabase's, it bypasses row-level security (as the database owner
  -- the Functions connect as does), where the server lets us grant that.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    begin
      create role service_role nologin noinherit bypassrls;
    exception when insufficient_privilege then
      create role service_role nologin noinherit;
    end;
  end if;
end;
$$;

-- The tests act as these roles (the owner already has every right they have).
grant anon, service_role to current_user;

grant usage on schema public to anon, anonymous, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, anonymous, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;

-- The Supabase default privileges the migrations rely on (they revoke what a
-- role must not have).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Users -------------------------------------------------------------------------
create schema if not exists app;
grant usage on schema app to anon, anonymous, authenticated, service_role;

-- One row per MatIQ account. `id` is the UUID every table uses (from
-- Supabase for imported accounts); `clerk_id` is the Clerk user it belongs to.
create table if not exists app.users (
  id uuid primary key default gen_random_uuid(),
  clerk_id text unique,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  banned_until timestamptz
);
revoke all on app.users from public, anon, anonymous, authenticated;

-- Without a Clerk user yet (direct inserts by the backend and the tests), a
-- row answers to its own UUID. Clerk never issues a UUID as a user ID, so
-- such a row can't be reached with a real token.
create or replace function app.default_clerk_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.clerk_id := coalesce(new.clerk_id, new.id::text);
  return new;
end;
$$;

drop trigger if exists users_default_clerk_id on app.users;
create trigger users_default_clerk_id before insert on app.users
  for each row execute function app.default_clerk_id();

-- Addresses an account used, recorded by the functions (Supabase kept them
-- in auth.sessions and its sign-in log); moderation reads both.
create table if not exists app.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists sessions_user on app.sessions (user_id);
create index if not exists sessions_ip on app.sessions (ip);

create table if not exists app.audit_log_entries (
  id uuid primary key default gen_random_uuid(),
  payload json,
  ip_address varchar(64) not null default '',
  created_at timestamptz default now()
);

-- Two-factor is Clerk's; this stays empty and only keeps old queries valid.
create table if not exists app.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  friendly_name text,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  created_at timestamptz not null default now()
);

revoke all on app.sessions, app.audit_log_entries, app.mfa_factors from public, anon, anonymous, authenticated;

-- The request -------------------------------------------------------------------

-- Claims of the request's token (Clerk session token, verified by the Data
-- API). `aal` is what the migrations check for two-factor; Clerk reports
-- it as `fva` (minutes since each factor was verified, -1 when never).
-- Runs as the owner: API users can't use Neon's `auth` schema directly.
create or replace function app.jwt()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when claims ? 'aal' or jsonb_typeof(claims -> 'fva') is distinct from 'array' then claims
    else claims || jsonb_build_object('aal', case when (claims -> 'fva' ->> 1)::integer >= 0 then 'aal2' else 'aal1' end)
  end
  from (select coalesce(nullif(auth.session(), 'null'::jsonb), '{}'::jsonb) as claims) c;
$$;

-- Who is asking: a token's role claim when it has one, `authenticated` for a
-- signed-in user, `service_role` for the backend (Neon Functions connect as
-- the database owner, with no token), `anon` otherwise.
create or replace function app.role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.jwt() ->> 'role',
    case
      when auth.user_id() is not null then 'authenticated'
      when session_user = (select pg_catalog.pg_get_userbyid(d.datdba) from pg_catalog.pg_database d where d.datname = current_database())
        then 'service_role'
      else 'anon'
    end
  );
$$;

-- The MatIQ UUID of the request's user, or null without a signed-in user.
-- Neon's Data API has no per-request hook, so what Supabase's request hook
-- (public.check_request) did happens here, where every user-facing policy
-- and function asks who the user is:
--   * banned accounts and banned networks get `banned`;
--   * requests that change data (a method other than GET / HEAD) get
--     `age_check_required` until the age check is answered.
-- Two-factor needs no check: Clerk only issues a session token once every
-- factor the account has is verified.
create or replace function app.uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  subject text := auth.user_id();
  method text := coalesce(current_setting('request.method', true), '');
  found_id uuid;
begin
  if subject is null or subject = '' then
    return null;
  end if;
  select u.id into found_id from app.users u where u.clerk_id = subject;
  if found_id is null then
    return null;
  end if;
  if private.ip_is_banned(private.request_ips()) or private.is_banned(found_id) then
    raise exception using errcode = '42501', message = 'banned',
      hint = 'This account or network is banned from MatIQ.';
  end if;
  if method not in ('', 'GET', 'HEAD')
     and not exists (select 1 from private.age_checks a where a.user_id = found_id) then
    raise exception using errcode = '42501', message = 'age_check_required',
      hint = 'Enter your birth month and year first.';
  end if;
  return found_id;
end;
$$;

grant execute on function app.jwt(), app.role(), app.uid() to anon, anonymous, authenticated, service_role;

-- Storage -------------------------------------------------------------------------
-- Supabase Storage's tables, kept as the permission and metadata layer: the
-- `files` function asks the database (as the user) whether a path may be
-- written or read, using the same storage policies as before, then hands
-- out a presigned Neon Object Storage link.
create schema if not exists storage;
grant usage on schema storage to anon, anonymous, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default app.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1:array_length(parts, 1) - 1];
end;
$$;

create or replace function storage.filename(name text)
returns text
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[array_length(parts, 1)];
end;
$$;

grant execute on all functions in schema storage to anon, anonymous, authenticated, service_role;
