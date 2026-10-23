-- =============================================================================
-- Docker-free approximation of the Supabase platform objects the MatIQ
-- migrations depend on (roles, auth, storage, default privileges) plus a
-- minimal pgTAP-compatible shim. Used by scripts/test-db-local.sh to run the
-- migrations and the RLS test suite against a plain PostgreSQL 15+ server.
--
-- `supabase test db` (real Supabase stack + real pgTAP) remains the source of
-- truth; this harness exists so CI and contributors without Docker can still
-- exercise every policy.
-- =============================================================================

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase's default privileges on objects created by `postgres` in public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- auth --------------------------------------------------------------------------
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create function auth.role() returns text
language sql stable as $$
  select auth.jwt() ->> 'role';
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;

-- storage -----------------------------------------------------------------------
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz default now(),
  metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;

create function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1:array_length(parts, 1) - 1];
end;
$$;

create function storage.filename(name text) returns text
language plpgsql immutable as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[array_length(parts, 1)];
end;
$$;

grant execute on all functions in schema storage to anon, authenticated, service_role;

-- Realtime publication (exists on every Supabase project).
set client_min_messages = error;
create publication supabase_realtime;
reset client_min_messages;

-- Minimal pgTAP shim -------------------------------------------------------------
-- Implements the subset used by supabase/tests/database/*.test.sql. Failures
-- raise immediately, so a failing assertion aborts the run with its message.
create schema tap;
grant usage on schema tap to public;

create table tap.state (planned integer, ran integer not null default 0);
grant all on tap.state to public;

create function public.plan(n integer) returns text language plpgsql as $$
begin
  delete from tap.state;
  insert into tap.state (planned) values (n);
  return '1..' || n;
end;
$$;

create function tap.record(passed boolean, description text) returns text language plpgsql as $$
declare
  n integer;
begin
  update tap.state set ran = ran + 1 returning ran into n;
  if not coalesce(passed, false) then
    raise exception 'not ok % - %', n, description;
  end if;
  return 'ok ' || n || ' - ' || description;
end;
$$;

create function public.ok(passed boolean, description text default '') returns text
language sql as $$ select tap.record(passed, description); $$;

create function public.is(have anyelement, want anyelement, description text default '') returns text
language plpgsql as $$
begin
  if have is distinct from want then
    raise exception 'not ok - % (have: %, want: %)', description, have, want;
  end if;
  return tap.record(true, description);
end;
$$;

create function public.throws_ok(query text, errcode text, errmsg text, description text) returns text
language plpgsql as $$
begin
  execute query;
  raise exception 'not ok - % (expected error %, query succeeded)', description, errcode;
exception
  when others then
    if sqlerrm like 'not ok - %' then
      raise;
    end if;
    if (errcode is not null and sqlstate <> errcode) or (errmsg is not null and sqlerrm <> errmsg) then
      raise exception 'not ok - % (have error % "%", want % "%")', description, sqlstate, sqlerrm, errcode, coalesce(errmsg, '*');
    end if;
    return tap.record(true, description);
end;
$$;

create function public.lives_ok(query text, description text) returns text
language plpgsql as $$
begin
  execute query;
  return tap.record(true, description);
exception
  when others then
    raise exception 'not ok - % (unexpected error % "%")', description, sqlstate, sqlerrm;
end;
$$;

create function public.finish() returns setof text language plpgsql as $$
declare
  s tap.state;
begin
  select * into s from tap.state;
  if s.planned is distinct from s.ran then
    raise exception 'planned % tests but ran %', s.planned, s.ran;
  end if;
  return next 'all ' || s.ran || ' tests passed';
end;
$$;

grant execute on function public.plan(integer), public.ok(boolean, text), public.is(anyelement, anyelement, text),
  public.throws_ok(text, text, text, text), public.lives_ok(text, text), public.finish(), tap.record(boolean, text)
to public;
