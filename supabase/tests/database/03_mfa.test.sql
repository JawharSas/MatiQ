-- =============================================================================
-- Two-factor enforcement: once a factor is verified, aal1 sessions are locked
-- out of tables, storage and RPCs until they step up to aal2.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

create function pg_temp.as_user(uid uuid, aal text) returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('71111111-1111-4111-8111-111111111111', 'mfa-a@example.test', '{"username":"mfa_a"}'),
  ('72222222-2222-4222-8222-222222222222', 'mfa-b@example.test', '{"username":"mfa_b"}');
-- Every test user has answered the age check (06 covers the check itself).
insert into private.age_checks (user_id, birth_month) select id, date '1990-01-01' from auth.users on conflict do nothing;

-- Both users own a match and an avatar.
select pg_temp.as_user('71111111-1111-4111-8111-111111111111', 'aal1');
insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('7aaaaaaa-0000-4000-8000-000000000001', 'bjj', 'ibjjf', 'upload', 60000);
insert into storage.objects (bucket_id, name) values ('avatars', '71111111-1111-4111-8111-111111111111/pending.jpg');
select pg_temp.as_user('72222222-2222-4222-8222-222222222222', 'aal1');
insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('7aaaaaaa-0000-4000-8000-000000000002', 'bjj', 'ibjjf', 'upload', 60000);

-- A has a verified factor; B only started enrolling.
reset role;
insert into auth.mfa_factors (user_id, status) values
  ('71111111-1111-4111-8111-111111111111', 'verified'),
  ('72222222-2222-4222-8222-222222222222', 'unverified');

-- B (no verified factor) is unaffected ---------------------------------------------
select pg_temp.as_user('72222222-2222-4222-8222-222222222222', 'aal1');
select is(private.mfa_satisfied(), true, 'an unverified factor does not require step-up');
select is((select count(*)::int from public.matches), 1, 'users without 2FA keep full access at aal1');
select lives_ok($$select public.check_request_mfa()$$, 'the pre-request hook passes users without 2FA');

-- A at aal1 is locked out ------------------------------------------------------------
select pg_temp.as_user('71111111-1111-4111-8111-111111111111', 'aal1');
select is(private.mfa_satisfied(), false, 'a verified factor requires aal2');
select is((select count(*)::int from public.matches), 0, 'aal1 sessions cannot read their matches');
select is((select count(*)::int from public.profiles where id = '71111111-1111-4111-8111-111111111111'), 0, 'aal1 sessions cannot read their profile');
select is((select count(*)::int from storage.objects), 0, 'aal1 sessions cannot read storage objects');
select throws_ok(
  $$insert into public.matches (id, discipline, variant, source, duration_ms)
    values ('7aaaaaaa-0000-4000-8000-000000000003', 'bjj', 'ibjjf', 'upload', 60000)$$,
  '42501', null, 'aal1 sessions cannot create matches');
select throws_ok($$select public.check_request_mfa()$$, '42501', 'mfa_required', 'the pre-request hook rejects aal1 API calls (incl. RPCs)');

-- A at aal2 has access again ---------------------------------------------------------
select pg_temp.as_user('71111111-1111-4111-8111-111111111111', 'aal2');
select is((select count(*)::int from public.matches), 1, 'aal2 sessions read their matches');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars'), 1, 'aal2 sessions read storage objects');
select lives_ok($$select public.check_request_mfa()$$, 'the pre-request hook passes aal2 sessions');

select * from finish();
rollback;
