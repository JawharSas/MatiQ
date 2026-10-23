-- =============================================================================
-- MatIQ: foundation (schemas, extensions, enums, baseline privileges)
-- =============================================================================
-- Security model in one paragraph:
--   * Clients only ever hold the publishable "anon" key + a user JWT. Every
--     table in `public` has Row Level Security enabled; nothing is readable by
--     the `anon` role.
--   * Sensitive data (encrypted API keys, rate-limit counters, admin audit log)
--     lives in the `private` schema, which is NOT exposed through the Data API.
--   * Privileged operations are SECURITY DEFINER functions with an empty
--     search_path and explicit authorization checks. Functions meant only for
--     Edge Functions are prefixed `svc_` and executable by `service_role` only.
-- =============================================================================

create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
-- `authenticated` needs USAGE so RLS policies can call private helper
-- functions. The schema is not exposed via PostgREST, so it is not reachable
-- from the API.
grant usage on schema private to authenticated, service_role;

-- Supabase grants broad default privileges to anon/authenticated on new
-- objects in `public`. MatIQ has no anonymous features, so remove anon's
-- defaults and grant per object instead.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
-- Functions are not executable by PUBLIC unless explicitly granted.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

create type public.app_role as enum ('user', 'owner');
create type public.account_visibility as enum ('public', 'private');
create type public.discipline as enum ('bjj', 'wrestling', 'mma');
create type public.match_source as enum ('live', 'upload');
create type public.match_status as enum ('draft', 'queued', 'processing', 'completed', 'failed');
create type public.friendship_status as enum ('pending', 'accepted');
create type public.usage_status as enum ('reserved', 'committed', 'refunded');

-- Generic updated_at trigger.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Safe text -> uuid cast for storage paths (returns null instead of raising).
create or replace function private.try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- True when a user-supplied string contains control characters (other than
-- newline/tab when allowed) or Unicode bidi overrides used for spoofing.
create or replace function private.has_unsafe_chars(value text, allow_newlines boolean default false)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    (case when allow_newlines then regexp_replace(value, '[\n\t]', '', 'g') else value end) ~ '[[:cntrl:]]'
    or value ~ '[‪-‮⁦-⁩‎‏]';
$$;

grant execute on function private.try_uuid(text) to authenticated, service_role;
grant execute on function private.has_unsafe_chars(text, boolean) to authenticated, service_role;
