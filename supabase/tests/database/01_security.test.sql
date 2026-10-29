-- =============================================================================
-- MatIQ database security tests (pgTAP).
--   supabase test db                 -> real Supabase stack + pgTAP
--   ./scripts/test-db-local.sh       -> plain Postgres + stub (no Docker)
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(58);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create function pg_temp.as_user(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Fixtures: alice (private) is friends with bob (private); carol is a stranger;
-- dave is public; olivia is the owner.
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.test', '{"username":"alice","display_name":"Alice"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.test', '{"username":"bob","role":"owner","is_unlimited":true}'),
  ('33333333-3333-4333-8333-333333333333', 'carol@example.test', '{"username":"no spaces allowed!"}'),
  ('44444444-4444-4444-8444-444444444444', 'dave@example.test', '{"username":"dave"}'),
  ('55555555-5555-4555-8555-555555555555', 'olivia@example.test', '{"username":"olivia"}');
-- Every test user has answered the age check (06 covers the check itself).
insert into private.age_checks (user_id, birth_month) select id, date '1990-01-01' from auth.users on conflict do nothing;

update public.user_entitlements set role = 'owner' where user_id = '55555555-5555-4555-8555-555555555555';
update public.profiles set visibility = 'public' where id = '44444444-4444-4444-8444-444444444444';
insert into public.friendships (user_low, user_high, requested_by, status) values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'accepted');

-- Signup trigger -------------------------------------------------------------------
select is(
  (select count(*)::int from public.profiles), 5, 'signup trigger creates a profile per user');
select is(
  (select role::text from public.user_entitlements where user_id = '22222222-2222-4222-8222-222222222222'),
  'user', 'role injected through signup metadata is ignored');
select is(
  (select is_unlimited from public.user_entitlements where user_id = '22222222-2222-4222-8222-222222222222'),
  false, 'is_unlimited injected through signup metadata is ignored');
select ok(
  (select username::text from public.profiles where id = '33333333-3333-4333-8333-333333333333') like 'athlete_%',
  'invalid requested username falls back to a generated one');
select is(
  (select visibility::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'private', 'accounts are private by default');

-- Matches and posts as their owners ----------------------------------------------
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'bjj', 'ibjjf', 'live', 300000);
select is(
  (select status::text from public.matches where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'draft', 'new matches start as draft');
select throws_ok(
  $$insert into public.matches (discipline, variant, source, duration_ms, status) values ('bjj', 'ibjjf', 'live', 300000, 'completed')$$,
  '42501', null, 'clients cannot set match status');
select throws_ok(
  $$update public.matches set has_video = true where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null, 'clients cannot write server-owned match columns');
select lives_ok(
  $$update public.matches set duration_ms = 240000 where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'draft match duration can be finalised by its owner');
select throws_ok(
  $$insert into public.posts (match_id, body) values ('aaaaaaaa-0000-4000-8000-000000000001', 'too early')$$,
  '42501', null, 'cannot share a match before analysis completes');

select pg_temp.as_service();
select public.svc_save_analysis(
  'aaaaaaaa-0000-4000-8000-000000000001', 'bjj-2026.1', 'test-model',
  '[]'::jsonb, '{"result":{"winner":"A"},"totals":{}}'::jsonb, null);

select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$update public.matches set duration_ms = 1000 where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null, 'duration is frozen once analysis has run');
insert into public.posts (id, match_id, body)
  values ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Good roll today');

select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
insert into public.posts (id, body) values ('bbbbbbbb-0000-4000-8000-000000000002', 'Public post from dave');
insert into public.posts (id, body, friends_only) values ('bbbbbbbb-0000-4000-8000-000000000003', 'Friends-only post from dave', true);

-- Privacy: private account -------------------------------------------------------------
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::int from public.posts where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  1, 'a friend sees a private account''s post');
select is(
  (select count(*)::int from public.matches where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'a friend sees a match shared in a visible post');
select is(
  (select count(*)::int from public.match_analyses where match_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'a friend sees the analysis of a shared match');

select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::int from public.posts where author_id = '11111111-1111-4111-8111-111111111111'),
  0, 'a stranger cannot see a private account''s posts');
