-- =============================================================================
-- Network bans only for private networks: never shared or non-public ones.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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
  ('f1111111-1111-4111-8111-111111111111', 'banme@example.test', '{"username":"banme"}'),
  ('f2222222-2222-4222-8222-222222222222', 'gymmate@example.test', '{"username":"gymmate"}'),
  ('f3333333-3333-4333-8333-333333333333', 'owner9@example.test', '{"username":"owner9"}'),
  ('f4444444-4444-4444-8444-444444444444', 'signin@example.test', '{"username":"signin"}');
insert into private.age_checks (user_id, birth_month) select id, date '1990-01-01' from auth.users on conflict do nothing;
update public.user_entitlements set role = 'owner' where user_id = 'f3333333-3333-4333-8333-333333333333';

insert into auth.sessions (user_id, ip) values
  ('f1111111-1111-4111-8111-111111111111', '198.51.100.20'),      -- the gym: a friend uses it too
  ('f2222222-2222-4222-8222-222222222222', '198.51.100.20'),
  ('f1111111-1111-4111-8111-111111111111', '192.0.2.44'),         -- home: only this account
  ('f1111111-1111-4111-8111-111111111111', '2001:db8:aa:bb::5'),  -- home IPv6
  ('f1111111-1111-4111-8111-111111111111', '10.1.2.3'),           -- private range
  ('f1111111-1111-4111-8111-111111111111', '100.64.5.6'),         -- carrier-grade NAT
  ('f1111111-1111-4111-8111-111111111111', '203.0.113.50');       -- someone signed in here recently
-- Sessions nobody used for 60 days don't count: not as this account's network
-- (the address may belong to someone else now), not as a sign that home is shared.
insert into auth.sessions (user_id, ip, created_at, updated_at) values
  ('f1111111-1111-4111-8111-111111111111', '198.51.100.99', now() - interval '90 days', now() - interval '60 days'),
  ('f4444444-4444-4444-8444-444444444444', '192.0.2.44', now() - interval '90 days', now() - interval '60 days');
insert into auth.audit_log_entries (payload, ip_address, created_at) values
  (json_build_object('actor_id', 'f4444444-4444-4444-8444-444444444444'), '203.0.113.50', now() - interval '2 days'),
  -- Too long ago to count: home stays private.
  (json_build_object('actor_id', 'f4444444-4444-4444-8444-444444444444'), '192.0.2.44', now() - interval '60 days'),
  (json_build_object('actor_id', 'not-a-uuid'), '192.0.2.44', now());

select ok(not private.is_public_address('10.0.0.1') and not private.is_public_address('100.64.0.1') and not private.is_public_address('192.168.1.1'),
  'private and carrier-grade NAT addresses are not public');
select ok(not private.is_public_address('fd00::1') and not private.is_public_address('fe80::1') and not private.is_public_address('64:ff9b::1'),
  'nor are IPv6 local, link-local and NAT64 ones');
select ok(private.is_public_address('8.8.8.8') and private.is_public_address('2001:4860::1'), 'public addresses are');

select pg_temp.as_service();
select lives_ok($$select public.svc_ban_user('f1111111-1111-4111-8111-111111111111', 'Sexual content', 'sexual_content')$$, 'the account is banned');
reset role;

select is((select count(*)::int from private.banned_ips where user_id = 'f1111111-1111-4111-8111-111111111111'), 2,
  'only the two home networks are blocked');
select is((select networks_blocked from private.bans where user_id = 'f1111111-1111-4111-8111-111111111111'), 2, 'the ban records them');
select is((select networks_shared from private.bans where user_id = 'f1111111-1111-4111-8111-111111111111'), 4,
  'and the four shared or non-public networks it skipped');

select pg_temp.as_user('f2222222-2222-4222-8222-222222222222');
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.20"}', true);
select lives_ok($$select public.check_request()$$, 'the gym is not blocked: someone else uses it');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.50"}', true);
select lives_ok($$select public.check_request()$$, 'nor a network someone else signed in from');
select set_config('request.headers', '{"x-forwarded-for":"10.1.2.3"}', true);
select lives_ok($$select public.check_request()$$, 'nor a private address');
select set_config('request.headers', '{"x-forwarded-for":"192.0.2.44"}', true);
select throws_ok($$select public.check_request()$$, '42501', 'banned', 'the home network is blocked for a new account');
select set_config('request.headers', '{"cf-connecting-ip":"2001:db8:aa:bb::77"}', true);
select throws_ok($$select public.check_request()$$, '42501', 'banned', 'and its IPv6 /64');

select pg_temp.as_user('f3333333-3333-4333-8333-333333333333');
select is(
  (select networks_blocked || '/' || networks_shared from public.admin_list_bans() where user_id = 'f1111111-1111-4111-8111-111111111111'),
  '2/4', 'the owner panel shows both counts');
reset role;
select is(
  (select new_value ->> 'networks_shared' from private.admin_audit_log where target_user_id = 'f1111111-1111-4111-8111-111111111111' and action = 'ban'),
  '4', 'and so does the audit log');

select * from finish();
rollback;
