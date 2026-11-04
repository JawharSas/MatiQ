-- =============================================================================
-- Reserved names: only the listed email's account may use them; everyone
-- else gets "already taken" (or a generated name at sign-up), however the
-- name is written.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

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

select is(private.name_key('Coach Max'), 'coachmax', 'spaces and case do not matter');
select is(private.name_key('C0ach_M@x'), 'coachmax', 'nor look-alike characters and punctuation');

insert into private.reserved_names (name_key, owner_email) values
  ('coachmax', 'coach.max@example.test'),
  ('coachmaxwell', 'coach.max@example.test'),
  ('max', 'coach.max@example.test');

-- The owner's account (imported with its email) and someone else's.
insert into app.users (clerk_id, email, raw_user_meta_data)
values ('user_owner', 'Coach.Max@example.test', '{"username": "CoachMax", "display_name": "Coach Max"}');
insert into app.users (clerk_id, email, raw_user_meta_data)
values ('user_other', 'someone@example.test', '{"username": "fighter_one", "display_name": "Fighter One"}');
select public.svc_record_age(id, 1995, 6) from app.users where clerk_id in ('user_owner', 'user_other');

select is(
  (select username::text from public.profiles p join app.users u on u.id = p.id where u.clerk_id = 'user_owner'),
  'CoachMax', 'the owner keeps the reserved username'
);

-- Someone else trying them ---------------------------------------------------------------
select pg_temp.as_clerk('user_other');
select throws_ok($$update public.profiles set username = 'CoachMax' where id = app.uid()$$, '23505', null, 'CoachMax is "taken"');
select throws_ok($$update public.profiles set username = 'coach_max' where id = app.uid()$$, '23505', null, 'so is coach_max');
select throws_ok($$update public.profiles set username = 'CoachMaxwell' where id = app.uid()$$, '23505', null, 'and CoachMaxwell');
select throws_ok($$update public.profiles set username = 'Max' where id = app.uid()$$, '23505', null, 'and Max');
select throws_ok($$update public.profiles set username = 'M4X' where id = app.uid()$$, '23505', null, 'and M4X');
select throws_ok($$update public.profiles set display_name = 'Coach Maxwell' where id = app.uid()$$, '23505', null, 'display names too');
select throws_ok($$update public.profiles set display_name = 'C0ACH MAX' where id = app.uid()$$, '23505', null, 'however they are written');
select lives_ok($$update public.profiles set display_name = 'Maxine' where id = app.uid()$$, 'names that only contain one are fine');
select lives_ok($$update public.profiles set bio = 'Wrestler' where id = app.uid()$$, 'other changes are unaffected');

-- The owner can use any of them ---------------------------------------------------------
select pg_temp.as_clerk('user_owner');
select lives_ok($$update public.profiles set username = 'Max', display_name = 'Coach Maxwell' where id = app.uid()$$, 'the owner can switch between them');

-- Signing up with one ---------------------------------------------------------------------
select pg_temp.as_clerk('user_newcomer', 'GET');
select ok(public.register_user('CoachMaxwell', 'Coach Max') is not null, 'a new account with a reserved name still opens');
select pg_temp.as_backend();
select ok(
  (select username::text from public.profiles p join app.users u on u.id = p.id where u.clerk_id = 'user_newcomer') like 'athlete\_%',
  'with a generated username'
);
select ok(
  (select private.name_key(display_name) from public.profiles p join app.users u on u.id = p.id where u.clerk_id = 'user_newcomer') <> 'coachmax',
  'and not the reserved display name'
);

select * from finish();
rollback;
