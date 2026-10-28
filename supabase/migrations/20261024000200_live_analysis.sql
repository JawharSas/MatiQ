-- =============================================================================
-- MatIQ: live (incremental) analysis while recording
-- =============================================================================
-- Flow:
--   live_start    reserve ONE quota unit for the match, status -> 'live'
--   live_batch    the app reports ~20 uploaded frame timestamps; the server
--                 claims them (no overlap, frame budget) and analyses them
--   live_finalize analyse only frames no batch covered, score, save, commit
--   live_cancel   refund and end the session
-- Each frame is sent to the AI at most once per match, so live scoring costs
-- the same as post-recording analysis.
-- =============================================================================

-- One row per live session; holds the quota reservation and the analysis
-- options chosen at start. Service-only.
create table private.live_sessions (
  match_id uuid primary key references public.matches (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  reservation_id uuid not null references public.usage_ledger (id) on delete cascade,
  key_source text not null constraint live_key_source check (key_source in ('platform', 'byok')),
  athlete_a text constraint live_athlete_a check (char_length(athlete_a) <= 80),
  athlete_b text constraint live_athlete_b check (char_length(athlete_b) <= 80),
  created_at timestamptz not null default now()
);

alter table private.live_sessions enable row level security;
revoke all on private.live_sessions from anon, authenticated;
grant all on private.live_sessions to service_role;

-- Analysed batches. Owners can read their own (the app computes a
-- provisional score from them during recording); only the service writes.
create table public.match_live_batches (
  match_id uuid not null references public.matches (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  batch_index integer not null constraint batch_index_range check (batch_index between 0 and 499),
  frame_ts integer[] not null constraint frame_ts_size check (cardinality(frame_ts) between 1 and 100),
  status text not null default 'processing' constraint batch_status check (status in ('processing', 'done', 'failed')),
  events jsonb not null default '[]'::jsonb constraint batch_events_array check (jsonb_typeof(events) = 'array'),
  observations jsonb not null default '[]'::jsonb constraint batch_observations_array check (jsonb_typeof(observations) = 'array'),
  error_code text constraint batch_error_code check (error_code ~ '^[a-z_]{1,48}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, batch_index)
);

create index match_live_batches_owner_idx on public.match_live_batches (owner_id);

create trigger match_live_batches_touch_updated_at
  before update on public.match_live_batches
  for each row execute function private.touch_updated_at();

alter table public.match_live_batches enable row level security;
revoke all on public.match_live_batches from anon, authenticated;
grant select on public.match_live_batches to authenticated;
grant all on public.match_live_batches to service_role;

create policy match_live_batches_select_own on public.match_live_batches
  for select to authenticated
  using (owner_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.match_live_batches;
  end if;
end;
$$;

-- Duration may also be finalised while a live session is running.
create or replace function private.guard_match_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status not in ('draft', 'live')
     and (new.duration_ms is distinct from old.duration_ms
          or new.round_duration_ms is distinct from old.round_duration_ms)
     and current_user = 'authenticated' then
    raise exception 'duration cannot change after analysis was requested' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Reservations now live as long as the longest allowed recording plus a
-- margin (live sessions keep theirs open while recording), instead of a
-- fixed 30 minutes.
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

  -- Release reservations abandoned by a crashed worker or an app that never
  -- finalised its live session.
  update public.usage_ledger
  set status = 'refunded', settled_at = now()
  where user_id = p_user_id
    and status = 'reserved'
    and created_at < now() - make_interval(secs => greatest(1800, ent.max_video_seconds * 2 + 900));

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

-- -----------------------------------------------------------------------------
-- Service RPCs for live sessions.
-- -----------------------------------------------------------------------------
create or replace function public.svc_start_live_session(
  p_match_id uuid,
  p_reservation_id uuid,
  p_key_source text,
  p_athlete_a text,
  p_athlete_b text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_owner uuid;
begin
  select owner_id into match_owner from public.matches where id = p_match_id and status = 'draft' for update;
  if match_owner is null then
    raise exception 'match is not a draft' using errcode = 'P0002';
  end if;
  insert into private.live_sessions (match_id, owner_id, reservation_id, key_source, athlete_a, athlete_b)
  values (p_match_id, match_owner, p_reservation_id, p_key_source, p_athlete_a, p_athlete_b);
  update public.matches set status = 'live', error_code = null where id = p_match_id;
end;
$$;

create or replace function public.svc_get_live_session(p_match_id uuid)
returns table (owner_id uuid, reservation_id uuid, key_source text, athlete_a text, athlete_b text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.owner_id, s.reservation_id, s.key_source, s.athlete_a, s.athlete_b
  from private.live_sessions s
  where s.match_id = p_match_id;
$$;

-- Claims frames for a batch atomically. Returns 'claimed', 'duplicate',
-- 'overlap', 'frame_budget_exceeded' or 'no_session'.
create or replace function public.svc_claim_live_batch(
  p_match_id uuid,
  p_batch_index integer,
  p_frame_ts integer[],
  p_max_frames integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_owner uuid;
  already_claimed integer;
begin
  select owner_id into session_owner from private.live_sessions where match_id = p_match_id for update;
  if session_owner is null then
    return 'no_session';
  end if;
  if exists (select 1 from public.match_live_batches where match_id = p_match_id and batch_index = p_batch_index) then
    return 'duplicate';
  end if;
  if exists (
    select 1 from public.match_live_batches
    where match_id = p_match_id and status <> 'failed' and frame_ts && p_frame_ts
  ) then
    return 'overlap';
  end if;

  select coalesce(sum(cardinality(frame_ts)), 0) into already_claimed
  from public.match_live_batches
  where match_id = p_match_id and status <> 'failed';
  if already_claimed + cardinality(p_frame_ts) > p_max_frames then
    return 'frame_budget_exceeded';
  end if;

  insert into public.match_live_batches (match_id, owner_id, batch_index, frame_ts)
  values (p_match_id, session_owner, p_batch_index, p_frame_ts);
  return 'claimed';
end;
$$;

create or replace function public.svc_complete_live_batch(
  p_match_id uuid,
  p_batch_index integer,
  p_status text,
  p_events jsonb,
  p_observations jsonb,
  p_error_code text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.match_live_batches
  set status = p_status,
      events = coalesce(p_events, '[]'::jsonb),
      observations = coalesce(p_observations, '[]'::jsonb),
      error_code = p_error_code
  where match_id = p_match_id and batch_index = p_batch_index;
$$;

-- Ends a session and returns its reservation id (null when there was none).
create or replace function public.svc_end_live_session(p_match_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  delete from private.live_sessions where match_id = p_match_id returning reservation_id;
$$;

revoke execute on function
  public.svc_reserve_analysis(uuid, uuid, text),
  public.svc_start_live_session(uuid, uuid, text, text, text),
  public.svc_get_live_session(uuid),
  public.svc_claim_live_batch(uuid, integer, integer[], integer),
  public.svc_complete_live_batch(uuid, integer, text, jsonb, jsonb, text),
  public.svc_end_live_session(uuid)
from public, anon, authenticated;

grant execute on function
  public.svc_reserve_analysis(uuid, uuid, text),
  public.svc_start_live_session(uuid, uuid, text, text, text),
  public.svc_get_live_session(uuid),
  public.svc_claim_live_batch(uuid, integer, integer[], integer),
  public.svc_complete_live_batch(uuid, integer, text, jsonb, jsonb, text),
  public.svc_end_live_session(uuid)
to service_role;
