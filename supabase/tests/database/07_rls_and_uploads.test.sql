-- =============================================================================
-- Database-wide guarantees (row-level security everywhere, nothing for
-- anonymous requests) and the checked video upload flow.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

grant execute on all functions in schema pg_temp to authenticated;

-- Row-level security and privileges --------------------------------------------------
select is(
  (select coalesce(string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname, c.relname), '')
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '', 'every table in public and private has row-level security enabled');
select ok((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass), 'storage objects have row-level security');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')),
  0, 'no views in the API schema (a view would bypass row-level security)');
select is(
  (select coalesce(string_agg(distinct table_name, ', '), '') from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'),
  '', 'anonymous requests have no table privileges');
select is(
  (select coalesce(string_agg(distinct table_name, ', '), '') from information_schema.role_table_grants
   where grantee in ('anon', 'authenticated') and table_schema = 'private'),
  '', 'private tables are not granted to API roles');
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname not in ('check_request', 'check_request_mfa')
     and has_function_privilege('anon', p.oid, 'execute')),
  '', 'anonymous requests cannot run any privileged function (except the request hooks)');
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'svc\_%'
     and has_function_privilege('authenticated', p.oid, 'execute')),
  '', 'service functions are not callable by users');

-- Video uploads ------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-4111-8111-111111111111', 'uploader@example.test', '{"username":"uploader"}'),
  ('d2222222-2222-4222-8222-222222222222', 'viewer@example.test', '{"username":"viewer"}');
insert into private.age_checks (user_id, birth_month) select id, date '1990-01-01' from auth.users on conflict do nothing;
update public.profiles set visibility = 'public' where id = 'd1111111-1111-4111-8111-111111111111';

select pg_temp.as_user('d1111111-1111-4111-8111-111111111111');
insert into public.matches (id, discipline, variant, source, duration_ms)
  values ('daaaaaaa-0000-4000-8000-000000000001', 'bjj', 'ibjjf', 'upload', 60000);

select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('match-videos', 'd1111111-1111-4111-8111-111111111111/daaaaaaa-0000-4000-8000-000000000001/upload.mp4')$$,
  'the app uploads to upload.mp4');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('match-videos', 'd1111111-1111-4111-8111-111111111111/daaaaaaa-0000-4000-8000-000000000001/video.mp4')$$,
  '42501', null, 'clients cannot write a published video directly');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('match-videos', 'd1111111-1111-4111-8111-111111111111/daaaaaaa-0000-4000-8000-000000000001/checking.mp4')$$,
  '42501', null, 'or a video being checked');

-- The server publishes the checked video and the match is shared.
reset role;
insert into storage.objects (bucket_id, name)
  values ('match-videos', 'd1111111-1111-4111-8111-111111111111/daaaaaaa-0000-4000-8000-000000000001/video.mp4');
insert into public.posts (id, author_id, match_id, body)
  values ('dbbbbbbb-0000-4000-8000-000000000001', 'd1111111-1111-4111-8111-111111111111', 'daaaaaaa-0000-4000-8000-000000000001', 'Open mat');

select pg_temp.as_user('d1111111-1111-4111-8111-111111111111');
update storage.objects set metadata = '{"replaced":true}'
  where name = 'd1111111-1111-4111-8111-111111111111/daaaaaaa-0000-4000-8000-000000000001/video.mp4';
reset role;
select is(
  (select metadata from storage.objects where name = 'd1111111-1111-4111-8111-111111111111/daaaaaaa-0000-4000-8000-000000000001/video.mp4'),
  null, 'the owner cannot overwrite the published video');

select pg_temp.as_user('d1111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'match-videos'),
  2, 'the owner sees the upload and the published video');

select pg_temp.as_user('d2222222-2222-4222-8222-222222222222');
select is(
  (select string_agg(storage.filename(name), ',') from storage.objects where bucket_id = 'match-videos'),
  'video.mp4', 'a viewer of the shared match sees only the published video');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('match-videos', 'd1111111-1111-4111-8111-111111111111/daaaaaaa-0000-4000-8000-000000000001/upload.mp4')$$,
  '42501', null, 'and cannot upload into someone else''s match');

-- A video published before metadata removal (older apps): owner only.
reset role;
insert into public.matches (id, owner_id, discipline, variant, source, duration_ms)
  values ('daaaaaaa-0000-4000-8000-000000000002', 'd1111111-1111-4111-8111-111111111111', 'bjj', 'ibjjf', 'upload', 60000);
insert into storage.objects (bucket_id, name, created_at)
  values ('match-videos', 'd1111111-1111-4111-8111-111111111111/daaaaaaa-0000-4000-8000-000000000002/video.mp4', now() - interval '1 day');
insert into public.posts (id, author_id, match_id, body)
  values ('dbbbbbbb-0000-4000-8000-000000000002', 'd1111111-1111-4111-8111-111111111111', 'daaaaaaa-0000-4000-8000-000000000002', 'Old round');
update private.settings set value = (now() - interval '1 hour')::text where key = 'videos_clean_since';

select pg_temp.as_user('d2222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'match-videos' and name like '%daaaaaaa-0000-4000-8000-000000000002%'),
  0, 'viewers cannot watch a video uploaded before location metadata was removed');
select pg_temp.as_user('d1111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'match-videos' and name like '%daaaaaaa-0000-4000-8000-000000000002%'),
  1, 'its owner still can');

select * from finish();
rollback;
