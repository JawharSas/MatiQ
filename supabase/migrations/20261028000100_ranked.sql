-- =============================================================================
-- Ranked ladder: challenges, opponent-confirmed results, Elo ratings, rating
-- history and dynamic titles.
--
-- Lifecycle of a ranked match (public.ranked_matches.status):
--
--   pending --accept--> accepted --link match + analysis completes--> awaiting_confirmation
--      |                  |                                              |  both confirm, or the
--   declined /         cancelled / expired                               |  72 h window passes
--   cancelled / expired                                                  v  without a dispute (*)
--                                                     disputed <---- confirmed (Elo applied)
--                                                        | owner: apply -> awaiting (forced ready)
--                                                        | owner: void  -> voided
--
-- (*) A win the recorder claims for themselves never auto-confirms: Fighter 2
--     must confirm it, otherwise it is voided 7 days after the analysis. This
--     stops a recorder from banking wins from videos the opponent never saw.
-- Anti-farming: at most 3 ranked matches per pair in any 7 days.
--
-- The fighter who records is Fighter 1 (athlete A in the analysis); the other
-- participant is Fighter 2 (athlete B) and can watch the video and scorecard
-- to confirm or dispute. Ratings are only ever written by the `ranked` Edge
-- Function through svc_apply_ranked_result, which checks row versions so two
-- matches settling at once cannot overwrite each other.
-- =============================================================================

create type public.ranked_status as enum (
  'pending', 'accepted', 'declined', 'cancelled', 'expired',
  'awaiting_confirmation', 'disputed', 'confirmed', 'voided'
);

-- Ratings ------------------------------------------------------------------------
create table public.ranked_ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  discipline public.discipline not null,
  rating integer not null default 1000 constraint rating_range check (rating between 100 and 4000),
  games integer not null default 0 constraint games_range check (games >= 0),
  wins integer not null default 0 constraint wins_range check (wins >= 0),
  losses integer not null default 0 constraint losses_range check (losses >= 0),
  draws integer not null default 0 constraint draws_range check (draws >= 0),
  current_streak integer not null default 0 constraint streak_range check (current_streak >= 0),
  peak_rating integer not null default 1000 constraint peak_range check (peak_rating between 100 and 4000),
  -- Career totals for titles (packages/rules-engine/src/ranking/career.ts).
  totals jsonb not null default '{}'::jsonb
    constraint totals_object check (jsonb_typeof(totals) = 'object' and pg_column_size(totals) < 8192),
  -- Optimistic concurrency token, bumped on every settled match.
  version integer not null default 0,
  last_match_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, discipline)
);

create index ranked_ratings_ladder_idx on public.ranked_ratings (discipline, rating desc);

create trigger ranked_ratings_touch_updated_at
  before update on public.ranked_ratings
  for each row execute function private.touch_updated_at();

-- Matches --------------------------------------------------------------------------
create table public.ranked_matches (
  id uuid primary key default gen_random_uuid(),
  discipline public.discipline not null,
  variant text not null constraint ranked_variant_format check (variant ~ '^[a-z_]{2,32}$'),
  challenger_id uuid not null references auth.users (id) on delete cascade,
  opponent_id uuid not null references auth.users (id) on delete cascade,
  message text
    constraint ranked_message_length check (char_length(message) <= 140)
    constraint ranked_message_safe check (not private.has_unsafe_chars(message)),
  status public.ranked_status not null default 'pending',
  match_id uuid unique references public.matches (id) on delete set null,
  -- Fighter 1 recorded the match (athlete A); Fighter 2 is the other participant.
  fighter_a_id uuid references auth.users (id) on delete cascade,
  fighter_b_id uuid references auth.users (id) on delete cascade,
  winner_id uuid references auth.users (id) on delete set null,
  result_method text constraint ranked_method_format check (result_method ~ '^[a-z_]{2,32}$'),
  confirmed_a_at timestamptz,
  confirmed_b_at timestamptz,
  confirm_by timestamptz,
  dispute_reason text
    constraint ranked_dispute_length check (char_length(dispute_reason) between 1 and 280)
    constraint ranked_dispute_safe check (not private.has_unsafe_chars(dispute_reason, true)),
  disputed_by uuid references auth.users (id) on delete set null,
  rating_a_before integer,
  rating_a_after integer,
  rating_b_before integer,
  rating_b_after integer,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  recorded_at timestamptz,
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ranked_distinct_fighters check (challenger_id <> opponent_id),
  constraint ranked_fighters_are_participants check (
    (fighter_a_id is null and fighter_b_id is null)
    or (fighter_a_id in (challenger_id, opponent_id) and fighter_b_id in (challenger_id, opponent_id) and fighter_a_id <> fighter_b_id)
  )
);

