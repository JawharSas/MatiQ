-- =============================================================================
-- MatIQ: access-control helpers, signup trigger, privileges and RLS policies
-- =============================================================================
-- Helpers are SECURITY DEFINER so they can read relationship tables without
-- recursing through RLS; each one only answers a yes/no question about the
-- calling user and never returns row data.
-- =============================================================================

create or replace function private.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function private.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where user_low = least(a, b) and user_high = greatest(a, b) and status = 'accepted'
  );
$$;

-- Core privacy rule. A viewer can see an author's content when:
--   * it is their own content, or
--   * neither has blocked the other AND
--     (the author's account is public and the item is not friends-only,
--      or the two are accepted friends).
create or replace function private.can_view_author_content(viewer uuid, author uuid, friends_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when viewer is null or author is null then false
    when viewer = author then true
    when private.is_blocked_between(viewer, author) then false
    when not friends_only and exists (
      select 1 from public.profiles where id = author and visibility = 'public'
    ) then true
    else private.are_friends(viewer, author)
  end;
$$;

create or replace function private.can_view_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and private.can_view_author_content(auth.uid(), p.author_id, p.friends_only)
  );
$$;

-- A match (and its analysis / video) is visible to its owner, or to anyone who
-- can see at least one post that shares it.
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
      )
  );
$$;

create or replace function private.is_suspended(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_suspended from public.user_entitlements where user_id = uid), true);
$$;

-- Owner check used by every owner-panel RPC. Optionally requires an
-- MFA-verified (aal2) session, see private.app_config.owner_requires_mfa.
create or replace function private.is_owner(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_entitlements e
    where e.user_id = uid and e.role = 'owner' and not e.is_suspended
  )
  and (
    not (select owner_requires_mfa from private.app_config)
    or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );
$$;

create or replace function private.require_owner()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not private.is_owner(uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return uid;
end;
$$;

grant execute on function
  private.is_blocked_between(uuid, uuid),
  private.are_friends(uuid, uuid),
  private.can_view_author_content(uuid, uuid, boolean),
  private.can_view_post(uuid),
  private.can_view_match(uuid),
  private.is_suspended(uuid),
  private.is_owner(uuid)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Signup trigger: create the profile + entitlements rows.
-- raw_user_meta_data is attacker-controlled (it comes from signUp options), so
-- only `username` and `display_name` are read, both validated, and privileges
-- are NEVER derived from it.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text := new.raw_user_meta_data ->> 'username';
  requested_name text := left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 50);
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Table privileges. Column-level grants make server-owned columns
-- (role, is_unlimited, status, ...) impossible to write from the client even
-- if an RLS policy were misconfigured.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger on
  public.profiles, public.user_entitlements, public.legal_acceptances, public.matches,
  public.match_analyses, public.friendships, public.blocks, public.posts, public.post_likes,
  public.usage_ledger
from authenticated;

grant select on
  public.profiles, public.user_entitlements, public.legal_acceptances, public.matches,
  public.match_analyses, public.friendships, public.blocks, public.posts, public.post_likes,
  public.usage_ledger
to authenticated;

grant update (username, display_name, bio, avatar_path, primary_discipline, visibility)
  on public.profiles to authenticated;

grant insert (user_id, document, version) on public.legal_acceptances to authenticated;

-- `id` is client-generated (UUIDv4) so the app can build storage paths before
-- the first upload; ownership is still enforced by RLS and storage policies.
grant insert (id, discipline, variant, title, athlete_a_label, athlete_b_label, source, duration_ms, round_duration_ms, recorded_at)
  on public.matches to authenticated;
grant update (title, athlete_a_label, athlete_b_label, duration_ms, round_duration_ms) on public.matches to authenticated;
grant delete on public.matches to authenticated;

grant insert (blocked_id) on public.blocks to authenticated;
grant delete on public.blocks to authenticated;

