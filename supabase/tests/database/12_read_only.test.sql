-- =============================================================================
-- Read-only mode for the move to Neon: reads go on, writes are refused.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create function pg_temp.as_user(uid uuid, method text) returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('request.method', method, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1111111-1111-4111-8111-111111111111', 'reader@example.test', '{"username":"read_only_test"}');
insert into private.age_checks (user_id, birth_month) values ('c1111111-1111-4111-8111-111111111111', '1990-05-01');

select is(private.read_only(), false, 'off unless turned on');
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111', 'POST');
select lives_ok($$select public.check_request()$$, 'writes go through while it is off');
reset role;

insert into private.settings (key, value) values ('read_only', 'on')
on conflict (key) do update set value = excluded.value;

select pg_temp.as_user('c1111111-1111-4111-8111-111111111111', 'POST');
select throws_ok($$select public.check_request()$$, '42501', 'update_required', 'every API write is refused once it is on');
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111', 'GET');
select lives_ok($$select public.check_request()$$, 'reading goes on');
select is((select count(*)::int from public.profiles where id = 'c1111111-1111-4111-8111-111111111111'), 1, 'the person still sees their profile');
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111', 'POST');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('avatars', 'c1111111-1111-4111-8111-111111111111/pending.jpg', 'c1111111-1111-4111-8111-111111111111')$$,
  '42501', null, 'no uploads');
reset role;

select is(public.svc_read_only(), true, 'the Edge Functions see it too');
select ok(not has_function_privilege('anon', 'public.svc_read_only()', 'execute'), 'only the service role asks the functions'' question');

reset role;
select set_config('request.method', '', true);
select * from finish();
rollback;