-- One open ranked match per pair and discipline.
create unique index ranked_matches_one_open_per_pair on public.ranked_matches (
  least(challenger_id, opponent_id), greatest(challenger_id, opponent_id), discipline
) where status in ('pending', 'accepted', 'awaiting_confirmation', 'disputed');

create index ranked_matches_challenger_idx on public.ranked_matches (challenger_id, created_at desc);
create index ranked_matches_opponent_idx on public.ranked_matches (opponent_id, created_at desc);
create index ranked_matches_disputed_idx on public.ranked_matches (updated_at desc) where status = 'disputed';

create trigger ranked_matches_touch_updated_at
  before update on public.ranked_matches
  for each row execute function private.touch_updated_at();

-- History and titles ---------------------------------------------------------------
create table public.rating_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  discipline public.discipline not null,
  ranked_match_id uuid references public.ranked_matches (id) on delete set null,
  opponent_id uuid references auth.users (id) on delete set null,
  outcome text not null constraint history_outcome check (outcome in ('win', 'loss', 'draw')),
  rating_before integer not null,
  rating_after integer not null,
  delta integer not null,
  created_at timestamptz not null default now()
);

create index rating_history_user_idx on public.rating_history (user_id, discipline, created_at desc);

create table public.user_titles (
  user_id uuid not null references auth.users (id) on delete cascade,
  title_id text not null constraint title_id_format check (title_id ~ '^[a-z_]{2,40}$'),
  discipline public.discipline not null,
  ranked_match_id uuid references public.ranked_matches (id) on delete set null,
  is_featured boolean not null default false,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, title_id)
);

create unique index user_titles_one_featured on public.user_titles (user_id) where is_featured;

-- Access ---------------------------------------------------------------------------
alter table public.ranked_ratings enable row level security;
alter table public.ranked_matches enable row level security;
alter table public.rating_history enable row level security;
alter table public.user_titles enable row level security;

revoke all on public.ranked_ratings, public.ranked_matches, public.rating_history, public.user_titles from anon, authenticated;
grant select on public.ranked_ratings, public.ranked_matches, public.rating_history, public.user_titles to authenticated;
grant all on public.ranked_ratings, public.ranked_matches, public.rating_history, public.user_titles to service_role;

-- Ratings and titles follow the profile privacy rule: own, friends, or public accounts.
create policy ranked_ratings_select on public.ranked_ratings
  for select to authenticated
  using (private.can_view_author_content((select auth.uid()), user_id, false));

create policy user_titles_select on public.user_titles
  for select to authenticated
  using (private.can_view_author_content((select auth.uid()), user_id, false));

-- Only participants see a ranked match; history names opponents, so it is own-only.
create policy ranked_matches_select on public.ranked_matches
  for select to authenticated
  using ((select auth.uid()) in (challenger_id, opponent_id));

create policy rating_history_select on public.rating_history
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Two-factor rule (see 20261024000300_mfa_enforcement.sql).
create policy ranked_ratings_require_mfa on public.ranked_ratings as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));
create policy ranked_matches_require_mfa on public.ranked_matches as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));
create policy rating_history_require_mfa on public.rating_history as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));
create policy user_titles_require_mfa on public.user_titles as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ranked_matches;
  end if;
