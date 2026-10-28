-- =============================================================================
-- Ranked ladder: challenge lifecycle, opponent access to the recording,
-- confirmation rules, versioned settlement, titles, leaderboard/matchmaking
-- privacy, disputes and the deletion hooks.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

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

-- Completes the analysis of a match with the given winner side ('A', 'B' or null).
create function pg_temp.complete(match uuid, winner text, method text) returns void language plpgsql as $$
begin
  perform pg_temp.as_service();
  perform public.svc_save_analysis(
    match, 'test', 'test-model', '[]'::jsonb,
    jsonb_build_object('result', jsonb_build_object('winner', winner, 'method', method)), null);
end;
$$;

create function pg_temp.fighter(rating int, games int, delta int, outcome text, titles text[]) returns jsonb language sql as $$
  select jsonb_build_object(
    'rating', rating, 'games', games, 'wins', case when outcome = 'win' then 1 else 0 end,
    'losses', case when outcome = 'loss' then 1 else 0 end, 'draws', case when outcome = 'draw' then 1 else 0 end,
    'streak', case when outcome = 'win' then 1 else 0 end, 'peak', greatest(rating, 1000), 'delta', delta,
    'outcome', outcome, 'totals', jsonb_build_object('matches', 1), 'titles', to_jsonb(titles));
$$;

grant execute on all functions in schema pg_temp to authenticated, service_role;

-- A (public) and B (private) are friends; C is a private stranger; O is the owner.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-4111-8111-111111111111', 'rank-a@example.test', '{"username":"rank_a"}'),
  ('b2222222-2222-4222-8222-222222222222', 'rank-b@example.test', '{"username":"rank_b"}'),
  ('c3333333-3333-4333-8333-333333333333', 'rank-c@example.test', '{"username":"rank_c"}'),
  ('d4444444-4444-4444-8444-444444444444', 'rank-o@example.test', '{"username":"rank_o"}');
update public.profiles set visibility = 'public' where id = 'a1111111-1111-4111-8111-111111111111';
update public.user_entitlements set role = 'owner' where user_id = 'd4444444-4444-4444-8444-444444444444';
insert into public.friendships (user_low, user_high, requested_by, status)
  values ('a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', 'accepted');

-- Challenges ------------------------------------------------------------------------
select pg_temp.as_user('c3333333-3333-4333-8333-333333333333');
select throws_ok(
  $$select public.create_ranked_challenge('b2222222-2222-4222-8222-222222222222', 'bjj', 'ibjjf')$$,
  'P0002', null, 'private non-friends cannot be challenged');

select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select set_config('test.r1', public.create_ranked_challenge('b2222222-2222-4222-8222-222222222222', 'bjj', 'ibjjf', 'Sunday roll?')::text, false);
select is(
  (select status::text from public.ranked_matches where id = current_setting('test.r1')::uuid),
  'pending', 'a friend can be challenged');
select throws_ok(
  $$select public.create_ranked_challenge('b2222222-2222-4222-8222-222222222222', 'bjj', 'ibjjf')$$,
  '23505', null, 'only one open ranked match per pair and discipline');
select throws_ok(
  $$select public.respond_ranked_challenge(current_setting('test.r1')::uuid, true)$$,
  'P0002', null, 'the challenger cannot accept their own challenge');

select pg_temp.as_user('c3333333-3333-4333-8333-333333333333');
select is((select count(*)::int from public.ranked_matches), 0, 'outsiders cannot see ranked matches');

select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select is(public.respond_ranked_challenge(current_setting('test.r1')::uuid, true)::text, 'accepted', 'the opponent accepts');

-- Recording -------------------------------------------------------------------------
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
insert into public.matches (id, discipline, variant, source, duration_ms) values
  ('a0000000-0000-4000-8000-000000000001', 'bjj', 'ibjjf', 'live', 300000),
  ('a0000000-0000-4000-8000-000000000002', 'wrestling', 'folkstyle', 'live', 300000);
