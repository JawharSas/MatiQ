-- =============================================================================
-- Live (incremental) analysis: session lifecycle, batch claiming rules, RLS.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

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
  ('61111111-1111-4111-8111-111111111111', 'live-a@example.test', '{"username":"live_a"}'),
  ('62222222-2222-4222-8222-222222222222', 'live-b@example.test', '{"username":"live_b"}');
-- Every test user has answered the age check (06 covers the check itself).
insert into private.age_checks (user_id, birth_month) select id, date '1990-01-01' from auth.users on conflict do nothing;

select pg_temp.as_user('61111111-1111-4111-8111-111111111111');
insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('6aaaaaaa-0000-4000-8000-000000000001', 'bjj', 'ibjjf', 'live', 600000);

-- Start a session ------------------------------------------------------------------
select pg_temp.as_service();
create temp table reservation as
  select * from public.svc_reserve_analysis('61111111-1111-4111-8111-111111111111', '6aaaaaaa-0000-4000-8000-000000000001', 'platform');
select is((select allowed from reservation), true, 'quota is reserved once for the whole live match');
select public.svc_start_live_session(
  '6aaaaaaa-0000-4000-8000-000000000001', (select reservation_id from reservation), 'platform', 'blue gi', null);
select is(
  (select status::text from public.matches where id = '6aaaaaaa-0000-4000-8000-000000000001'),
  'live', 'starting a session marks the match live');
select is(
  (select reason from public.svc_reserve_analysis('61111111-1111-4111-8111-111111111111', '6aaaaaaa-0000-4000-8000-000000000001', 'platform')),
  'already_processing', 'a live match cannot reserve a second unit');
select throws_ok(
  $$select public.svc_start_live_session('6aaaaaaa-0000-4000-8000-000000000001', (select reservation_id from reservation), 'platform', null, null)$$,
  'P0002', null, 'a session can only start from a draft');

-- Claim batches ------------------------------------------------------------------
select is(public.svc_claim_live_batch('6aaaaaaa-0000-4000-8000-000000000001', 0, array[0, 1000, 2000], 10), 'claimed', 'first batch is claimed');
select is(public.svc_claim_live_batch('6aaaaaaa-0000-4000-8000-000000000001', 0, array[3000], 10), 'duplicate', 'batch indexes are unique');
select is(public.svc_claim_live_batch('6aaaaaaa-0000-4000-8000-000000000001', 1, array[2000, 3000], 10), 'overlap', 'frames are never analysed twice');
select is(public.svc_claim_live_batch('6aaaaaaa-0000-4000-8000-000000000001', 1, array[3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000], 10), 'frame_budget_exceeded', 'the per-match frame budget is enforced');
select is(public.svc_claim_live_batch('6aaaaaaa-0000-4000-8000-000000000001', 1, array[3000, 4000], 10), 'claimed', 'a non-overlapping batch within budget is claimed');
select public.svc_complete_live_batch('6aaaaaaa-0000-4000-8000-000000000001', 1, 'failed', null, null, 'ai_unavailable');
select is(public.svc_claim_live_batch('6aaaaaaa-0000-4000-8000-000000000001', 2, array[3000, 4000], 10), 'claimed', 'frames of a failed batch can be retried');
select public.svc_complete_live_batch(
  '6aaaaaaa-0000-4000-8000-000000000001', 0, 'done',
  '[{"type":"takedown","athlete":"A","t":1000,"confidence":0.9}]'::jsonb, '["good base"]'::jsonb, null);
select is(public.svc_claim_live_batch('62222222-2222-4222-8222-222222222222', 0, array[0], 10), 'no_session', 'batches require a live session');

-- Visibility -----------------------------------------------------------------------
select pg_temp.as_user('61111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from public.match_live_batches where status = 'done'),
  1, 'the owner can read their analysed batches');
select lives_ok(
  $$update public.matches set duration_ms = 125000 where id = '6aaaaaaa-0000-4000-8000-000000000001'$$,
  'duration can be finalised while the match is live');
select throws_ok(
  $$insert into public.match_live_batches (match_id, owner_id, batch_index, frame_ts) values ('6aaaaaaa-0000-4000-8000-000000000001', auth.uid(), 9, array[1])$$,
  '42501', null, 'clients cannot write batches');
select throws_ok(
  $$select * from public.svc_get_live_session('6aaaaaaa-0000-4000-8000-000000000001')$$,
  '42501', null, 'live sessions are service-only');

select pg_temp.as_user('62222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.match_live_batches), 0, 'other users cannot read live batches');

-- End the session ------------------------------------------------------------------
select pg_temp.as_service();
select is(
  public.svc_end_live_session('6aaaaaaa-0000-4000-8000-000000000001'),
  (select reservation_id from reservation), 'ending a session returns its reservation for settlement');

select * from finish();
rollback;
