-- =============================================================================
-- Moderation: word filter, strikes, bans (account and IP), profile pictures.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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

grant execute on all functions in schema pg_temp to authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1111111-1111-4111-8111-111111111111', 'troll@example.test', '{"username":"troll"}'),
  ('e2222222-2222-4222-8222-222222222222', 'friend@example.test', '{"username":"friend"}'),
  ('e3333333-3333-4333-8333-333333333333', 'owner8@example.test', '{"username":"owner8"}'),
  ('e4444444-4444-4444-8444-444444444444', 'poster@example.test', '{"username":"poster"}'),
  ('e5555555-5555-4555-8555-555555555555', 'kike@example.test', '{"username":"kike","display_name":"porn star"}');
insert into private.age_checks (user_id, birth_month) select id, date '1990-01-01' from auth.users on conflict do nothing;
update public.user_entitlements set role = 'owner' where user_id = 'e3333333-3333-4333-8333-333333333333';
update public.profiles set visibility = 'public'
  where id in ('e1111111-1111-4111-8111-111111111111', 'e4444444-4444-4444-8444-444444444444');
insert into auth.sessions (user_id, ip) values
  ('e1111111-1111-4111-8111-111111111111', '203.0.113.7'),
  ('e1111111-1111-4111-8111-111111111111', '2001:db8:1:2::1');
-- The auth log keeps addresses as text; one that isn't an address must not break a ban.
insert into auth.audit_log_entries (payload, ip_address)
  values (json_build_object('actor_id', 'e1111111-1111-4111-8111-111111111111'), 'unknown');

-- Word filter ------------------------------------------------------------------------
select is(private.text_violation('nice porn'), 'sexual', 'blocked words are found');
select is(private.text_violation('P 0 R N'), 'sexual', 'spelled out and with swapped characters');
select is(private.text_violation('p.o.r.n'), 'sexual', 'with dots between the letters');
select is(private.text_violation('poooorn'), 'sexual', 'with stretched letters');
select is(private.text_violation('just kill yourself'), 'harassment', 'phrases');
select is(private.text_violation('masturbating'), 'sexual', 'word endings for terms with *');
select is(private.text_violation('Rear naked choke from the mount, then a cocktail'), null, 'training talk is fine');
select is(private.text_violation('Analysis of the back take and the arm triangle'), null, 'words that merely contain a term are fine');

select pg_temp.as_user('e5555555-5555-4555-8555-555555555555');
select is((select username::text from public.profiles where id = auth.uid()), 'athlete_e55555555555', 'a sign-up name that breaks the filter is replaced');
select is((select display_name from public.profiles where id = auth.uid()), 'athlete_e55555555555', 'and so is the display name');
select throws_ok($$update public.profiles set bio = 'dm me for nudes' where id = auth.uid()$$, '22023', 'content_not_allowed', 'bios are filtered');
select throws_ok(
  $$insert into public.matches (id, discipline, variant, source, duration_ms, title)
    values ('eaaaaaaa-0000-4000-8000-000000000005', 'bjj', 'ibjjf', 'upload', 60000, 'faggot')$$,
  '22023', 'content_not_allowed', 'match titles are filtered');

-- Posts: hidden and a strike; three strikes ban -------------------------------------
reset role;
insert into private.moderation_strikes (user_id, kind, detail, created_at)
  values ('e2222222-2222-4222-8222-222222222222', 'post:sexual', 'old', now() - interval '100 days');