select throws_ok(
  $$select public.link_ranked_match(current_setting('test.r1')::uuid, 'a0000000-0000-4000-8000-000000000002')$$,
  '22023', null, 'the recording must use the ranked ruleset');
select lives_ok(
  $$select public.link_ranked_match(current_setting('test.r1')::uuid, 'a0000000-0000-4000-8000-000000000001')$$,
  'the recorder links their draft and becomes Fighter 1');
select is(
  (select fighter_b_id from public.ranked_matches where id = current_setting('test.r1')::uuid),
  'b2222222-2222-4222-8222-222222222222'::uuid, 'the other participant is Fighter 2');

select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.matches where id = 'a0000000-0000-4000-8000-000000000001'), 1, 'Fighter 2 can see the ranked recording');
select pg_temp.as_user('c3333333-3333-4333-8333-333333333333');
select is((select count(*)::int from public.matches where id = 'a0000000-0000-4000-8000-000000000001'), 0, 'outsiders cannot see the ranked recording');

-- Completion and confirmation --------------------------------------------------------
select pg_temp.complete('a0000000-0000-4000-8000-000000000001', 'B', 'submission');
select is(
  (select status::text || ':' || winner_id::text || ':' || result_method from public.ranked_matches where id = current_setting('test.r1')::uuid),
  'awaiting_confirmation:b2222222-2222-4222-8222-222222222222:submission',
  'a completed analysis proposes the result, mapped to the fighters');

select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.match_analyses where match_id = 'a0000000-0000-4000-8000-000000000001'), 1, 'Fighter 2 can read the scorecard to confirm it');

select pg_temp.as_service();
select is(public.svc_record_ranked_confirmation(current_setting('test.r1')::uuid, 'a1111111-1111-4111-8111-111111111111'), false, 'one confirmation is not enough inside the window');
select is(
  public.svc_apply_ranked_result(current_setting('test.r1')::uuid, '{"a":0,"b":0}',
    pg_temp.fighter(980, 1, -20, 'loss', '{}'), pg_temp.fighter(1025, 1, 25, 'win', '{giant_slayer}')),
  'not_ready', 'results do not settle before both confirm or the window passes');
select is(public.svc_record_ranked_confirmation(current_setting('test.r1')::uuid, 'b2222222-2222-4222-8222-222222222222'), true, 'both confirmations make it ready');
select throws_ok(
  $$select public.svc_record_ranked_confirmation(current_setting('test.r1')::uuid, 'c3333333-3333-4333-8333-333333333333')$$,
  'P0002', null, 'only the fighters can confirm');

-- Settlement -------------------------------------------------------------------------
select is(
  public.svc_apply_ranked_result(current_setting('test.r1')::uuid, '{"a":0,"b":1}',
    pg_temp.fighter(980, 1, -20, 'loss', '{}'), pg_temp.fighter(1025, 1, 25, 'win', '{giant_slayer}')),
  'conflict', 'a stale rating version is rejected');
select is(
  public.svc_apply_ranked_result(current_setting('test.r1')::uuid, '{"a":0,"b":0}',
    pg_temp.fighter(980, 1, -20, 'loss', '{}'), pg_temp.fighter(1025, 1, 25, 'win', '{giant_slayer}')),
  'applied', 'the settlement is applied');
select is(
  (select string_agg(user_id::text || '=' || rating || '/v' || version, ',' order by rating)
   from public.ranked_ratings where discipline = 'bjj'),
  'a1111111-1111-4111-8111-111111111111=980/v1,b2222222-2222-4222-8222-222222222222=1025/v1',
  'both ratings and versions are updated');
select is((select count(*)::int from public.rating_history where ranked_match_id = current_setting('test.r1')::uuid), 2, 'history is recorded for both fighters');
select is(
  (select rating_b_before || '->' || rating_b_after || ':' || status from public.ranked_matches where id = current_setting('test.r1')::uuid),
  '1000->1025:confirmed', 'the match stores the rating change');
