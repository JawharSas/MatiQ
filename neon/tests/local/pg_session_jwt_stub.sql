-- =============================================================================
-- Stand-in for Neon's pg_session_jwt extension (the Data API's JWT session),
-- for running the migrations and tests on a plain PostgreSQL server. It
-- behaves like the extension's PostgREST-compatible mode: the claims come
-- from `request.jwt.claims`, which the tests set the way the Data API does.
-- https://github.com/neondatabase/pg_session_jwt
-- =============================================================================

create schema auth;
grant usage on schema auth to public;

create function auth.session() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), 'null')::jsonb;
$$;

create function auth.jwt() returns jsonb
language sql stable as $$
  select auth.session();
$$;

create function auth.user_id() returns text
language sql stable as $$
  select case when jsonb_typeof(auth.session() -> 'sub') = 'string' then auth.session() ->> 'sub' end;
$$;

-- Like the extension: a UUID only when `sub` is one. MatIQ uses app.uid().
create function auth.uid() returns uuid
language plpgsql stable as $$
begin
  return auth.user_id()::uuid;
exception when others then
  return null;
end;
$$;

grant execute on all functions in schema auth to public;
