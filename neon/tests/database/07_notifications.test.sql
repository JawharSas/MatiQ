-- =============================================================================
-- Notifications: what writes them, who reads them, read state, blocks and
-- bans, deleted posts, the per-kind switches and push tokens.
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

create function pg_temp.make_user(sub text, name text) returns uuid language plpgsql as $$
declare
  uid uuid;
begin
  perform pg_temp.as_clerk(sub, 'GET');
  uid := public.register_user(name, initcap(name));
  perform pg_temp.as_backend();
  perform public.svc_record_age(uid, 1995, 6);
  update public.profiles set visibility = 'public' where profiles.id = uid;
  return uid;
end;
$$;
select pg_temp.make_user('user_alice', 'alice');
select pg_temp.make_user('user_bob', 'bob');
select pg_temp.make_user('user_carol', 'carol');
create temp table ids as
  select clerk_id, id from app.users where clerk_id in ('user_alice', 'user_bob', 'user_carol');
grant select on ids to authenticated;
create function pg_temp.uid(sub text) returns uuid language sql as $$ select id from ids where clerk_id = sub $$;

-- Friends --------------------------------------------------------------------------
select pg_temp.as_clerk('user_bob');
select public.send_friend_request(pg_temp.uid('user_alice'));
select pg_temp.as_clerk('user_alice');
select is(
  (select string_agg(kind || ':' || actor_id, ',') from public.get_notifications()),
  'friend_request:' || pg_temp.uid('user_bob'),
  'a friend request notifies who it is sent to'
);
select ok(
  (select actor_username = 'bob' and actor_display_name = 'Bob' from public.get_notifications() limit 1),
  'with the sender''s name'
);
select public.respond_friend_request(pg_temp.uid('user_bob'), true);
select pg_temp.as_clerk('user_bob');
select is(
  (select string_agg(kind || ':' || actor_id, ',') from public.get_notifications()),
  'friend_accepted:' || pg_temp.uid('user_alice'),
  'accepting it notifies the sender'
);

-- Ranked ---------------------------------------------------------------------------
select pg_temp.as_clerk('user_alice');
create temp table ranked as select public.create_ranked_challenge(pg_temp.uid('user_bob'), 'bjj', 'ibjjf', 'Thursday?') as id;
grant select on ranked to authenticated;
select pg_temp.as_clerk('user_bob');
select is(
  (select subject_id from public.get_notifications() where kind = 'ranked_challenge'),
  (select id from ranked),
  'a ranked challenge notifies the opponent, about that match'
);
select public.respond_ranked_challenge((select id from ranked), true);
select pg_temp.as_clerk('user_alice');
select is(
  (select count(*)::int from public.get_notifications() where kind = 'ranked_accepted'),
  1,
  'accepting it notifies the challenger'
);
select pg_temp.as_backend();
update public.ranked_matches
  set status = 'awaiting_confirmation', fighter_a_id = pg_temp.uid('user_alice'), fighter_b_id = pg_temp.uid('user_bob'),
      winner_id = pg_temp.uid('user_alice'), result_method = 'points', recorded_at = now(), confirm_by = now() + interval '72 hours'
  where id = (select id from ranked);
select pg_temp.as_clerk('user_bob');
select is(
  (select actor_id from public.get_notifications() where kind = 'ranked_result'),
  pg_temp.uid('user_alice'),
  'a recorded ranked match asks Fighter 2 to confirm the result'
);