grant insert (id, match_id, body, highlight_start_ms, highlight_end_ms, friends_only) on public.posts to authenticated;
grant update (body, friends_only) on public.posts to authenticated;
grant delete on public.posts to authenticated;

grant insert (post_id) on public.post_likes to authenticated;
grant delete on public.post_likes to authenticated;

grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- `(select auth.uid())` and helpers that only depend on it are wrapped in a
-- sub-select so Postgres evaluates them once per statement, not per row.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.matches enable row level security;
alter table public.match_analyses enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.usage_ledger enable row level security;
alter table private.app_config enable row level security;
alter table private.user_api_keys enable row level security;
alter table private.rate_limits enable row level security;
alter table private.admin_audit_log enable row level security;

-- Profiles: the profile card (name, avatar, bio) is visible to every signed-in
-- user who has not been blocked; content visibility is enforced on posts.
create policy profiles_select on public.profiles
  for select to authenticated
  using (not private.is_blocked_between((select auth.uid()), id));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Entitlements: users read their own row; owners read all. No write policies:
-- changes go through owner-panel RPCs only.
create policy entitlements_select on public.user_entitlements
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner((select auth.uid()))));

create policy legal_select_own on public.legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy legal_insert_own on public.legal_acceptances
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Matches.
create policy matches_select on public.matches
  for select to authenticated
  using (owner_id = (select auth.uid()) or private.can_view_match(id));

create policy matches_insert_own on public.matches
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'draft'
    and not (select private.is_suspended((select auth.uid())))
  );

create policy matches_update_own on public.matches
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy matches_delete_own on public.matches
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy match_analyses_select on public.match_analyses
  for select to authenticated
  using (owner_id = (select auth.uid()) or private.can_view_match(match_id));

-- Friendships are read-only for clients; mutations go through RPCs that
-- enforce blocks and rate limits.
create policy friendships_select_own on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));

create policy blocks_select_own on public.blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy blocks_insert_own on public.blocks
  for insert to authenticated
  with check (blocker_id = (select auth.uid()));

create policy blocks_delete_own on public.blocks
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- Posts.
create policy posts_select on public.posts
  for select to authenticated
  using (private.can_view_author_content((select auth.uid()), author_id, friends_only));

create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and not (select private.is_suspended((select auth.uid())))
    and (
      match_id is null
      or exists (
        select 1 from public.matches m
        where m.id = match_id and m.owner_id = (select auth.uid()) and m.status = 'completed'
      )
    )
  );

create policy posts_update_own on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy posts_delete_own on public.posts
  for delete to authenticated
  using (author_id = (select auth.uid()));

create policy post_likes_select on public.post_likes
  for select to authenticated
  using (private.can_view_post(post_id));

create policy post_likes_insert on public.post_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_post(post_id));

create policy post_likes_delete_own on public.post_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy usage_ledger_select_own on public.usage_ledger
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Private tables: RLS enabled with no policies (service_role bypasses RLS).

-- Duration is finalised when a live recording stops (frames upload while
-- recording, so the row exists before the length is known). Once analysis
-- has been requested it is frozen.
create or replace function private.guard_match_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and (new.duration_ms is distinct from old.duration_ms
          or new.round_duration_ms is distinct from old.round_duration_ms)
     and current_user = 'authenticated' then
    raise exception 'duration cannot change after analysis was requested' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger matches_guard_update
  before update on public.matches
  for each row execute function private.guard_match_update();

-- Blocking someone removes any friendship or pending request between the two.
create or replace function private.on_block_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where user_low = least(new.blocker_id, new.blocked_id)
    and user_high = greatest(new.blocker_id, new.blocked_id);
  return new;
end;
$$;

create trigger blocks_remove_friendship
  after insert on public.blocks
  for each row execute function private.on_block_created();

-- Realtime: clients subscribe to their own match rows to follow analysis
-- progress. Realtime applies the same RLS policies as the Data API.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.matches;
  end if;
end;
$$;
