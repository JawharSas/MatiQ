-- =============================================================================
-- register_user reads the request's claims through app.claims().
--
-- It asked pg_session_jwt (auth.user_id()) first. On a new database
-- connection that loads the extension inside this SECURITY DEFINER function,
-- and Postgres then drops the claims the Data API set for the request, so
-- the first call after sign-in on a new connection answered "not signed in"
-- (42501) and the app stopped on its error screen. app.claims() (compat.sql)
-- reads the claims setting directly. Otherwise unchanged from
-- 20261101000200_register_before_age_check.
-- =============================================================================

create or replace function public.register_user(p_username text default null, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject text := app.claims() ->> 'sub';
  existing uuid;
  created uuid;
begin
  if subject is null or subject = '' then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if private.ip_is_banned(private.request_ips()) then
    raise exception using errcode = '42501', message = 'banned', hint = 'This account or network is banned from MatIQ.';
  end if;
  select u.id into existing from app.users u where u.clerk_id = subject;
  if existing is not null then
    if private.is_banned(existing) then
      raise exception using errcode = '42501', message = 'banned', hint = 'This account or network is banned from MatIQ.';
    end if;
    return existing;
  end if;
  perform private.enforce_rate_limit('register:' || subject, 5, 3600);
  insert into app.users (clerk_id, raw_user_meta_data)
  values (
    subject,
    jsonb_strip_nulls(jsonb_build_object(
      'username', left(btrim(p_username), 24),
      'display_name', left(btrim(p_display_name), 50)
    ))
  )
  on conflict (clerk_id) do nothing
  returning id into created;
  return coalesce(created, (select u.id from app.users u where u.clerk_id = subject));
end;
$$;
