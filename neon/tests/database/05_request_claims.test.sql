-- =============================================================================
-- The request's identity comes from the claims setting the Data API sets,
-- without loading pg_session_jwt: loading it inside a SECURITY DEFINER
-- function on a new connection dropped the claims, and the first request
-- looked signed out ("not signed in" right after sign-in).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

create function pg_temp.as_clerk(sub text, method text default 'POST') returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'sid', 'sess_1', 'role', 'authenticated')::text, true);
  perform set_config('request.method', method, true);
  perform set_config('request.headers', '', true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.signed_out() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.method', 'POST', true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

insert into app.users (clerk_id, email, raw_user_meta_data)
values ('user_claims', 'claims@example.test', '{"username": "claims_one", "display_name": "Claims One"}');
select public.svc_record_age(id, 1995, 6) from app.users where clerk_id = 'user_claims';
create temp table ids as select id from app.users where clerk_id = 'user_claims';
grant select on ids to authenticated;

-- As on a new connection where pg_session_jwt would drop the claims: the
-- extension must not be needed while the claims setting is there.
create or replace function auth.session() returns jsonb language plpgsql stable as $$
begin
  raise exception 'pg_session_jwt was used';
end;
$$;

select pg_temp.as_clerk('user_claims');
select is((select app.claims() ->> 'sub'), 'user_claims', 'app.claims() reads the claims the Data API set');
select is((select app.uid()), (select id from ids), 'app.uid() finds the account from them');
select is((select public.register_user()), (select id from ids), 'register_user opens the account without the extension');
select is((select app.role()), 'authenticated', 'app.role() comes from the claims');
select is((select app.jwt() ->> 'sid'), 'sess_1', 'app.jwt() returns the claims');

-- No claims setting (an anonymous request): the extension is asked.
select pg_temp.signed_out();
select throws_ok($$select app.claims()$$, 'P0001', 'pg_session_jwt was used', 'without the setting the extension is asked');

-- The extension's answer is used when the setting is empty.
select set_config('role', 'none', true);
create or replace function auth.session() returns jsonb language sql stable as $$
  select '{"sub": "user_claims"}'::jsonb;
$$;
select is((select app.claims() ->> 'sub'), 'user_claims', 'and its claims are used');
select set_config('role', 'none', true);
create or replace function auth.session() returns jsonb language sql stable as $$
  select 'null'::jsonb;
$$;
select is((select app.uid()), null::uuid, 'signed out: no user');
select throws_ok($$select public.register_user()$$, '42501', 'not signed in', 'and register_user refuses');

select * from finish();
rollback;