select pg_temp.as_user('e4444444-4444-4444-8444-444444444444');
insert into public.posts (id, body) values ('ebbbbbbb-0000-4000-8000-000000000001', 'Great open mat today');
insert into public.posts (id, body) values ('ebbbbbbb-0000-4000-8000-000000000002', 'you are a retard');
select is((select moderation from public.posts where id = 'ebbbbbbb-0000-4000-8000-000000000002'), 'blocked', 'a post that breaks the filter is held back');
select is((select count(*)::int from public.posts where author_id = auth.uid()), 2, 'its author still sees it');
select pg_temp.as_user('e2222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.posts where author_id = 'e4444444-4444-4444-8444-444444444444'), 1, 'nobody else does');
reset role;
select is((select count(*)::int from private.moderation_strikes where user_id = 'e4444444-4444-4444-8444-444444444444'), 1, 'and it counts as a strike');
select is((select count(*)::int from private.moderation_strikes where user_id = 'e2222222-2222-4222-8222-222222222222'), 0, 'strikes are deleted after 90 days');

select pg_temp.as_user('e1111111-1111-4111-8111-111111111111');
insert into public.posts (id, body) values ('ebbbbbbb-0000-4000-8000-000000000010', 'Drilling guard retention');
insert into public.posts (body) values ('porn'), ('n i g g e r'), ('sieg heil');
reset role;
select ok(private.is_banned('e1111111-1111-4111-8111-111111111111'), 'three strikes in 30 days ban the account');
select is((select source from private.bans where user_id = 'e1111111-1111-4111-8111-111111111111'), 'automatic', 'automatically');
select ok((select banned_until > now() + interval '50 years' from auth.users where id = 'e1111111-1111-4111-8111-111111111111'), 'Supabase Auth refuses its sign-ins');
select is((select count(*)::int from auth.sessions where user_id = 'e1111111-1111-4111-8111-111111111111'), 0, 'its sessions end');
select ok((select is_suspended from public.user_entitlements where user_id = 'e1111111-1111-4111-8111-111111111111'), 'and it is suspended');

-- Banned accounts disappear ---------------------------------------------------------
select pg_temp.as_user('e2222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.posts where author_id = 'e1111111-1111-4111-8111-111111111111'), 0, 'their posts are hidden, even the clean ones');
select is((select count(*)::int from public.profiles where id = 'e1111111-1111-4111-8111-111111111111'), 0, 'their profile is hidden');
select is((select count(*)::int from public.get_profile('e1111111-1111-4111-8111-111111111111')), 0, 'and their profile page');

-- IP bans ---------------------------------------------------------------------------------
reset role;
select is((select count(*)::int from private.banned_ips where user_id = 'e1111111-1111-4111-8111-111111111111'), 2, 'the addresses the account used are blocked');
select is(
  (select count(*)::int from private.banned_ips where ip_hash like '%203.0.113%' or ip_hash !~ '^[0-9a-f]{64}$'),
  0, 'only one-way fingerprints are stored, never the addresses');

select pg_temp.as_user('e2222222-2222-4222-8222-222222222222');
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.1, 203.0.113.7"}', true);
select throws_ok($$select public.check_request()$$, '42501', 'banned', 'any request from a banned address is refused, even for another account');
select set_config('request.headers', '{"cf-connecting-ip":"2001:db8:1:2:abcd::9"}', true);
select throws_ok($$select public.check_request()$$, '42501', 'banned', 'IPv6 is blocked per /64');
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.1"}', true);
select lives_ok($$select public.check_request()$$, 'other addresses are fine');
select pg_temp.as_user('e1111111-1111-4111-8111-111111111111');
select throws_ok($$select public.check_request()$$, '42501', 'banned', 'a banned account is refused from any address');

-- Owner actions -----------------------------------------------------------------------
select pg_temp.as_user('e2222222-2222-4222-8222-222222222222');
select throws_ok($$select public.admin_ban_user('e4444444-4444-4444-8444-444444444444', 'spam')$$, '42501', null, 'only the owner can ban');
select throws_ok($$select public.svc_ban_user('e4444444-4444-4444-8444-444444444444', 'x', 'other')$$, '42501', null, 'users cannot call svc_ban_user');
select pg_temp.as_user('e3333333-3333-4333-8333-333333333333');
select throws_ok($$select public.admin_ban_user('e4444444-4444-4444-8444-444444444444', '  ')$$, '22023', null, 'a ban needs a reason');
select lives_ok($$select public.admin_add_blocked_term('sandbagger', 'harassment')$$, 'the owner adds a word to the filter');
select is(private.text_violation('what a sandbagger'), 'harassment', 'which applies at once');
reset role;
insert into auth.sessions (user_id, ip) values ('e5555555-5555-4555-8555-555555555555', '203.0.113.7');
update public.user_entitlements set is_suspended = true, suspended_reason = 'Chargeback'
  where user_id = 'e5555555-5555-4555-8555-555555555555';
select pg_temp.as_user('e3333333-3333-4333-8333-333333333333');
select lives_ok($$select public.admin_ban_user('e5555555-5555-4555-8555-555555555555', 'Ban evasion')$$, 'a second account on that network is banned');
select lives_ok($$select public.admin_unban_user('e1111111-1111-4111-8111-111111111111')$$, 'the owner lifts a ban');
reset role;
select ok(not private.is_banned('e1111111-1111-4111-8111-111111111111') and (select banned_until is null from auth.users where id = 'e1111111-1111-4111-8111-111111111111'), 'the account can sign in again');
select is((select count(*)::int from private.banned_ips where user_id = 'e1111111-1111-4111-8111-111111111111'), 0, 'and its addresses are unblocked');
select pg_temp.as_user('e2222222-2222-4222-8222-222222222222');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.7"}', true);
select throws_ok($$select public.check_request()$$, '42501', 'banned', 'a network another banned account used stays blocked');
-- The owner below isn't on that network (on Neon, app.uid() applies network
-- bans to API requests, as the request hook does).
select set_config('request.headers', '', true);
select pg_temp.as_user('e3333333-3333-4333-8333-333333333333');
select lives_ok($$select public.admin_unban_user('e5555555-5555-4555-8555-555555555555')$$, 'the second ban is lifted');
reset role;
select is(
  (select suspended_reason from public.user_entitlements where user_id = 'e5555555-5555-4555-8555-555555555555' and is_suspended),
  'Chargeback', 'a suspension from before the ban stays');
select pg_temp.as_service();
select throws_ok($$select public.svc_ban_user('e3333333-3333-4333-8333-333333333333', 'x', 'other')$$, '22023', null, 'the owner account cannot be banned');

-- Profile pictures ------------------------------------------------------------------
select pg_temp.as_user('e2222222-2222-4222-8222-222222222222');
select throws_ok(
  $$update public.profiles set avatar_path = 'e2222222-2222-4222-8222-222222222222/x.jpg' where id = auth.uid()$$,
  '42501', 'avatar_requires_review', 'users cannot publish a picture themselves');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'e2222222-2222-4222-8222-222222222222/pending.jpg')$$,
  'they upload it for review');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'e2222222-2222-4222-8222-222222222222/other.jpg')$$,
  '42501', null, 'under that one name only');
select pg_temp.as_user('e4444444-4444-4444-8444-444444444444');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars'), 0, 'nobody else sees a picture under review');

select * from finish();
rollback;