select is(
  (select count(*)::int from public.matches where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0, 'a stranger cannot see a private account''s match');
select is(
  (select count(*)::int from public.match_analyses),
  0, 'a stranger cannot see a private account''s analysis');
select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  1, 'a stranger can still see the profile card (needed for friend requests)');
select is(
  (select can_view_content from public.get_profile('11111111-1111-4111-8111-111111111111')),
  false, 'get_profile reports that content is hidden');

-- Privacy: public account --------------------------------------------------------------
select is(
  (select count(*)::int from public.posts where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  1, 'anyone signed in sees a public account''s public post');
select is(
  (select count(*)::int from public.posts where id = 'bbbbbbbb-0000-4000-8000-000000000003'),
  0, 'friends-only posts of a public account stay hidden from strangers');
select is(
  (select array_agg(post_id order by created_at)::text from public.get_feed()),
  '{bbbbbbbb-0000-4000-8000-000000000002}', 'feed only returns posts the caller may see');

-- Anonymous access --------------------------------------------------------------------
select pg_temp.as_anon();
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select * from public.get_feed()$$, '42501', null, 'anon cannot call the feed');

-- Blocking -----------------------------------------------------------------------------
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
insert into public.blocks (blocked_id) values ('44444444-4444-4444-8444-444444444444');
select is(
  (select count(*)::int from public.posts where author_id = '44444444-4444-4444-8444-444444444444'),
  0, 'blocking hides the blocked user''s public posts');
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select is(
  (select count(*)::int from public.profiles where id = '33333333-3333-4333-8333-333333333333'),
  0, 'the blocked user cannot see the blocker''s profile');
select throws_ok(
  $$select public.send_friend_request('33333333-3333-4333-8333-333333333333')$$,
  'P0002', 'user not found', 'blocked users cannot send friend requests (indistinguishable from not found)');

-- Friend requests ----------------------------------------------------------------------
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select is(
  public.send_friend_request('11111111-1111-4111-8111-111111111111')::text,
  'pending', 'sending a friend request creates a pending request');
select is(
  (select count(*)::int from public.posts where author_id = '11111111-1111-4111-8111-111111111111'),
  0, 'a pending request grants no access');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select is(
  public.respond_friend_request('33333333-3333-4333-8333-333333333333', true),
  true, 'the recipient can accept the request');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::int from public.posts where author_id = '11111111-1111-4111-8111-111111111111'),
  1, 'accepted friends see private content');
select throws_ok(
  $$insert into public.friendships (user_low, user_high, requested_by) values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111')$$,
  '42501', null, 'friendships cannot be forged with direct inserts');

-- Entitlements are not client-writable ------------------------------------------------
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$update public.user_entitlements set is_unlimited = true where user_id = auth.uid()$$,
  '42501', null, 'users cannot grant themselves unlimited access');
select throws_ok(
  $$update public.user_entitlements set role = 'owner' where user_id = auth.uid()$$,
  '42501', null, 'users cannot promote themselves to owner');
select is(
  (select count(*)::int from public.user_entitlements), 1, 'users only see their own entitlements');
select throws_ok(
  $$insert into public.match_analyses (match_id, owner_id, ruleset_version, model, events, scorecard) values ('aaaaaaaa-0000-4000-8000-000000000001', auth.uid(), 'x', 'x', '[]', '{}')$$,
  '42501', null, 'users cannot forge analyses');
select throws_ok(
  $$select * from public.svc_reserve_analysis(auth.uid(), null, 'platform')$$,
  '42501', null, 'service-only RPCs are not callable by users');