select is(
  public.svc_apply_ranked_result(current_setting('test.r1')::uuid, '{"a":1,"b":1}',
    pg_temp.fighter(960, 2, -20, 'loss', '{}'), pg_temp.fighter(1050, 2, 25, 'win', '{}')),
  'already_settled', 'a match settles exactly once');

select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select throws_ok($$update public.ranked_ratings set rating = 4000$$, '42501', null, 'clients cannot write ratings');
select lives_ok($$select public.feature_title('giant_slayer')$$, 'an unlocked title can be featured');
select throws_ok($$select public.feature_title('grandmaster')$$, 'P0002', null, 'a locked title cannot be featured');

-- Ladder and matchmaking privacy ------------------------------------------------------
reset role;
update public.ranked_ratings set games = 10;
select pg_temp.as_user('c3333333-3333-4333-8333-333333333333');
select is(
  (select string_agg(user_id::text, ',') from public.get_leaderboard('bjj')),
  'a1111111-1111-4111-8111-111111111111', 'the global ladder shows public players only to strangers');
select is(
  (select string_agg(user_id::text, ',') from public.get_ranked_opponents('bjj')),
  'a1111111-1111-4111-8111-111111111111', 'matchmaking never suggests private strangers');
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select is(
  (select string_agg(user_id::text || '#' || ladder_position, ',' order by ladder_position) from public.get_leaderboard('bjj', 'friends')),
  'b2222222-2222-4222-8222-222222222222#1,a1111111-1111-4111-8111-111111111111#2', 'the friends ladder includes private friends');

-- Disputes ------------------------------------------------------------------------------
select set_config('test.r2', public.create_ranked_challenge('b2222222-2222-4222-8222-222222222222', 'wrestling', 'folkstyle')::text, false);
select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select public.respond_ranked_challenge(current_setting('test.r2')::uuid, true);
insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('b0000000-0000-4000-8000-000000000001', 'wrestling', 'folkstyle', 'upload', 300000);
select public.link_ranked_match(current_setting('test.r2')::uuid, 'b0000000-0000-4000-8000-000000000001');
select pg_temp.complete('b0000000-0000-4000-8000-000000000001', 'A', 'fall');
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select lives_ok($$select public.dispute_ranked_result(current_setting('test.r2')::uuid, 'That was my old video')$$, 'either fighter can dispute');
select throws_ok($$select * from public.admin_list_ranked_disputes()$$, '42501', null, 'only the owner lists disputes');
select pg_temp.as_service();
select is(
  public.svc_apply_ranked_result(current_setting('test.r2')::uuid, '{"a":0,"b":0}',
    pg_temp.fighter(1020, 1, 20, 'win', '{}'), pg_temp.fighter(980, 1, -20, 'loss', '{}')),
  'not_ready', 'disputed results are not settled automatically');
select pg_temp.as_user('d4444444-4444-4444-8444-444444444444');
select is((select count(*)::int from public.admin_list_ranked_disputes()), 1, 'the owner sees the dispute');
select is((select count(*)::int from public.matches where id = 'b0000000-0000-4000-8000-000000000001'), 1, 'the owner can review a disputed recording');
select is(public.admin_resolve_ranked_dispute(current_setting('test.r2')::uuid, 'void', 'Old footage')::text, 'voided', 'the owner can void a dispute');
select is((select count(*)::int from public.matches where id = 'b0000000-0000-4000-8000-000000000001'), 0, 'owner access ends with the dispute');

-- The confirmation window -----------------------------------------------------------
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select set_config('test.r4', public.create_ranked_challenge('b2222222-2222-4222-8222-222222222222', 'wrestling', 'folkstyle')::text, false);
select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select public.respond_ranked_challenge(current_setting('test.r4')::uuid, true);
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('a0000000-0000-4000-8000-000000000005', 'wrestling', 'folkstyle', 'upload', 300000);
select public.link_ranked_match(current_setting('test.r4')::uuid, 'a0000000-0000-4000-8000-000000000005');
select pg_temp.complete('a0000000-0000-4000-8000-000000000005', null, 'draw');
select is(
  (select confirm_by between now() + interval '71 hours' and now() + interval '73 hours' from public.ranked_matches where id = current_setting('test.r4')::uuid),
  true, 'results wait 72 hours for confirmation or a dispute');
