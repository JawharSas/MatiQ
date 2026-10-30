-- =============================================================================
-- Videos up to 8 minutes for every account.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1111111-1111-4111-8111-111111111111', 'eight@example.test', '{"username":"eight_minutes"}'),
  ('b2222222-2222-4222-8222-222222222222', 'owner8@example.test', '{"username":"owner_eight"}');
update public.user_entitlements set role = 'owner' where user_id = 'b2222222-2222-4222-8222-222222222222';

select is((select max_video_seconds from public.user_entitlements where user_id = 'b1111111-1111-4111-8111-111111111111'), 480,
  'new accounts can analyse videos up to 8 minutes');
select is((select default_max_video_seconds from private.app_config), 480, 'the default for new accounts is 8 minutes');
select throws_ok(
  $$update public.user_entitlements set max_video_seconds = 481 where user_id = 'b1111111-1111-4111-8111-111111111111'$$,
  '23514', null, 'no account can go past 8 minutes');
select throws_ok($$update private.app_config set default_max_video_seconds = 600$$, '23514', null,
  'nor can the default for new accounts');

select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select throws_ok(
  $$select public.admin_update_entitlements('b1111111-1111-4111-8111-111111111111', p_max_video_seconds => 600)$$,
  '23514', null, 'the owner panel cannot raise it past 8 minutes either');
select lives_ok(
  $$select public.admin_update_entitlements('b1111111-1111-4111-8111-111111111111', p_max_video_seconds => 300)$$,
  'a shorter limit can still be set');
reset role;
select is((select max_video_seconds from public.user_entitlements where user_id = 'b1111111-1111-4111-8111-111111111111'), 300,
  'and is stored');

select * from finish();
rollback;