select throws_ok(
  $$update public.profiles set display_name = 'Evil' || chr(8238) || 'txt' where id = auth.uid()$$,
  '23514', null, 'bidi override characters are rejected in display names');

-- Owner panel ----------------------------------------------------------------------
select throws_ok(
  $$select public.admin_set_unlimited('33333333-3333-4333-8333-333333333333', true, 'nope')$$,
  '42501', 'not authorized', 'non-owners cannot use the owner panel');
select throws_ok(
  $$select * from public.admin_search_users('')$$,
  '42501', 'not authorized', 'non-owners cannot search users');

select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select is(
  public.am_i_owner(), true, 'owner is recognised');
select ok(
  (select count(*) from public.admin_search_users('ali')) = 1, 'owner can search users by username prefix');
select is(
  (select email from public.admin_search_users('carol@')), 'carol@example.test', 'owner can search users by email');
select is(
  (public.admin_set_unlimited('33333333-3333-4333-8333-333333333333', true, 'beta tester')).is_unlimited,
  true, 'owner can grant unlimited access');
select is(
  (select count(*)::int from public.admin_audit_log() where action = 'set_unlimited'),
  1, 'owner actions are audited');
select throws_ok(
  $$select public.admin_update_entitlements('55555555-5555-4555-8555-555555555555', p_is_suspended => true)$$,
  '42501', null, 'owners cannot be suspended');

select pg_temp.as_admin();
update private.app_config set owner_requires_mfa = true;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555', 'aal1');
select is(public.am_i_owner(), false, 'owner panel requires MFA when enabled');
select pg_temp.as_user('55555555-5555-4555-8555-555555555555', 'aal2');
select is(public.am_i_owner(), true, 'MFA-verified owner session is accepted');
select pg_temp.as_admin();
update private.app_config set owner_requires_mfa = false;
select throws_ok(
  $$update private.admin_audit_log set reason = 'tampered'$$,
  'P0001', 'admin_audit_log is append-only', 'audit log is append-only');

-- Usage limits -----------------------------------------------------------------------
update public.user_entitlements set monthly_analysis_limit = 2 where user_id = '44444444-4444-4444-8444-444444444444';
select pg_temp.as_service();
select is(
  (select allowed from public.svc_reserve_analysis('44444444-4444-4444-8444-444444444444', null, 'platform')),
  true, 'first analysis is within quota');
select is(
  (select allowed from public.svc_reserve_analysis('44444444-4444-4444-8444-444444444444', null, 'platform')),
  true, 'second analysis is within quota');
select is(
  (select reason from public.svc_reserve_analysis('44444444-4444-4444-8444-444444444444', null, 'platform')),
  'quota_exceeded', 'third analysis exceeds the monthly limit');
select is(
  (select allowed from public.svc_reserve_analysis('44444444-4444-4444-8444-444444444444', null, 'byok')),
  true, 'bring-your-own-key analyses do not consume platform quota');
select public.svc_settle_usage(
  (select id from public.usage_ledger where user_id = '44444444-4444-4444-8444-444444444444' and key_source = 'platform' order by created_at limit 1),
  false);
select is(
  (select allowed from public.svc_reserve_analysis('44444444-4444-4444-8444-444444444444', null, 'platform')),
  true, 'refunded reservations free quota again');
select is(
  (select bool_and(r.allowed)
     from generate_series(1, 15) as g
     cross join lateral public.svc_reserve_analysis('33333333-3333-4333-8333-333333333333', null, 'platform') as r),
  true, 'unlimited users bypass the monthly cap');

-- Storage --------------------------------------------------------------------------
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('match-frames', '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-000000000001/1000.jpg')$$,
  'owners can upload frames into their match folder');
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('match-frames', '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-000000000001/2000.jpg')$$,
  '42501', null, 'users cannot write into another user''s folder');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'match-frames'),
  0, 'users cannot read another user''s frames');

select * from finish();
rollback;