reset role;
update public.ranked_matches set confirm_by = now() - interval '1 minute' where id = current_setting('test.r4')::uuid;
select pg_temp.as_service();
select is(
  public.svc_apply_ranked_result(current_setting('test.r4')::uuid, '{"a":0,"b":0}',
    pg_temp.fighter(1000, 1, 0, 'draw', '{}'), pg_temp.fighter(1000, 1, 0, 'draw', '{}')),
  'applied', 'an undisputed result settles once the window has passed');

-- A recorder's own win needs Fighter 2 ---------------------------------------------------
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select set_config('test.r5', public.create_ranked_challenge('b2222222-2222-4222-8222-222222222222', 'bjj', 'ibjjf')::text, false);
select throws_ok(
  $$select public.create_ranked_challenge('b2222222-2222-4222-8222-222222222222', 'mma', 'unified')$$,
  'P0429', null, 'the same pair can play at most 3 ranked matches a week');
select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select public.respond_ranked_challenge(current_setting('test.r5')::uuid, true);
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('a0000000-0000-4000-8000-000000000006', 'bjj', 'ibjjf', 'live', 300000);
select public.link_ranked_match(current_setting('test.r5')::uuid, 'a0000000-0000-4000-8000-000000000006');
select pg_temp.complete('a0000000-0000-4000-8000-000000000006', 'A', 'points');
reset role;
update public.ranked_matches set confirm_by = now() - interval '1 minute' where id = current_setting('test.r5')::uuid;
select pg_temp.as_service();
select is(
  public.svc_apply_ranked_result(current_setting('test.r5')::uuid, '{"a":1,"b":1}',
    pg_temp.fighter(1000, 2, 20, 'win', '{}'), pg_temp.fighter(1005, 2, -20, 'loss', '{}')),
  'not_ready', 'a win claimed by the recorder never auto-confirms');
reset role;
update public.ranked_matches set recorded_at = now() - interval '8 days' where id = current_setting('test.r5')::uuid;
select private.expire_stale_ranked('a1111111-1111-4111-8111-111111111111');
select is(
  (select status::text from public.ranked_matches where id = current_setting('test.r5')::uuid),
  'voided', 'an unconfirmed recorder win is voided after 7 days');
select is(
  (select rating from public.ranked_ratings where user_id = 'a1111111-1111-4111-8111-111111111111' and discipline = 'bjj'),
  980, 'a voided result changes no rating');

-- Deleting recordings -------------------------------------------------------------------
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select set_config('test.r3', public.create_ranked_challenge('b2222222-2222-4222-8222-222222222222', 'mma', 'unified')::text, false);
select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select public.respond_ranked_challenge(current_setting('test.r3')::uuid, true);
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('a0000000-0000-4000-8000-000000000003', 'mma', 'unified', 'live', 300000);
select public.link_ranked_match(current_setting('test.r3')::uuid, 'a0000000-0000-4000-8000-000000000003');
delete from public.matches where id = 'a0000000-0000-4000-8000-000000000003';
select is(
  (select status::text || ':' || coalesce(match_id::text, 'none') from public.ranked_matches where id = current_setting('test.r3')::uuid),
  'accepted:none', 'deleting an unanalysed recording lets the match be recorded again');

insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('a0000000-0000-4000-8000-000000000004', 'mma', 'unified', 'live', 300000);
select public.link_ranked_match(current_setting('test.r3')::uuid, 'a0000000-0000-4000-8000-000000000004');
select pg_temp.complete('a0000000-0000-4000-8000-000000000004', 'A', 'ko_tko');
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
delete from public.matches where id = 'a0000000-0000-4000-8000-000000000004';
select is(
  (select status::text from public.ranked_matches where id = current_setting('test.r3')::uuid),
  'voided', 'deleting the recording of an unsettled result voids it');

select * from finish();
rollback;
