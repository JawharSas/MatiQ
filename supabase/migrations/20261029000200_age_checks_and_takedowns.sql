-- =============================================================================
-- MatIQ: age check (COPPA) and copyright takedowns (DMCA).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Age check. Everyone gives a birth month and year once (neutral age screen).
-- A row exists only for people who are clearly at least 13; nothing is stored
-- for younger people, whose account the account Edge Function deletes.
-- -----------------------------------------------------------------------------
create table private.age_checks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  birth_month date not null
    constraint birth_month_first_day check (extract(day from birth_month) = 1),
  checked_at timestamptz not null default now()
);

alter table private.age_checks enable row level security;
revoke all on private.age_checks from public, anon, authenticated;

-- With month precision the 13th birthday may still be later in the current
-- month, so it only counts from the following month.
create or replace function private.meets_minimum_age(p_year integer, p_month integer, p_today date default current_date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (extract(year from p_today)::integer * 12 + extract(month from p_today)::integer) - (p_year * 12 + p_month) > 13 * 12;
$$;

-- Called by the account Edge Function only. The first answer counts: a later
-- call cannot move an existing date (but an under-13 answer still reports so).
create or replace function public.svc_record_age(p_user_id uuid, p_year integer, p_month integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_month is null or p_month < 1 or p_month > 12 or p_year is null or p_year < 1900 then
    raise exception 'invalid birth month' using errcode = '22023';
  end if;
  if make_date(p_year, p_month, 1) > current_date then
    raise exception 'invalid birth month' using errcode = '22023';
  end if;
  if not private.meets_minimum_age(p_year, p_month) then
    return 'under_minimum_age';
  end if;
  insert into private.age_checks (user_id, birth_month)
  values (p_user_id, make_date(p_year, p_month, 1))
  on conflict (user_id) do nothing;
  return 'ok';
end;
$$;

-- For the data export (the private schema is not exposed to the Data API).
create or replace function public.svc_export_age_check(p_user_id uuid)
returns table (birth_month date, checked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.birth_month, a.checked_at from private.age_checks a where a.user_id = p_user_id;
$$;

revoke execute on function public.svc_record_age(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.svc_export_age_check(uuid) from public, anon, authenticated;
grant execute on function public.svc_record_age(uuid, integer, integer) to service_role;
grant execute on function public.svc_export_age_check(uuid) to service_role;

-- Whether the signed-in user has answered the age check (never the date itself).
create or replace function public.my_age_check()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.age_checks where user_id = (select auth.uid()));
$$;

revoke execute on function public.my_age_check() from public, anon;
grant execute on function public.my_age_check() to authenticated;

-- -----------------------------------------------------------------------------
-- Copyright takedowns: the owner removes a post named in a notice. Audited
-- with the author as target, which is also the record for the
-- repeat-infringer policy (repeat infringers are suspended with
-- admin_update_entitlements).
-- -----------------------------------------------------------------------------
create or replace function public.admin_remove_post(p_post_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
  removed public.posts;
begin
  perform private.enforce_rate_limit('admin_write:' || actor, 60, 60);
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  delete from public.posts where id = p_post_id returning * into removed;
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;

  insert into private.admin_audit_log (actor_id, target_user_id, action, old_value, new_value, reason)
  values (
    actor,
    removed.author_id,
    'remove_post',
    jsonb_build_object(
      'post_id', removed.id,
      'match_id', removed.match_id,
      'created_at', removed.created_at,
      'body', left(removed.body, 280)
    ),
    null,
    left(btrim(p_reason), 280)
  );
end;
$$;

revoke execute on function public.admin_remove_post(uuid, text) from public, anon;
grant execute on function public.admin_remove_post(uuid, text) to authenticated;
