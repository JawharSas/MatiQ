-- =============================================================================
-- Sign-ups through Google: the profile takes the Google name, never a role,
-- and falls back safely when the name is missing or unsafe.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  -- What Google sends: no username or display_name.
  ('a1111111-1111-4111-8111-111111111111', 'grace@example.test',
   '{"full_name":"Grace Hopper","name":"Grace Hopper","email":"grace@example.test","email_verified":true,"role":"owner"}'),
  -- Only `name`, with stray spaces.
  ('a2222222-2222-4222-8222-222222222222', 'ada@example.test', '{"name":"  Ada  "}'),
  -- The email form's display_name wins over a provider name.
  ('a3333333-3333-4333-8333-333333333333', 'linus@example.test', '{"username":"linus","display_name":"Linus","full_name":"Linus T"}'),
  -- A bidi override in the Google name is not stored.
  ('a4444444-4444-4444-8444-444444444444', 'eve@example.test', json_build_object('full_name', 'Eve' || chr(8238) || 'txt')::jsonb),
  -- Longer than the 50-character limit.
  ('a5555555-5555-4555-8555-555555555555', 'long@example.test', json_build_object('full_name', repeat('x', 80))::jsonb);
-- Every test user has answered the age check (06 covers the check itself).
insert into private.age_checks (user_id, birth_month) select id, date '1990-01-01' from auth.users on conflict do nothing;

select is((select display_name from public.profiles where id = 'a1111111-1111-4111-8111-111111111111'),
  'Grace Hopper', 'a Google sign-up uses full_name as the display name');
select ok((select username::text from public.profiles where id = 'a1111111-1111-4111-8111-111111111111') like 'athlete_%',
  'a Google sign-up gets a generated username');
select is((select role::text from public.user_entitlements where user_id = 'a1111111-1111-4111-8111-111111111111'),
  'user', 'a role in provider metadata is ignored');
select is((select display_name from public.profiles where id = 'a2222222-2222-4222-8222-222222222222'),
  'Ada', 'name is used, trimmed, when full_name is missing');
select is((select display_name from public.profiles where id = 'a3333333-3333-4333-8333-333333333333'),
  'Linus', 'display_name from the sign-up form takes precedence');
select ok((select display_name from public.profiles where id = 'a4444444-4444-4444-8444-444444444444') like 'athlete_%',
  'an unsafe provider name falls back to the username');
select is((select char_length(display_name) from public.profiles where id = 'a5555555-5555-4555-8555-555555555555'),
  50, 'a long provider name is cut to 50 characters');

select * from finish();
rollback;
