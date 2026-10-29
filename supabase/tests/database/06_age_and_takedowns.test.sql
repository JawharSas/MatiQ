-- =============================================================================
-- Age check (COPPA) and copyright takedowns (DMCA).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

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
  ('b1111111-1111-4111-8111-111111111111', 'adult@example.test', '{"username":"adult"}'),
  ('b2222222-2222-4222-8222-222222222222', 'teen@example.test', '{"username":"teen"}'),
  ('b3333333-3333-4333-8333-333333333333', 'owner6@example.test', '{"username":"owner6"}');
update public.user_entitlements set role = 'owner' where user_id = 'b3333333-3333-4333-8333-333333333333';

-- Minimum age, month precision ---------------------------------------------------------
select ok(private.meets_minimum_age(2013, 9, '2026-10-15'), 'the 13th birthday month has passed: allowed');
select ok(not private.meets_minimum_age(2013, 10, '2026-10-15'), 'in the month of the 13th birthday: not yet');
select ok(not private.meets_minimum_age(2013, 11, '2026-10-15'), 'turns 13 next month: not allowed');
select ok(private.meets_minimum_age(1990, 1, '2026-10-15'), 'adults are allowed');

-- Recording (service role only) ------------------------------------------------------
select pg_temp.as_user('b1111111-1111-4111-8111-111111111111');
select throws_ok(
  $$select public.svc_record_age('b1111111-1111-4111-8111-111111111111', 1990, 5)$$,
  '42501', null, 'users cannot call svc_record_age directly');
select throws_ok($$select * from private.age_checks$$, '42501', null, 'the age checks table is not readable by users');
select is(public.my_age_check(), false, 'no age check yet');

select pg_temp.as_service();
select is(public.svc_record_age('b1111111-1111-4111-8111-111111111111', 1990, 5), 'ok', 'an adult birth month is recorded');
select is(
  public.svc_record_age('b2222222-2222-4222-8222-222222222222', extract(year from current_date)::integer - 10, 1),
  'under_minimum_age', 'a child under 13 is reported');
reset role;
select is(
  (select count(*)::int from private.age_checks where user_id = 'b2222222-2222-4222-8222-222222222222'),
  0, 'nothing is stored for a child under 13');
select pg_temp.as_service();
select throws_ok(
  $$select public.svc_record_age('b1111111-1111-4111-8111-111111111111', 1990, 13)$$,
  '22023', null, 'month 13 is rejected');
select throws_ok(
  format('select public.svc_record_age(%L, %s, 12)', 'b1111111-1111-4111-8111-111111111111', extract(year from current_date)::integer + 1),
  '22023', null, 'a birth month in the future is rejected');
select is(public.svc_record_age('b1111111-1111-4111-8111-111111111111', 2001, 1), 'ok', 'a second answer is accepted');
reset role;
select is(
  (select birth_month from private.age_checks where user_id = 'b1111111-1111-4111-8111-111111111111'),
  '1990-05-01'::date, 'but the first recorded date is kept');
select pg_temp.as_service();
select is(
  (select birth_month from public.svc_export_age_check('b1111111-1111-4111-8111-111111111111')),
  '1990-05-01'::date, 'the export includes the recorded month');

select pg_temp.as_user('b1111111-1111-4111-8111-111111111111');
select is(public.my_age_check(), true, 'the user sees that the check is done');
select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select is(public.my_age_check(), false, 'another user does not');

-- Nothing can be created before the age check -----------------------------------------
select is(private.age_checked(), false, 'a user without an age check is not cleared');
select throws_ok(
  $$insert into public.matches (id, discipline, variant, source, duration_ms)
    values ('baaaaaaa-0000-4000-8000-000000000002', 'bjj', 'ibjjf', 'upload', 60000)$$,
  '42501', null, 'no matches before the age check');
update public.profiles set bio = 'hello' where id = 'b2222222-2222-4222-8222-222222222222';
reset role;
select ok(
  (select bio is distinct from 'hello' from public.profiles where id = 'b2222222-2222-4222-8222-222222222222'),
  'no profile changes before the age check');
select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'b2222222-2222-4222-8222-222222222222/a.jpg')$$,
  '42501', null, 'no uploads before the age check');
select set_config('request.method', 'POST', true);
select throws_ok($$select public.check_request()$$, '42501', 'age_check_required', 'the API refuses writes and RPCs');
select set_config('request.method', 'GET', true);
select lives_ok($$select public.check_request()$$, 'reads are still allowed');

select pg_temp.as_user('b1111111-1111-4111-8111-111111111111');
select set_config('request.method', 'POST', true);
select lives_ok($$select public.check_request()$$, 'after the age check, writes are allowed');
select lives_ok(
  $$insert into public.matches (id, discipline, variant, source, duration_ms)
    values ('baaaaaaa-0000-4000-8000-000000000001', 'bjj', 'ibjjf', 'upload', 60000)$$,
  'and matches can be created');
select throws_ok(
  $$select public.svc_age_checked('b1111111-1111-4111-8111-111111111111')$$,
  '42501', null, 'users cannot call svc_age_checked');
select pg_temp.as_service();
select is(public.svc_age_checked('b1111111-1111-4111-8111-111111111111'), true, 'functions see a completed age check');
select is(public.svc_age_checked('b2222222-2222-4222-8222-222222222222'), false, 'and a missing one');

-- Copyright takedowns -------------------------------------------------------------------
reset role;
insert into public.posts (id, author_id, body) values
  ('c1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'Someone else''s fight footage');

select pg_temp.as_user('b1111111-1111-4111-8111-111111111111');
select throws_ok(
  $$select public.admin_remove_post('c1111111-1111-4111-8111-111111111111', 'DMCA notice')$$,
  '42501', null, 'only the owner can remove posts');

select pg_temp.as_user('b3333333-3333-4333-8333-333333333333');
select throws_ok(
  $$select public.admin_remove_post('c1111111-1111-4111-8111-111111111111', '  ')$$,
  '22023', null, 'a takedown needs a reason');
select lives_ok(
  $$select public.admin_remove_post('c1111111-1111-4111-8111-111111111111', 'DMCA notice 2026-10-29 from Example Films')$$,
  'the owner removes the post');

reset role;
select is((select count(*)::int from public.posts where id = 'c1111111-1111-4111-8111-111111111111'), 0, 'the post is gone');
select is(
  (select target_user_id from private.admin_audit_log where action = 'remove_post' order by id desc limit 1),
  'b2222222-2222-4222-8222-222222222222'::uuid, 'the takedown is audited against the author');

select * from finish();
rollback;
