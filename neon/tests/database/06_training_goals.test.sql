-- =============================================================================
-- Training goals: only your own, valid kinds and targets, one per kind,
-- banned accounts can't change them, and they go with the account.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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

create function pg_temp.make_user(sub text, name text) returns uuid language plpgsql as $$
declare
  uid uuid;
begin
  perform pg_temp.as_clerk(sub, 'GET');
  uid := public.register_user(name, initcap(name));
  perform pg_temp.as_backend();
  perform public.svc_record_age(uid, 1995, 6);
  return uid;
end;
$$;
select pg_temp.make_user('user_alice', 'alice');
select pg_temp.make_user('user_bob', 'bob');
select pg_temp.make_user('user_carol', 'carol');
create temp table ids as
  select clerk_id, id from app.users where clerk_id in ('user_alice', 'user_bob', 'user_carol');
grant select on ids to authenticated;

-- Setting goals ------------------------------------------------------------------
select pg_temp.as_clerk('user_alice');
select lives_ok(
  $$ insert into public.training_goals (kind, target) values ('rounds', 4), ('takedowns', 10) $$,
  'you can set weekly goals'
);
select is(
  (select user_id from public.training_goals where kind = 'rounds'),
  (select id from ids where clerk_id = 'user_alice'),
  'a goal belongs to whoever set it'
);
select lives_ok(
  $$ insert into public.training_goals (kind, target) values ('rounds', 5)
     on conflict (user_id, kind) do update set target = excluded.target $$,
  'setting the same kind again replaces the target'
);
select is((select target from public.training_goals where kind = 'rounds'), 5, 'the new target is kept');
select throws_ok(
  $$ insert into public.training_goals (kind, target) values ('push_ups', 3) $$,
  '23514', null, 'only the known kinds of goal'
);
select throws_ok(
  $$ insert into public.training_goals (kind, target) values ('wins', 0) $$,
  '23514', null, 'a target is at least 1'
);
select throws_ok(
  $$ insert into public.training_goals (kind, target) values ('wins', 101) $$,
  '23514', null, 'and at most 100'
);
select throws_ok(
  $$ insert into public.training_goals (user_id, kind, target)
     values ((select id from ids where clerk_id = 'user_bob'), 'wins', 2) $$,
  '42501', null, 'nobody can set goals for someone else'
);

-- Reading and changing someone else's ------------------------------------------------
select pg_temp.as_clerk('user_bob');
insert into public.training_goals (kind, target) values ('sweeps', 3);
select is((select count(*)::int from public.training_goals), 1, 'you only see your own goals');
update public.training_goals set target = 99 where kind = 'rounds';
delete from public.training_goals where kind = 'takedowns';
select pg_temp.as_clerk('user_alice');
select is(
  (select array_agg(target order by kind) from public.training_goals),
  array[5, 10],
  'nobody else can change or delete your goals'
);
delete from public.training_goals where kind = 'takedowns';
select is((select count(*)::int from public.training_goals), 1, 'you can remove a goal');

-- Banned accounts and signed-out requests -----------------------------------------------
select pg_temp.as_backend();
insert into private.bans (user_id, reason, category, source)
  values ((select id from ids where clerk_id = 'user_carol'), 'Spam', 'other', 'owner');
select pg_temp.as_clerk('user_carol');
select throws_ok(
  $$ insert into public.training_goals (kind, target) values ('rounds', 2) $$,
  '42501', null, 'a banned account cannot set goals'
);
select pg_temp.as_backend();
set local role anonymous;
select throws_ok(
  $$ select * from public.training_goals $$,
  '42501', null, 'signed-out requests cannot read goals'
);
reset role;

-- Deleting the account deletes the goals --------------------------------------------------
select pg_temp.as_backend();
delete from app.users where clerk_id = 'user_alice';
select is(
  (select count(*)::int from public.training_goals g
     where not exists (select 1 from app.users u where u.id = g.user_id)),
  0,
  'goals go with the account'
);

select * from finish();
rollback;
