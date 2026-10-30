-- =============================================================================
-- The oldest app version that may still be used, and where to get a newer one.
--
-- The app reads it at start (before signing in) and, when it is older, shows
-- a full-screen "Update MatIQ" with the download link instead of the app.
-- Raise it to make everyone update, e.g. after a change old versions can't
-- work with:
--
--   update app.release_policy set min_version = '1.8.0', updated_at = now();
-- =============================================================================

create table if not exists app.release_policy (
  id boolean primary key default true constraint release_policy_single check (id),
  min_version text not null constraint release_policy_version check (min_version ~ '^\d{1,3}\.\d{1,3}\.\d{1,3}$'),
  download_url text not null constraint release_policy_url check (download_url ~ '^https://'),
  updated_at timestamptz not null default now()
);
revoke all on app.release_policy from public, anon, anonymous, authenticated;

insert into app.release_policy (min_version, download_url)
values ('1.7.0', 'https://github.com/JawharSas/MatiQ/releases')
on conflict (id) do nothing;

create or replace function public.app_requirements()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('min_version', p.min_version, 'download_url', p.download_url)
  from app.release_policy p;
$$;

revoke execute on function public.app_requirements() from public;
grant execute on function public.app_requirements() to anonymous, anon, authenticated, service_role;
