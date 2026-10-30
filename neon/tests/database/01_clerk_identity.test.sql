-- =============================================================================
-- Clerk accounts on Neon: app.uid(), register_user, two-factor from `fva`,
-- the backend role, recorded addresses and the Clerk sync queue.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- A Clerk session token as the Data API sees it.
create function pg_temp.as_clerk(sub text, claims jsonb default '{}', method text default 'GET') returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', (jsonb_build_object('sub', sub, 'sid', 'sess_1') || claims)::text, true);
  perform set_config('request.method', method, true);
  perform set_config('request.headers', '', true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- The functions' own connection: the database owner, no token.
create function pg_temp.as_backend() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.method', '', true);
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Signing up ------------------------------------------------------------------------
select pg_temp.as_clerk('user_new1');
select is(app.uid(), null, 'a Clerk user without a MatIQ account is nobody yet');
select ok(public.register_user('newfighter', 'New Fighter') is not null, 'the first sign-in creates the account');
select is(
  (select username::text from public.profiles where id = app.uid()), 'newfighter',
  'with the chosen username (the sign-up trigger made the profile)');
select is(
  (select max_video_seconds from public.user_entitlements where user_id = app.uid()), 480,
  'and the usual entitlements');
select is(public.register_user('other', 'Other'), app.uid(), 'signing in again keeps the same account');
select pg_temp.as_backend();
select is((select count(*)::int from app.users where clerk_id = 'user_new1'), 1, 'one account per Clerk user');

select pg_temp.as_clerk('user_new1', '{"role": "anon"}');
select is(app.role(), 'anon', 'a role claim is taken as it is');
select pg_temp.as_clerk('user_new1');
select is(app.role(), 'authenticated', 'a Clerk session is an authenticated user');
select pg_temp.as_backend();
select is(app.role(), 'service_role', 'the database owner without a token is the backend');

-- Writes need the age check -------------------------------------------------------------
select pg_temp.as_clerk('user_new1', '{}', 'POST');
select throws_ok($$select app.uid()$$, '42501', 'age_check_required', 'no API writes before the age check');
select pg_temp.as_backend();
select public.svc_record_age((select id from app.users where clerk_id = 'user_new1'), 1995, 6);
select pg_temp.as_clerk('user_new1', '{}', 'POST');
select ok(app.uid() is not null, 'writes are allowed after it');
select pg_temp.as_clerk('user_new1', '{}', 'GET');
select ok(app.uid() is not null, 'reads never needed it');
select pg_temp.as_backend();
insert into app.users (clerk_id) values ('user_no_age_check');
select pg_temp.as_clerk('user_no_age_check', '{}', 'POST');
select ok(public.register_user(null, null) is not null, 'a returning account without the age check can still sign in');

-- Two-factor from Clerk's fva claim -----------------------------------------------------------
select pg_temp.as_clerk('user_new1', '{"fva": [3, -1]}');
select is(app.jwt() ->> 'aal', 'aal1', 'one factor verified: aal1');
select pg_temp.as_clerk('user_new1', '{"fva": [3, 2]}');
select is(app.jwt() ->> 'aal', 'aal2', 'second factor verified: aal2');

-- Imported accounts ---------------------------------------------------------------------
select pg_temp.as_backend();
insert into app.users (id, email, raw_user_meta_data)
values ('d1111111-1111-4111-8111-111111111111', 'old@example.test', '{"username": "oldtimer"}');
select pg_temp.as_clerk('user_imported');
select is(app.uid(), null, 'before the import links it, the Clerk user has no account');
select pg_temp.as_backend();
select public.svc_link_clerk_user('d1111111-1111-4111-8111-111111111111', 'user_imported', 'old@example.test');
select pg_temp.as_clerk('user_imported');
select is(app.uid(), 'd1111111-1111-4111-8111-111111111111'::uuid, 'afterwards it is the same account as before');
select pg_temp.as_clerk('d1111111-1111-4111-8111-111111111111');
select is(app.uid(), null, 'the old UUID no longer works as a Clerk user ID');
select throws_ok($$select public.svc_link_clerk_user('d1111111-1111-4111-8111-111111111111', 'user_x', null)$$, '42501', null,
  'users cannot link accounts');

-- Addresses and bans -------------------------------------------------------------------------
select pg_temp.as_backend();
select public.svc_record_address('d1111111-1111-4111-8111-111111111111', '198.51.100.70');
select public.svc_record_address('d1111111-1111-4111-8111-111111111111', '198.51.100.70');
select public.svc_record_address('d1111111-1111-4111-8111-111111111111', 'not an address');
select is((select count(*)::int from app.sessions where user_id = 'd1111111-1111-4111-8111-111111111111'), 1,
  'an address is recorded once per account');

select public.svc_ban_user('d1111111-1111-4111-8111-111111111111', 'Spam', 'other');
select is((select action from private.clerk_sync where clerk_id = 'user_imported' order by id desc limit 1), 'ban',
  'a ban is queued for Clerk');
select pg_temp.as_clerk('user_imported');
select throws_ok($$select app.uid()$$, '42501', 'banned', 'and the account gets nothing from the API');
select pg_temp.as_backend();
-- What admin_unban_user does to the account row.
delete from private.bans where user_id = 'd1111111-1111-4111-8111-111111111111';
update app.users set banned_until = null where id = 'd1111111-1111-4111-8111-111111111111';
select is((select action from private.clerk_sync where clerk_id = 'user_imported' order by id desc limit 1), 'unban',
  'lifting it is queued too');
select public.svc_finish_clerk_sync(id) from private.clerk_sync where clerk_id = 'user_imported';
select is((select count(*)::int from private.clerk_sync where clerk_id = 'user_imported'), 0, 'done items leave the queue');

select * from finish();
rollback;
