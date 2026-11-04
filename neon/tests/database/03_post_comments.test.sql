-- =============================================================================
-- Comments on posts: who can comment, the author's on/off switch, deleting,
-- the word filter, blocks, and the counts in the feed.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

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

-- Alice posts, Bob and Carol read (all public profiles, past the age check).
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
insert into private.blocked_terms (term, category) values ('testslur', 'hate') on conflict do nothing;

select pg_temp.as_clerk('user_alice');
insert into public.posts (body) values ('Open mat recap');
insert into public.posts (body, comments_enabled) values ('No comments on this one', false);
insert into public.posts (body, friends_only) values ('Friends only', true);
create temp table post_ids as
  select body, id from public.posts where author_id = (select id from ids where clerk_id = 'user_alice');
select pg_temp.as_backend();
grant select on post_ids to authenticated;

-- Commenting ----------------------------------------------------------------------
select pg_temp.as_clerk('user_bob');
select ok(
  public.add_post_comment((select id from post_ids where body = 'Open mat recap'), '  Great scramble at the end  ') is not null,
  'anyone who can see a post can comment on it'
);
select is(
  (select body from public.post_comments limit 1), 'Great scramble at the end',
  'the comment is stored trimmed'
);
select throws_ok(
  format($$select public.add_post_comment(%L, 'Hello')$$, (select id from post_ids where body = 'No comments on this one')),
  '42501', 'comments_off',
  'not on a post whose author turned comments off when sharing'
);
select throws_ok(
  format($$select public.add_post_comment(%L, 'Hello')$$, (select id from post_ids where body = 'Friends only')),
  'P0002', null,
  'not on a post the commenter cannot see'
);
select throws_ok(
  format($$select public.add_post_comment(%L, '   ')$$, (select id from post_ids where body = 'Open mat recap')),
  '22023', null,
  'not an empty comment'
);
select throws_ok(
  format($$select public.add_post_comment(%L, 'you t3stslur')$$, (select id from post_ids where body = 'Open mat recap')),
  '22023', 'content_not_allowed',
  'not one that breaks the word filter'
);
select throws_ok(
  format($$insert into public.post_comments (post_id, body) values (%L, 'direct')$$, (select id from post_ids where body = 'Open mat recap')),
  '42501', null,
  'comments are only written through add_post_comment'
);

-- Reading ------------------------------------------------------------------------
select pg_temp.as_clerk('user_carol', 'GET');
select is(
  (select count(*)::int from public.get_post_comments((select id from post_ids where body = 'Open mat recap'))), 1,
  'others see the comment'
);
select is(
  (select can_delete from public.get_post_comments((select id from post_ids where body = 'Open mat recap'))), false,
  'and cannot delete it'
);
select is(
  (select comment_count::int from public.get_feed() where post_id = (select id from post_ids where body = 'Open mat recap')), 1,
  'the feed counts it'
);
select is(
  (select comments_enabled from public.get_feed() where post_id = (select id from post_ids where body = 'No comments on this one')), false,
  'and says which posts take no comments'
);
select pg_temp.as_clerk('user_bob', 'GET');
select is(
  (select can_delete from public.get_post_comments((select id from post_ids where body = 'Open mat recap'))), true,
  'its writer can delete it'
);

-- Turning comments off ----------------------------------------------------------------
select pg_temp.as_clerk('user_bob');
select is(
  public.set_post_comments((select id from post_ids where body = 'Open mat recap'), false), false,
  'only the post''s author can turn its comments off'
);
select pg_temp.as_clerk('user_alice');
select is(
  public.set_post_comments((select id from post_ids where body = 'Open mat recap'), false), true,
  'the author can'
);
select pg_temp.as_clerk('user_bob');
select throws_ok(
  format($$select public.add_post_comment(%L, 'One more')$$, (select id from post_ids where body = 'Open mat recap')),
  '42501', 'comments_off',
  'after that nobody can comment'
);
select pg_temp.as_clerk('user_carol', 'GET');
select is(
  (select count(*)::int from public.get_post_comments((select id from post_ids where body = 'Open mat recap'))), 1,
  'and the comments already there stay'
);
select is(
  (select comments_enabled from public.get_post_comment_state((select id from post_ids where body = 'Open mat recap'))), false,
  'the comments screen sees they are off'
);
select pg_temp.as_clerk('user_alice');
select is(
  public.set_post_comments((select id from post_ids where body = 'Open mat recap'), true), true,
  'the author can turn them back on'
);

-- Deleting -----------------------------------------------------------------------------
select pg_temp.as_clerk('user_carol');
select is(
  public.delete_post_comment((select id from public.post_comments limit 1)), false,
  'someone else cannot delete a comment'
);
select pg_temp.as_clerk('user_alice', 'GET');
select is(
  (select can_delete from public.get_post_comments((select id from post_ids where body = 'Open mat recap'))), true,
  'the post''s author may delete comments on it'
);
select pg_temp.as_clerk('user_alice');
select is(
  public.delete_post_comment((select comment_id from public.get_post_comments((select id from post_ids where body = 'Open mat recap')))), true,
  'and does'
);
select pg_temp.as_backend();
select is((select count(*)::int from public.post_comments), 0, 'the comment is gone');

-- Blocks --------------------------------------------------------------------------------
select pg_temp.as_clerk('user_carol');
select ok(public.add_post_comment((select id from post_ids where body = 'Open mat recap'), 'Nice') is not null, 'Carol comments');
insert into public.blocks (blocked_id) values ((select id from ids where clerk_id = 'user_bob'));
select pg_temp.as_clerk('user_bob', 'GET');
select is(
  (select count(*)::int from public.get_post_comments((select id from post_ids where body = 'Open mat recap'))), 0,
  'comments by someone who blocked you are hidden from you'
);

select * from finish();
rollback;
