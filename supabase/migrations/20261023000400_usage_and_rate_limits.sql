-- =============================================================================
-- MatIQ: usage limits, rate limiting and service-only RPCs
-- =============================================================================
-- `svc_*` functions are called by Edge Functions with the service-role key.
-- They live in `public` so PostgREST can route them, but EXECUTE is revoked
-- from anon/authenticated so clients cannot call them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed window). Returns true when the call is allowed.
-- -----------------------------------------------------------------------------
create or replace function private.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  current_hits integer;
begin
  if p_key is null or char_length(p_key) > 200 or p_max < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  insert into private.rate_limits as r (key, window_start, hits)
  values (p_key, bucket, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into current_hits;

  -- Opportunistic cleanup keeps the table small without a cron job.
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;

  return current_hits <= p_max;
end;
$$;

-- Raises a 'P0429' error when the caller exceeds the limit (used inside RPCs).
create or replace function private.enforce_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.check_rate_limit(p_key, p_max, p_window_seconds) then
    raise exception 'rate limit exceeded' using errcode = 'P0429', hint = 'Try again later.';
  end if;
end;
$$;

create or replace function public.svc_check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.check_rate_limit(p_key, p_max, p_window_seconds);
$$;

-- -----------------------------------------------------------------------------
-- Quota reservation. Locks the user's entitlements row so concurrent requests
-- cannot both pass the check (no double-spend race).
-- -----------------------------------------------------------------------------
create or replace function public.svc_reserve_analysis(p_user_id uuid, p_match_id uuid, p_key_source text)
returns table (
  allowed boolean,
  reservation_id uuid,
  used integer,
  monthly_limit integer,
  is_unlimited boolean,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ent public.user_entitlements;
  period date := (date_trunc('month', now() at time zone 'utc'))::date;
  used_units integer;
  -- Bring-your-own-key analyses are paid by the user's own provider account,
  -- so they are recorded but do not consume the platform AI quota.
  units integer := case when p_key_source = 'byok' then 0 else 1 end;
  new_id uuid;
begin
  if p_key_source not in ('platform', 'byok') then
    raise exception 'invalid key source' using errcode = '22023';
  end if;

  select * into ent from public.user_entitlements where user_id = p_user_id for update;
  if not found then
    return query select false, null::uuid, 0, 0, false, 'no_entitlements'::text;
    return;
  end if;
  if ent.is_suspended then
    return query select false, null::uuid, 0, ent.monthly_analysis_limit, ent.is_unlimited, 'suspended'::text;
    return;
  end if;

  -- Release reservations abandoned by a crashed worker.
  update public.usage_ledger
  set status = 'refunded', settled_at = now()
  where user_id = p_user_id and status = 'reserved' and created_at < now() - interval '30 minutes';

  if exists (
    select 1 from public.usage_ledger where match_id = p_match_id and status = 'reserved'
  ) then
    return query select false, null::uuid, 0, ent.monthly_analysis_limit, ent.is_unlimited, 'already_processing'::text;
    return;
  end if;

  select coalesce(sum(l.units), 0)::integer into used_units
  from public.usage_ledger l
  where l.user_id = p_user_id and l.period_start = period and l.status in ('reserved', 'committed');

  if not ent.is_unlimited and used_units + units > ent.monthly_analysis_limit then
    return query select false, null::uuid, used_units, ent.monthly_analysis_limit, false, 'quota_exceeded'::text;
    return;
  end if;

  insert into public.usage_ledger (user_id, match_id, key_source, units, period_start)
  values (p_user_id, p_match_id, p_key_source, units, period)
  returning id into new_id;

  return query select true, new_id, used_units + units, ent.monthly_analysis_limit, ent.is_unlimited, null::text;
end;
$$;

create or replace function public.svc_settle_usage(p_reservation_id uuid, p_success boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.usage_ledger
  set status = case when p_success then 'committed' else 'refunded' end::public.usage_status,
      settled_at = now()
  where id = p_reservation_id and status = 'reserved';
$$;

-- -----------------------------------------------------------------------------
-- BYOK key storage (ciphertext only; encryption happens in the Edge Function).
-- -----------------------------------------------------------------------------
create or replace function public.svc_upsert_api_key(
  p_user_id uuid,
  p_provider text,
  p_ciphertext text,
  p_iv text,
  p_key_version smallint,
  p_last4 text,
  p_fingerprint text,
  p_label text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.user_api_keys (user_id, provider, ciphertext, iv, key_version, last4, fingerprint, label)
  values (p_user_id, p_provider, p_ciphertext, p_iv, p_key_version, p_last4, p_fingerprint, p_label)
  on conflict (user_id, provider) do update
  set ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      key_version = excluded.key_version,
      last4 = excluded.last4,
      fingerprint = excluded.fingerprint,
      label = excluded.label,
      created_at = now(),
      last_used_at = null;
$$;

create or replace function public.svc_get_api_key(p_user_id uuid, p_provider text)
returns table (id uuid, ciphertext text, iv text, key_version smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.ciphertext, k.iv, k.key_version
  from private.user_api_keys k
  where k.user_id = p_user_id and k.provider = p_provider;
$$;

create or replace function public.svc_touch_api_key(p_key_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.user_api_keys set last_used_at = now() where id = p_key_id;
$$;

create or replace function public.svc_list_api_keys(p_user_id uuid)
returns table (provider text, last4 text, label text, created_at timestamptz, last_used_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select k.provider, k.last4, k.label, k.created_at, k.last_used_at
  from private.user_api_keys k
  where k.user_id = p_user_id
  order by k.provider;
$$;

create or replace function public.svc_delete_api_key(p_user_id uuid, p_provider text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.user_api_keys where user_id = p_user_id and provider = p_provider;
  return found;
end;
$$;

-- Lists rows still encrypted under an old key version (for KEK rotation).
create or replace function public.svc_api_keys_needing_rotation(p_current_version smallint, p_limit integer default 100)
returns table (id uuid, user_id uuid, provider text, ciphertext text, iv text, key_version smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.user_id, k.provider, k.ciphertext, k.iv, k.key_version
  from private.user_api_keys k
  where k.key_version <> p_current_version
  order by k.created_at
  limit least(greatest(p_limit, 1), 1000);
$$;

create or replace function public.svc_rotate_api_key(p_key_id uuid, p_ciphertext text, p_iv text, p_key_version smallint)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.user_api_keys
  set ciphertext = p_ciphertext, iv = p_iv, key_version = p_key_version
  where id = p_key_id;
$$;

-- -----------------------------------------------------------------------------
-- Analysis worker state transitions.
-- -----------------------------------------------------------------------------
create or replace function public.svc_set_match_status(
  p_match_id uuid,
  p_status public.match_status,
  p_error_code text default null,
  p_frame_count integer default null,
  p_has_video boolean default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.matches
  set status = p_status,
      error_code = p_error_code,
      frame_count = coalesce(p_frame_count, frame_count),
      has_video = coalesce(p_has_video, has_video)
  where id = p_match_id;
$$;

create or replace function public.svc_save_analysis(
  p_match_id uuid,
  p_ruleset_version text,
  p_model text,
  p_events jsonb,
  p_scorecard jsonb,
  p_coaching_summary text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_owner uuid;
  analysis_id uuid;
begin
  select owner_id into match_owner from public.matches where id = p_match_id for update;
  if match_owner is null then
    raise exception 'match not found' using errcode = 'P0002';
  end if;

  insert into public.match_analyses (match_id, owner_id, ruleset_version, model, events, scorecard, coaching_summary)
  values (p_match_id, match_owner, p_ruleset_version, p_model, p_events, p_scorecard, p_coaching_summary)
  on conflict (match_id) do update
  set ruleset_version = excluded.ruleset_version,
      model = excluded.model,
      events = excluded.events,
      scorecard = excluded.scorecard,
      coaching_summary = excluded.coaching_summary,
      created_at = now()
  returning id into analysis_id;

  update public.matches set status = 'completed', error_code = null where id = p_match_id;
  return analysis_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- User-facing usage summary (security invoker: RLS limits it to the caller).
-- -----------------------------------------------------------------------------
create or replace function public.get_my_usage()
returns table (
  used integer,
  monthly_limit integer,
  is_unlimited boolean,
  is_suspended boolean,
  max_video_seconds integer,
  period_start date,
  resets_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with period as (
    select (date_trunc('month', now() at time zone 'utc'))::date as start
  )
  select
    coalesce((
      select sum(l.units)::integer from public.usage_ledger l, period
      where l.user_id = e.user_id and l.period_start = period.start and l.status in ('reserved', 'committed')
    ), 0),
    e.monthly_analysis_limit,
    e.is_unlimited,
    e.is_suspended,
    e.max_video_seconds,
    (select start from period),
    ((select start from period) + interval '1 month')::timestamp at time zone 'utc'
  from public.user_entitlements e
  where e.user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Function privileges.
-- -----------------------------------------------------------------------------
revoke execute on function
  public.svc_check_rate_limit(text, integer, integer),
  public.svc_reserve_analysis(uuid, uuid, text),
  public.svc_settle_usage(uuid, boolean),
  public.svc_upsert_api_key(uuid, text, text, text, smallint, text, text, text),
  public.svc_get_api_key(uuid, text),
  public.svc_touch_api_key(uuid),
  public.svc_list_api_keys(uuid),
  public.svc_delete_api_key(uuid, text),
  public.svc_api_keys_needing_rotation(smallint, integer),
  public.svc_rotate_api_key(uuid, text, text, smallint),
  public.svc_set_match_status(uuid, public.match_status, text, integer, boolean),
  public.svc_save_analysis(uuid, text, text, jsonb, jsonb, text)
from public, anon, authenticated;

grant execute on function
  public.svc_check_rate_limit(text, integer, integer),
  public.svc_reserve_analysis(uuid, uuid, text),
  public.svc_settle_usage(uuid, boolean),
  public.svc_upsert_api_key(uuid, text, text, text, smallint, text, text, text),
  public.svc_get_api_key(uuid, text),
  public.svc_touch_api_key(uuid),
  public.svc_list_api_keys(uuid),
  public.svc_delete_api_key(uuid, text),
  public.svc_api_keys_needing_rotation(smallint, integer),
  public.svc_rotate_api_key(uuid, text, text, smallint),
  public.svc_set_match_status(uuid, public.match_status, text, integer, boolean),
  public.svc_save_analysis(uuid, text, text, jsonb, jsonb, text)
to service_role;

revoke execute on function public.get_my_usage() from public, anon;
grant execute on function public.get_my_usage() to authenticated;

revoke execute on function
  private.check_rate_limit(text, integer, integer),
  private.enforce_rate_limit(text, integer, integer)
from public, anon, authenticated;
grant execute on function
  private.check_rate_limit(text, integer, integer),
  private.enforce_rate_limit(text, integer, integer)
to service_role;
