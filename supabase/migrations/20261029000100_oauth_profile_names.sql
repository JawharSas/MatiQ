-- =============================================================================
-- MatIQ: profile names for Google sign-ups.
-- A Google account arrives with the person's name in `full_name` / `name`
-- instead of the `display_name` the email form sends. Use it as the display
-- name; the username stays a generated one that can be changed in the app.
-- The same validation applies to every source.
-- =============================================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text := new.raw_user_meta_data ->> 'username';
  requested_name text := left(btrim(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    ''
  )), 50);
  fallback_username text := 'athlete_' || substr(replace(new.id::text, '-', ''), 1, 12);
  config private.app_config;
begin
  select * into config from private.app_config limit 1;

  if requested_username is null or requested_username !~ '^[A-Za-z0-9_]{3,24}$' then
    requested_username := fallback_username;
  end if;
  if requested_name = '' or private.has_unsafe_chars(requested_name) then
    requested_name := requested_username;
  end if;

  begin
    insert into public.profiles (id, username, display_name) values (new.id, requested_username, requested_name);
  exception when unique_violation then
    insert into public.profiles (id, username, display_name) values (new.id, fallback_username, requested_name);
  end;

  insert into public.user_entitlements (user_id, monthly_analysis_limit, max_video_seconds)
  values (
    new.id,
    coalesce(config.default_monthly_analysis_limit, 10),
    coalesce(config.default_max_video_seconds, 600)
  );
  return new;
end;
$$;