end;
$$;

-- Fighter 2 can watch the recording and read the analysis they must confirm;
-- the owner can while a dispute about it is open.
create or replace function private.can_view_match(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and (
        m.owner_id = auth.uid()
        or exists (
          select 1 from public.posts p
          where p.match_id = m.id
            and private.can_view_author_content(auth.uid(), p.author_id, p.friends_only)
        )
        or exists (
          select 1 from public.ranked_matches r
          where r.match_id = m.id
            and auth.uid() in (r.fighter_a_id, r.fighter_b_id)
            and not private.is_blocked_between(r.fighter_a_id, r.fighter_b_id)
        )
        -- The owner reviews the recording of a disputed result (and only then).
        or (
          exists (select 1 from public.ranked_matches r where r.match_id = m.id and r.status = 'disputed')
          and private.is_owner(auth.uid())
        )
      )
  );
$$;

-- Helpers --------------------------------------------------------------------------
create or replace function private.ranked_require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if private.is_suspended(me) then
    raise exception 'account suspended' using errcode = '42501', hint = 'account_suspended';
  end if;
  return me;
end;
$$;

-- Lazy expiry: challenges never recorded expire; a recorder's own win that
-- Fighter 2 never confirmed is voided 7 days after the analysis.
create or replace function private.expire_stale_ranked(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ranked_matches
  set status = 'expired'
  where p_user in (challenger_id, opponent_id)
    and status in ('pending', 'accepted')
    and match_id is null
    and expires_at <= now();

  update public.ranked_matches
  set status = 'voided', settled_at = now()
  where p_user in (challenger_id, opponent_id)
    and status = 'awaiting_confirmation'
    and winner_id = fighter_a_id
    and confirmed_b_at is null
    and recorded_at + interval '7 days' <= now();
$$;

-- Ready to settle: both fighters confirmed, or the window passed undisputed
-- and the recorder (Fighter 1) is not the winner.
create or replace function private.ranked_ready(r public.ranked_matches)
returns boolean
language sql
stable
set search_path = ''
as $$
  select r.status = 'awaiting_confirmation'
    and (
      (r.confirmed_a_at is not null and r.confirmed_b_at is not null)
      or (now() >= r.confirm_by and r.winner_id is distinct from r.fighter_a_id)
    );
$$;

-- Challenge lifecycle (client RPCs) ------------------------------------------------
create or replace function public.create_ranked_challenge(
  p_opponent uuid,
  p_discipline public.discipline,
  p_variant text,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.ranked_require_user();
  open_count integer;
  new_id uuid;
begin
  if p_opponent is null or p_opponent = me then
    raise exception 'invalid opponent' using errcode = '22023';
  end if;
  -- Same error for missing, blocked and not-visible users: nothing to probe.
  if not exists (select 1 from public.profiles where id = p_opponent)
     or not private.can_view_author_content(me, p_opponent, false)
     or private.is_suspended(p_opponent) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if p_variant is null or p_variant !~ '^[a-z_]{2,32}$' then
    raise exception 'invalid variant' using errcode = '22023';
  end if;
  perform private.enforce_rate_limit('ranked_challenge:' || me, 20, 86400);
  perform private.expire_stale_ranked(me);

  select count(*) into open_count from public.ranked_matches
  where me in (challenger_id, opponent_id) and status in ('pending', 'accepted', 'awaiting_confirmation', 'disputed');
  if open_count >= 20 then
    raise exception 'too many open ranked matches' using errcode = 'P0429', hint = 'Finish or cancel some first.';
  end if;

  -- Anti-farming: the same two fighters can play at most 3 ranked matches a week.
  if (
    select count(*) from public.ranked_matches
    where least(challenger_id, opponent_id) = least(me, p_opponent)
      and greatest(challenger_id, opponent_id) = greatest(me, p_opponent)
      and status in ('pending', 'accepted', 'awaiting_confirmation', 'disputed', 'confirmed')
      and created_at > now() - interval '7 days'
  ) >= 3 then
    raise exception 'weekly ranked limit with this opponent reached' using errcode = 'P0429', hint = 'pair_limit';
  end if;

  begin
    insert into public.ranked_matches (discipline, variant, challenger_id, opponent_id, message)
    values (p_discipline, p_variant, me, p_opponent, nullif(btrim(p_message), ''))
    returning id into new_id;
  exception when unique_violation then
    raise exception 'an open ranked match with this opponent already exists' using errcode = '23505';
  end;
  return new_id;
end;
$$;

create or replace function public.respond_ranked_challenge(p_id uuid, p_accept boolean)
returns public.ranked_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.ranked_require_user();
  r public.ranked_matches;
begin
  perform private.expire_stale_ranked(me);
  select * into r from public.ranked_matches where id = p_id for update;
  if not found or r.opponent_id <> me then
    raise exception 'ranked match not found' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'challenge is %', r.status using errcode = '22023';
  end if;

  update public.ranked_matches
  set status = case when p_accept then 'accepted'::public.ranked_status else 'declined'::public.ranked_status end,
      responded_at = now(),
      -- An accepted challenge gets a fresh week to be recorded.
      expires_at = case when p_accept then now() + interval '7 days' else expires_at end
  where id = p_id
  returning * into r;
  return r.status;
end;
$$;

create or replace function public.cancel_ranked_challenge(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.ranked_require_user();
  r public.ranked_matches;
begin
  select * into r from public.ranked_matches where id = p_id for update;
  if not found or me not in (r.challenger_id, r.opponent_id) then
    raise exception 'ranked match not found' using errcode = 'P0002';
  end if;
  if r.status not in ('pending', 'accepted') or r.match_id is not null then
    raise exception 'only unrecorded challenges can be cancelled' using errcode = '22023';
  end if;
  update public.ranked_matches set status = 'cancelled' where id = p_id;
end;
$$;

-- Attaches the caller's fresh draft recording; the caller becomes Fighter 1.
create or replace function public.link_ranked_match(p_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.ranked_require_user();
  r public.ranked_matches;
  m public.matches;
begin
  perform private.expire_stale_ranked(me);
  select * into r from public.ranked_matches where id = p_id for update;
  if not found or me not in (r.challenger_id, r.opponent_id) then
    raise exception 'ranked match not found' using errcode = 'P0002';
  end if;
  if r.status <> 'accepted' or r.match_id is not null then
    raise exception 'ranked match is not waiting for a recording' using errcode = '22023';
  end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found or m.owner_id <> me then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if m.status <> 'draft' then
    raise exception 'only a new recording can be ranked' using errcode = '22023';
  end if;
  if m.discipline <> r.discipline or m.variant <> r.variant then
    raise exception 'recording does not match the ranked ruleset' using errcode = '22023';
  end if;
  if exists (select 1 from public.ranked_matches where match_id = p_match_id) then
    raise exception 'recording is already ranked' using errcode = '23505';
  end if;

  update public.ranked_matches
  set match_id = p_match_id,
      fighter_a_id = me,
      fighter_b_id = case when me = r.challenger_id then r.opponent_id else r.challenger_id end
  where id = p_id;
end;
$$;

create or replace function public.dispute_ranked_result(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.ranked_require_user();
  r public.ranked_matches;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select * into r from public.ranked_matches where id = p_id for update;
  if not found or me not in (r.challenger_id, r.opponent_id) then
    raise exception 'ranked match not found' using errcode = 'P0002';
  end if;
  if r.status <> 'awaiting_confirmation' then
    raise exception 'result is not awaiting confirmation' using errcode = '22023';
  end if;
  if char_length(reason) = 0 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.ranked_matches
  set status = 'disputed', dispute_reason = left(reason, 280), disputed_by = me
  where id = p_id;
end;
$$;

create or replace function public.feature_title(p_title_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.ranked_require_user();
begin
  if p_title_id is not null and not exists (select 1 from public.user_titles where user_id = me and title_id = p_title_id) then
    raise exception 'title not unlocked' using errcode = 'P0002';
  end if;
  update public.user_titles set is_featured = false where user_id = me and is_featured;
  if p_title_id is not null then
    update public.user_titles set is_featured = true where user_id = me and title_id = p_title_id;
  end if;
end;
$$;

-- Ladder and matchmaking (security invoker: RLS decides who appears) ---------------
-- Positions are among the players the caller may see (public accounts and
-- friends), so private players are never revealed, even as a gap.
create or replace function public.get_leaderboard(
  p_discipline public.discipline,
  p_scope text default 'global',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  ladder_position bigint,
  user_id uuid,
  username extensions.citext,
  display_name text,
  avatar_path text,
  rating integer,
  games integer,
  wins integer,
  losses integer,
  draws integer,
  featured_title text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    -- Window functions run before OFFSET, so positions stay correct across pages.
    row_number() over (order by r.rating desc, r.games desc, r.user_id),
    r.user_id, p.username, p.display_name, p.avatar_path, r.rating, r.games, r.wins, r.losses, r.draws,
    (select t.title_id from public.user_titles t where t.user_id = r.user_id and t.is_featured)
  from public.ranked_ratings r
  join public.profiles p on p.id = r.user_id
  where r.discipline = p_discipline
    -- Placement matches first, except for yourself.
    and (r.games >= 5 or r.user_id = auth.uid())
    and (
      coalesce(p_scope, 'global') = 'global'
      or r.user_id = auth.uid()
      or private.are_friends(auth.uid(), r.user_id)
    )
  order by r.rating desc, r.games desc, r.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

-- Opponents near the caller's rating: friends (any privacy) and public
-- accounts with a ranked rating, excluding open matches and blocks.
create or replace function public.get_ranked_opponents(p_discipline public.discipline, p_limit integer default 20)
returns table (
  user_id uuid,
  username extensions.citext,
  display_name text,
  avatar_path text,
  rating integer,
  games integer,
  is_friend boolean,
  rating_gap integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select coalesce(
      (select r.rating from public.ranked_ratings r where r.user_id = auth.uid() and r.discipline = p_discipline),
      1000
    ) as rating
  ),
  friends as (
    select case when f.user_low = auth.uid() then f.user_high else f.user_low end as id
    from public.friendships f
    where f.status = 'accepted' and auth.uid() in (f.user_low, f.user_high)
  ),
  pool as (
    select r.user_id, r.rating, r.games from public.ranked_ratings r
    where r.discipline = p_discipline and r.user_id <> auth.uid()
    union
    select f.id, 1000, 0 from friends f
    where not exists (select 1 from public.ranked_ratings r where r.user_id = f.id and r.discipline = p_discipline)
  )
  select
    pool.user_id, p.username, p.display_name, p.avatar_path, pool.rating, pool.games,
    exists (select 1 from friends f where f.id = pool.user_id),
    pool.rating - me.rating
  from pool
  cross join me
  join public.profiles p on p.id = pool.user_id
  where not exists (
    select 1 from public.ranked_matches m
    where m.discipline = p_discipline
      and m.status in ('pending', 'accepted', 'awaiting_confirmation', 'disputed')
      and pool.user_id in (m.challenger_id, m.opponent_id)
  )
  order by abs(pool.rating - me.rating), pool.games desc, pool.user_id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- Analysis completion and deletion hooks --------------------------------------------
create or replace function private.on_match_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  winner_side text;
  method text;
begin
  select a.scorecard -> 'result' ->> 'winner', a.scorecard -> 'result' ->> 'method'
  into winner_side, method
  from public.match_analyses a where a.match_id = new.id;

  update public.ranked_matches r
  set status = 'awaiting_confirmation',
      winner_id = case winner_side when 'A' then r.fighter_a_id when 'B' then r.fighter_b_id end,
      result_method = case when method ~ '^[a-z_]{2,32}$' then method end,
      recorded_at = now(),
      confirm_by = now() + interval '72 hours'
  where r.match_id = new.id and r.status = 'accepted';
  return new;
end;
$$;

create trigger matches_ranked_completed
  after update of status on public.matches
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.on_match_completed();

-- Deleting the recording: an unscored ranked match can be recorded again; a
-- result that was never settled is voided (nothing left to verify).
create or replace function private.on_match_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ranked_matches
  set status = case when status = 'accepted' then status else 'voided'::public.ranked_status end,
      match_id = null,
      fighter_a_id = case when status = 'accepted' then null else fighter_a_id end,
      fighter_b_id = case when status = 'accepted' then null else fighter_b_id end
  where match_id = old.id and status in ('accepted', 'awaiting_confirmation', 'disputed');
  return old;
end;
$$;

create trigger matches_ranked_deleted
  before delete on public.matches
  for each row execute function private.on_match_deleted();

-- Service-only RPCs (the `ranked` Edge Function) ------------------------------------
create or replace function public.svc_record_ranked_confirmation(p_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.ranked_matches;
begin
  select * into r from public.ranked_matches where id = p_id for update;
  if not found or p_user_id not in (r.fighter_a_id, r.fighter_b_id) then
    raise exception 'ranked match not found' using errcode = 'P0002';
  end if;
  if r.status <> 'awaiting_confirmation' then
    raise exception 'result is not awaiting confirmation' using errcode = '22023';
  end if;
  update public.ranked_matches
  set confirmed_a_at = case when p_user_id = r.fighter_a_id then coalesce(confirmed_a_at, now()) else confirmed_a_at end,
      confirmed_b_at = case when p_user_id = r.fighter_b_id then coalesce(confirmed_b_at, now()) else confirmed_b_at end
  where id = p_id
  returning * into r;
  return private.ranked_ready(r);
end;
$$;

create or replace function private.ranked_int(value jsonb, key text, low integer, high integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  n numeric;
begin
  n := (value ->> key)::numeric;
  if n is null or n <> trunc(n) or n < low or n > high then
    raise exception 'invalid % in ranked settlement', key using errcode = '22023';
  end if;
  return n::integer;
exception when invalid_text_representation then
  raise exception 'invalid % in ranked settlement', key using errcode = '22023';
end;
$$;

-- Applies a settlement computed by the Edge Function. `p_expected` holds the
-- rating-row versions the computation was based on ({"a": n, "b": n}); on a
-- mismatch nothing is written and 'conflict' is returned so the caller can
-- reload and recompute. Each fighter payload:
--   {"rating", "games", "wins", "losses", "draws", "streak", "peak", "delta",
--    "outcome", "totals": {...}, "titles": ["id", ...]}
create or replace function public.svc_apply_ranked_result(
  p_id uuid,
  p_expected jsonb,
  p_a jsonb,
  p_b jsonb,
  p_allow_disputed boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.ranked_matches;
  side text;
  uid uuid;
  other uuid;
  payload jsonb;
  current_row public.ranked_ratings;
  before_a integer;
  before_b integer;
begin
  select * into r from public.ranked_matches where id = p_id for update;
  if not found then
    raise exception 'ranked match not found' using errcode = 'P0002';
  end if;
  if r.status in ('confirmed', 'voided') then
    return 'already_settled';
  end if;
  if not (private.ranked_ready(r) or (p_allow_disputed and r.status = 'disputed')) then
    return 'not_ready';
  end if;

  insert into public.ranked_ratings (user_id, discipline)
  values (r.fighter_a_id, r.discipline), (r.fighter_b_id, r.discipline)
  on conflict do nothing;

  -- Lock both rows in a fixed order (no deadlocks between concurrent settlements).
  perform 1 from public.ranked_ratings
  where discipline = r.discipline and user_id in (r.fighter_a_id, r.fighter_b_id)
  order by user_id
  for update;

  select rating into before_a from public.ranked_ratings where user_id = r.fighter_a_id and discipline = r.discipline;
  select rating into before_b from public.ranked_ratings where user_id = r.fighter_b_id and discipline = r.discipline;

  foreach side in array array['a', 'b'] loop
    uid := case side when 'a' then r.fighter_a_id else r.fighter_b_id end;
    select * into current_row from public.ranked_ratings where user_id = uid and discipline = r.discipline;
    if current_row.version is distinct from (p_expected ->> side)::integer then
      return 'conflict';
    end if;
  end loop;

  foreach side in array array['a', 'b'] loop
    uid := case side when 'a' then r.fighter_a_id else r.fighter_b_id end;
    other := case side when 'a' then r.fighter_b_id else r.fighter_a_id end;
    payload := case side when 'a' then p_a else p_b end;
    if jsonb_typeof(payload -> 'totals') is distinct from 'object' or payload ->> 'outcome' not in ('win', 'loss', 'draw') then
      raise exception 'invalid ranked settlement payload' using errcode = '22023';
    end if;

    select * into current_row from public.ranked_ratings where user_id = uid and discipline = r.discipline;

    update public.ranked_ratings
    set rating = private.ranked_int(payload, 'rating', 100, 4000),
        games = private.ranked_int(payload, 'games', current_row.games + 1, current_row.games + 1),
        wins = private.ranked_int(payload, 'wins', 0, 1000000),
        losses = private.ranked_int(payload, 'losses', 0, 1000000),
        draws = private.ranked_int(payload, 'draws', 0, 1000000),
        current_streak = private.ranked_int(payload, 'streak', 0, 1000000),
        peak_rating = private.ranked_int(payload, 'peak', 100, 4000),
        totals = payload -> 'totals',
        version = version + 1,
        last_match_at = now()
    where user_id = uid and discipline = r.discipline;

    insert into public.rating_history (user_id, discipline, ranked_match_id, opponent_id, outcome, rating_before, rating_after, delta)
    values (
      uid, r.discipline, r.id, other, payload ->> 'outcome',
      current_row.rating, private.ranked_int(payload, 'rating', 100, 4000), private.ranked_int(payload, 'delta', -1000, 1000)
    );

    insert into public.user_titles (user_id, title_id, discipline, ranked_match_id)
    select uid, t.value, r.discipline, r.id
    from jsonb_array_elements_text(coalesce(payload -> 'titles', '[]'::jsonb)) as t(value)
    where t.value ~ '^[a-z_]{2,40}$'
    on conflict (user_id, title_id) do nothing;
  end loop;

  update public.ranked_matches
  set status = 'confirmed',
      settled_at = now(),
      rating_a_before = before_a,
      rating_a_after = (p_a ->> 'rating')::integer,
      rating_b_before = before_b,
      rating_b_after = (p_b ->> 'rating')::integer
  where id = p_id;
  return 'applied';
end;
$$;

-- Owner Panel ----------------------------------------------------------------------
create or replace function public.admin_list_ranked_disputes(p_limit integer default 50)
returns table (
  id uuid,
  discipline public.discipline,
  variant text,
  match_id uuid,
  fighter_a_id uuid,
  fighter_a_username extensions.citext,
  fighter_b_id uuid,
  fighter_b_username extensions.citext,
  winner_id uuid,
  result_method text,
  dispute_reason text,
  disputed_by uuid,
  recorded_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_owner();
  return query
    select r.id, r.discipline, r.variant, r.match_id, r.fighter_a_id, pa.username, r.fighter_b_id, pb.username,
      r.winner_id, r.result_method, r.dispute_reason, r.disputed_by, r.recorded_at, r.updated_at
    from public.ranked_matches r
    left join public.profiles pa on pa.id = r.fighter_a_id
    left join public.profiles pb on pb.id = r.fighter_b_id
    where r.status = 'disputed'
    order by r.updated_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- 'void' ends the match without rating changes; 'apply' upholds the analysed
-- result: the match becomes ready to settle and the Edge Function applies it.
create or replace function public.admin_resolve_ranked_dispute(p_id uuid, p_outcome text, p_reason text default null)
returns public.ranked_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
  r public.ranked_matches;
begin
  perform private.enforce_rate_limit('admin_write:' || actor, 60, 60);
  if p_outcome not in ('apply', 'void') then
    raise exception 'invalid outcome' using errcode = '22023';
  end if;
  select * into r from public.ranked_matches where id = p_id for update;
  if not found then
    raise exception 'ranked match not found' using errcode = 'P0002';
  end if;
  if r.status <> 'disputed' then
    raise exception 'ranked match is not disputed' using errcode = '22023';
  end if;

  update public.ranked_matches
  set status = case when p_outcome = 'void' then 'voided'::public.ranked_status else 'awaiting_confirmation'::public.ranked_status end,
      confirmed_a_at = case when p_outcome = 'apply' then now() else confirmed_a_at end,
      confirmed_b_at = case when p_outcome = 'apply' then now() else confirmed_b_at end,
      settled_at = case when p_outcome = 'void' then now() else settled_at end
  where id = p_id
  returning * into r;

  insert into private.admin_audit_log (actor_id, target_user_id, action, old_value, new_value, reason)
  values (
    actor, r.disputed_by, 'resolve_ranked_dispute',
    jsonb_build_object('ranked_match_id', r.id, 'status', 'disputed'),
    jsonb_build_object('outcome', p_outcome, 'status', r.status),
    left(p_reason, 280)
  );
  return r.status;
end;
$$;

-- Grants ---------------------------------------------------------------------------
revoke all on function
  private.ranked_require_user(), private.expire_stale_ranked(uuid), private.ranked_ready(public.ranked_matches),
  private.ranked_int(jsonb, text, integer, integer), private.on_match_completed(), private.on_match_deleted()
from public;

revoke all on function
  public.create_ranked_challenge(uuid, public.discipline, text, text),
  public.respond_ranked_challenge(uuid, boolean),
  public.cancel_ranked_challenge(uuid),
  public.link_ranked_match(uuid, uuid),
  public.dispute_ranked_result(uuid, text),
  public.feature_title(text),
  public.get_leaderboard(public.discipline, text, integer, integer),
  public.get_ranked_opponents(public.discipline, integer),
  public.admin_list_ranked_disputes(integer),
  public.admin_resolve_ranked_dispute(uuid, text, text),
  public.svc_record_ranked_confirmation(uuid, uuid),
  public.svc_apply_ranked_result(uuid, jsonb, jsonb, jsonb, boolean)
from public, anon, authenticated;

grant execute on function
  public.create_ranked_challenge(uuid, public.discipline, text, text),
  public.respond_ranked_challenge(uuid, boolean),
  public.cancel_ranked_challenge(uuid),
  public.link_ranked_match(uuid, uuid),
  public.dispute_ranked_result(uuid, text),
  public.feature_title(text),
  public.get_leaderboard(public.discipline, text, integer, integer),
  public.get_ranked_opponents(public.discipline, integer),
  public.admin_list_ranked_disputes(integer),
  public.admin_resolve_ranked_dispute(uuid, text, text)
to authenticated;

grant execute on function
  public.svc_record_ranked_confirmation(uuid, uuid),
  public.svc_apply_ranked_result(uuid, jsonb, jsonb, jsonb, boolean)
to service_role;