-- Likes and comments ---------------------------------------------------------------------
select pg_temp.as_clerk('user_alice');
insert into public.posts (body) values ('Open mat recap');
create temp table post as select id from public.posts where body = 'Open mat recap';
grant select on post to authenticated;
insert into public.post_likes (post_id) values ((select id from post));
select is(
  (select count(*)::int from public.get_notifications() where kind = 'post_like'),
  0,
  'liking your own post notifies nobody'
);
select pg_temp.as_clerk('user_bob');
insert into public.post_likes (post_id) values ((select id from post));
delete from public.post_likes where post_id = (select id from post);
insert into public.post_likes (post_id) values ((select id from post));
select public.add_post_comment((select id from post), 'Nice pass at 0:40');
select pg_temp.as_clerk('user_alice');
select is(
  (select count(*)::int from public.get_notifications() where kind = 'post_like'),
  1,
  'a like notifies the author once, however often it is redone'
);
select is(
  (select subject_id from public.get_notifications() where kind = 'post_comment'),
  (select id from post),
  'a comment notifies the author, about that post'
);

-- Reading and marking read ------------------------------------------------------------------
select is(
  (select count(*)::int from public.get_notifications() where read_at is null),
  4,
  'new notifications are unread'
);
select is(public.mark_notifications_read(), 4, 'marking them read says how many');
select is(
  (select count(*)::int from public.get_notifications() where read_at is null),
  0,
  'and then none are unread'
);
select pg_temp.as_clerk('user_carol');
select is((select count(*)::int from public.get_notifications()), 0, 'you only see your own notifications');
select throws_ok($$ select * from public.notifications $$, '42501', null, 'the table itself is not readable');
select throws_ok(
  $$ insert into public.notifications (user_id, kind, actor_id) values (pg_temp.uid('user_alice'), 'post_like', pg_temp.uid('user_carol')) $$,
  '42501', null, 'nobody can write a notification directly'
);

-- Blocks, bans and deleted posts -------------------------------------------------------------
insert into public.post_likes (post_id) values ((select id from post));
select pg_temp.as_clerk('user_alice');
select is((select count(*)::int from public.get_notifications() where actor_id = pg_temp.uid('user_carol')), 1, 'Carol''s like shows');
insert into public.blocks (blocked_id) values (pg_temp.uid('user_carol'));
select is(
  (select count(*)::int from public.get_notifications() where actor_id = pg_temp.uid('user_carol')),
  0,
  'blocking someone hides their notifications'
);
select pg_temp.as_backend();
insert into private.bans (user_id, reason, category, source) values (pg_temp.uid('user_bob'), 'Spam', 'other', 'owner');
select pg_temp.as_clerk('user_alice');
select is(
  (select count(*)::int from public.get_notifications() where actor_id = pg_temp.uid('user_bob')),
  0,
  'a banned account''s notifications are hidden'
);
select pg_temp.as_backend();
delete from private.bans where user_id = pg_temp.uid('user_bob');
delete from public.posts where id = (select id from post);
select pg_temp.as_clerk('user_alice');
select is(
  (select count(*)::int from public.get_notifications() where kind in ('post_like', 'post_comment')),
  0,
  'a deleted post takes its notifications with it'
);

-- Switches ------------------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.notification_settings (likes, comments) values (false, true) $$,
  'you can switch kinds of push off'
);
select pg_temp.as_clerk('user_bob');
select is((select count(*)::int from public.notification_settings), 0, 'and nobody else sees your switches');

-- Push tokens -----------------------------------------------------------------------------------
select pg_temp.as_clerk('user_alice');
select lives_ok(
  $$ select public.register_push_token('fcm-token-for-alices-phone-0001', 'android') $$,
  'a phone registers for pushes'
);
select throws_ok($$ select * from public.push_tokens $$, '42501', null, 'tokens are never readable');
select throws_ok(
  $$ select public.register_push_token('short', 'android') $$,
  '22023', null, 'a malformed token is refused'
);
select pg_temp.as_clerk('user_carol');
select is(public.unregister_push_token('fcm-token-for-alices-phone-0001'), false, 'nobody else can remove your phone');
select public.register_push_token('fcm-token-for-alices-phone-0001', 'android');
select pg_temp.as_backend();
select is(
  (select user_id from public.push_tokens where token = 'fcm-token-for-alices-phone-0001'),
  pg_temp.uid('user_carol'),
  'a phone belongs to whoever signed in on it last'
);

select * from finish();
rollback;
