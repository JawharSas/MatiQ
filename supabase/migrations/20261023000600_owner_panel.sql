-- =============================================================================
-- MatIQ: owner panel (admin) RPCs
-- =============================================================================
-- Every function starts with private.require_owner(), which checks the
-- caller's role in user_entitlements on every call (JWT claims are never
-- trusted for authorization) and, when enabled, requires an MFA session.
-- Every mutation is written to the append-only private.admin_audit_log.
-- =============================================================================

create or replace function public.admin_search_users(p_query text default '', p_limit integer default 25, p_offset integer default 0)
returns table (
  user_id uuid,
  username extensions.citext,
  display_name text,
  email text,
  role public.app_role,
  is_unlimited boolean,
  is_suspended boolean,
  monthly_analysis_limit integer,
  max_video_seconds integer,
  used_this_month integer,
  total_analyses bigint,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
  cleaned text := left(btrim(coalesce(p_query, '')), 100);
  pattern text := replace(replace(replace(cleaned, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  exact_id uuid := private.try_uuid(cleaned);
  period date := (date_trunc('month', now() at time zone 'utc'))::date;
begin
  perform private.enforce_rate_limit('admin_search:' || actor, 120, 60);

  return query
    select
      p.id,
      p.username,
      p.display_name,
      u.email::text,
      e.role,
      e.is_unlimited,
      e.is_suspended,
      e.monthly_analysis_limit,
      e.max_video_seconds,
      coalesce((
        select sum(l.units)::integer from public.usage_ledger l
        where l.user_id = p.id and l.period_start = period and l.status in ('reserved', 'committed')
      ), 0),
      (select count(*) from public.usage_ledger l where l.user_id = p.id and l.status = 'committed'),
      p.created_at,
      u.last_sign_in_at
    from public.profiles p
    join public.user_entitlements e on e.user_id = p.id
    join auth.users u on u.id = p.id
    where cleaned = ''
       or p.id = exact_id
       or p.username::text ilike pattern
       or u.email::text ilike pattern
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_set_unlimited(p_user_id uuid, p_value boolean, p_reason text default null)
returns public.user_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
  before_row public.user_entitlements;
  after_row public.user_entitlements;
begin
  perform private.enforce_rate_limit('admin_write:' || actor, 60, 60);

  select * into before_row from public.user_entitlements where user_id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  update public.user_entitlements
  set is_unlimited = p_value, updated_by = actor
  where user_id = p_user_id
  returning * into after_row;

  insert into private.admin_audit_log (actor_id, target_user_id, action, old_value, new_value, reason)
  values (
    actor, p_user_id, 'set_unlimited',
    jsonb_build_object('is_unlimited', before_row.is_unlimited),
    jsonb_build_object('is_unlimited', after_row.is_unlimited),
    left(p_reason, 280)
  );
  return after_row;
end;
$$;

create or replace function public.admin_update_entitlements(
  p_user_id uuid,
  p_monthly_analysis_limit integer default null,
  p_max_video_seconds integer default null,
  p_is_suspended boolean default null,
  p_suspended_reason text default null,
  p_reason text default null
)
returns public.user_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
  before_row public.user_entitlements;
  after_row public.user_entitlements;
begin
  perform private.enforce_rate_limit('admin_write:' || actor, 60, 60);

  select * into before_row from public.user_entitlements where user_id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if p_is_suspended is true and (before_row.role = 'owner' or p_user_id = actor) then
    raise exception 'owners cannot be suspended' using errcode = '42501';
  end if;

  update public.user_entitlements
  set monthly_analysis_limit = coalesce(p_monthly_analysis_limit, monthly_analysis_limit),
      max_video_seconds = coalesce(p_max_video_seconds, max_video_seconds),
      is_suspended = coalesce(p_is_suspended, is_suspended),
      suspended_reason = case
        when coalesce(p_is_suspended, is_suspended) then left(coalesce(p_suspended_reason, suspended_reason), 280)
        else null
      end,
      updated_by = actor
  where user_id = p_user_id
  returning * into after_row;

  insert into private.admin_audit_log (actor_id, target_user_id, action, old_value, new_value, reason)
  values (
    actor, p_user_id, 'update_entitlements',
    jsonb_build_object(
      'monthly_analysis_limit', before_row.monthly_analysis_limit,
      'max_video_seconds', before_row.max_video_seconds,
      'is_suspended', before_row.is_suspended
    ),
    jsonb_build_object(
      'monthly_analysis_limit', after_row.monthly_analysis_limit,
      'max_video_seconds', after_row.max_video_seconds,
      'is_suspended', after_row.is_suspended
    ),
    left(p_reason, 280)
  );
  return after_row;
end;
$$;

create or replace function public.admin_usage_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
  period date := (date_trunc('month', now() at time zone 'utc'))::date;
  overview jsonb;
begin
  perform private.enforce_rate_limit('admin_search:' || actor, 120, 60);

  select jsonb_build_object(
    'period_start', period,
    'total_users', (select count(*) from public.user_entitlements),
    'unlimited_users', (select count(*) from public.user_entitlements where is_unlimited),
    'suspended_users', (select count(*) from public.user_entitlements where is_suspended),
    'analyses_this_month', (
      select count(*) from public.usage_ledger where period_start = period and status = 'committed'
    ),
    'platform_units_this_month', (
      select coalesce(sum(units), 0) from public.usage_ledger where period_start = period and status = 'committed'
    ),
    'byok_analyses_this_month', (
      select count(*) from public.usage_ledger
      where period_start = period and status = 'committed' and key_source = 'byok'
    ),
    'active_users_this_month', (
      select count(distinct user_id) from public.usage_ledger where period_start = period and status = 'committed'
    ),
    'top_users', coalesce((
      select jsonb_agg(t order by t.units desc)
      from (
        select l.user_id, p.username, sum(l.units)::integer as units, count(*)::integer as analyses
        from public.usage_ledger l
        join public.profiles p on p.id = l.user_id
        where l.period_start = period and l.status = 'committed'
        group by l.user_id, p.username
        order by sum(l.units) desc
        limit 10
      ) t
    ), '[]'::jsonb)
  ) into overview;
  return overview;
end;
$$;

create or replace function public.admin_audit_log(p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint,
  actor_id uuid,
  actor_username extensions.citext,
  target_user_id uuid,
  target_username extensions.citext,
  action text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_owner();
  return query
    select a.id, a.actor_id, ap.username, a.target_user_id, tp.username, a.action, a.old_value, a.new_value, a.reason, a.created_at
    from private.admin_audit_log a
    left join public.profiles ap on ap.id = a.actor_id
    left join public.profiles tp on tp.id = a.target_user_id
    where p_before is null or a.id < p_before
    order by a.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- Lets the app decide whether to show the Owner Panel entry point. This is a
-- UX hint only; every admin RPC re-checks authorization server side.
create or replace function public.am_i_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner(auth.uid());
$$;

revoke execute on function
  public.admin_search_users(text, integer, integer),
  public.admin_set_unlimited(uuid, boolean, text),
  public.admin_update_entitlements(uuid, integer, integer, boolean, text, text),
  public.admin_usage_overview(),
  public.admin_audit_log(integer, bigint),
  public.am_i_owner()
from public, anon;

grant execute on function
  public.admin_search_users(text, integer, integer),
  public.admin_set_unlimited(uuid, boolean, text),
  public.admin_update_entitlements(uuid, integer, integer, boolean, text, text),
  public.admin_usage_overview(),
  public.admin_audit_log(integer, bigint),
  public.am_i_owner()
to authenticated;

-- -----------------------------------------------------------------------------
-- Bootstrapping the first owner (run once, from the SQL editor or psql, as a
-- privileged role - never from the app):
--
--   update public.user_entitlements
--   set role = 'owner', is_unlimited = true
--   where user_id = (select id from auth.users where email = 'you@example.com');
-- -----------------------------------------------------------------------------
