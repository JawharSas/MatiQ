-- =============================================================================
-- The app's minimum version: readable by anyone (the app checks it before
-- signing in), changed only by the owner of the database.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

select is(
  (select public.app_requirements() ->> 'min_version'),
  '1.7.0',
  'the first version on Neon is the minimum'
);

set local role anonymous;
select is(
  (select public.app_requirements() ->> 'download_url'),
  'https://github.com/JawharSas/MatiQ/releases',
  'signed-out apps can read it'
);
select throws_ok(
  $$update app.release_policy set min_version = '0.0.1'$$,
  '42501',
  null,
  'signed-out apps cannot change it'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select * from app.release_policy$$,
  '42501',
  null,
  'signed-in people cannot read the table directly'
);
reset role;

select throws_ok(
  $$update app.release_policy set min_version = 'latest'$$,
  '23514',
  null,
  'the minimum is a plain version number'
);

select * from finish();
rollback;
