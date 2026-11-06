-- =============================================================================
-- Gyms: starting and joining, one gym each, what members and others see, the
-- leaderboard and gym feed, the owner's powers, leaving, and the word filter.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

create function pg_temp.as_clerk(sub text, method text default 'POST') returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'sid', 'sess_1')::text, true);
  perform set_config('request.method', method, true);
  perform set_config('request.headers', '', true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_backend() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.method', '', true);
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

create function pg_temp.make_user(sub text, name text, visibility text) returns uuid language plpgsql as $$
declare
  uid uuid;
begin
  perform pg_temp.as_clerk(sub, 'GET');
  uid := public.register_user(name, initcap(name));
  perform pg_temp.as_backend();
  perform public.svc_record_age(uid, 1995, 6);
  update public.profiles set visibility = make_user.visibility::public.account_visibility where profiles.id = uid;
  return uid;
end;
$$;
select pg_temp.make_user('user_alice', 'alice', 'public');
select pg_temp.make_user('user_bob', 'bob', 'public');
select pg_temp.make_user('user_carol', 'carol', 'private');
select pg_temp.make_user('user_dan', 'dan', 'public');
create temp table ids as
  select clerk_id, id from app.users where clerk_id in ('user_alice', 'user_bob', 'user_carol', 'user_dan');
grant select on ids to authenticated;
create function pg_temp.uid(sub text) returns uuid language sql as $$ select id from ids where clerk_id = sub $$;
insert into private.blocked_terms (term, category) values ('testslur', 'hate') on conflict do nothing;

-- Starting a gym ---------------------------------------------------------------------
select pg_temp.as_clerk('user_alice');
create temp table gym as select public.create_gym('Rivera Grappling', 'Austin') as id;
grant select on gym to authenticated;
select ok((select id from gym) is not null, 'anyone can start a gym');
select is((public.get_my_gym() ->> 'role'), 'owner', 'and owns it');
select ok((public.get_my_gym() ->> 'invite_code') ~ '^[A-HJ-NP-Z2-9]{8}$', 'with a readable 8-character invite code');
select throws_ok($$ select public.create_gym('Second Gym') $$, '23505', null, 'one gym per person');
select pg_temp.as_clerk('user_dan');
select throws_ok($$ select public.create_gym('testslur academy') $$, '22023', null, 'gym names go through the word filter');
select throws_ok($$ select public.create_gym('ab') $$, '23514', null, 'a gym name has at least 3 characters');

-- Joining ----------------------------------------------------------------------------
select pg_temp.as_backend();
create temp table code as select invite_code from public.gyms where id = (select id from gym);
grant select on code to authenticated;
select pg_temp.as_clerk('user_bob');
select throws_ok($$ select public.join_gym('ZZZZZZZZ') $$, 'P0002', null, 'a wrong code finds no gym');
select is(public.join_gym(lower((select invite_code from code))), (select id from gym), 'the code works in any case');
select pg_temp.as_clerk('user_carol');
select public.join_gym((select invite_code from code));
select is((public.get_my_gym() ->> 'member_count')::int, 3, 'members see the gym and its size');
select is((select count(*)::int from public.get_gym_members()), 3, 'and its members');
select pg_temp.as_clerk('user_dan');
select is(public.get_my_gym(), null, 'someone outside sees no gym');
select throws_ok($$ select * from public.get_gym_members() $$, 'P0002', null, 'and no members');
select is((select count(*)::int from public.gym_members), 0, 'not even through the table');
select throws_ok($$ select * from public.gyms $$, '42501', null, 'and the gyms table is not readable');

-- Leaderboard --------------------------------------------------------------------------
select pg_temp.as_backend();
insert into public.ranked_ratings (user_id, discipline, rating, games, wins, losses) values
  (pg_temp.uid('user_alice'), 'bjj', 1180, 10, 7, 3),
  (pg_temp.uid('user_carol'), 'bjj', 1260, 12, 9, 3),
  (pg_temp.uid('user_bob'), 'wrestling', 1100, 4, 2, 2),
  (pg_temp.uid('user_dan'), 'bjj', 1500, 20, 18, 2);
select pg_temp.as_clerk('user_bob');
select is(
  (select string_agg(username, ',' order by rating desc) from public.get_gym_leaderboard('bjj')),
  'carol,alice',
  'the leaderboard ranks teammates by rating, private accounts included, outsiders not'
);

-- Gym feed ------------------------------------------------------------------------------
select pg_temp.as_clerk('user_alice');
insert into public.posts (body) values ('Gym post from Alice');
select pg_temp.as_clerk('user_carol');
insert into public.posts (body) values ('Gym post from private Carol');
select pg_temp.as_clerk('user_dan');
insert into public.posts (body) values ('Outsider post');
select pg_temp.as_clerk('user_bob');
select is(
  (select string_agg(body, ',' order by body) from public.get_gym_feed()),
  'Gym post from Alice',
  'the gym feed shows teammates only, and a private account''s posts still need a friendship'
);

-- The owner's powers ---------------------------------------------------------------------
select throws_ok($$ select public.remove_gym_member(pg_temp.uid('user_carol')) $$, '42501', null, 'members can''t remove anyone');
select throws_ok($$ select public.rotate_gym_code() $$, '42501', null, 'or change the code');
select pg_temp.as_clerk('user_alice');
create temp table new_code as select public.rotate_gym_code() as code;
grant select on new_code to authenticated;
select ok((select code from new_code) <> (select invite_code from code), 'the owner can issue a new code');
select pg_temp.as_clerk('user_dan');
select throws_ok($$ select public.join_gym((select invite_code from code)) $$, 'P0002', null, 'and the old one stops working');
select pg_temp.as_clerk('user_alice');
select is(public.remove_gym_member(pg_temp.uid('user_carol')), true, 'the owner can remove a member');

-- Leaving ---------------------------------------------------------------------------------
select public.leave_gym();
select pg_temp.as_clerk('user_bob');
select is((public.get_my_gym() ->> 'role'), 'owner', 'when the owner leaves, the longest-standing member takes over');
select public.leave_gym();
select pg_temp.as_backend();
select is((select count(*)::int from public.gyms where id = (select id from gym)), 0, 'when the last member leaves, the gym is deleted');

-- Banned accounts -----------------------------------------------------------------------------
insert into private.bans (user_id, reason, category, source) values (pg_temp.uid('user_dan'), 'Spam', 'other', 'owner');
select pg_temp.as_clerk('user_dan');
select throws_ok($$ select public.create_gym('Dan''s Gym') $$, '42501', null, 'a banned account can''t start a gym');
select throws_ok($$ select public.join_gym((select code from new_code)) $$, '42501', null, 'or join one');
select pg_temp.as_clerk('user_carol');
select lives_ok($$ select public.create_gym('Carol''s Club') $$, 'someone removed from a gym can start their own');

select * from finish();
rollback;
