-- =============================================================================
-- MatIQ: friend graph RPCs, profile lookup and the privacy-filtered feed
-- =============================================================================

create or replace function public.send_friend_request(p_target uuid)
returns public.friendship_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  existing public.friendships;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_target is null or p_target = me then
    raise exception 'invalid target' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_target)
     or private.is_blocked_between(me, p_target) then
    -- Same error for "missing" and "blocked" so blocks cannot be probed.
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  perform private.enforce_rate_limit('friend_request:' || me, 30, 3600);

  select * into existing from public.friendships
  where user_low = least(me, p_target) and user_high = greatest(me, p_target)
  for update;

  if found then
    -- A pending request from the other user is accepted by requesting back.
    if existing.status = 'pending' and existing.requested_by = p_target then
      update public.friendships
      set status = 'accepted', responded_at = now()
      where user_low = existing.user_low and user_high = existing.user_high;
      return 'accepted';
    end if;
    return existing.status;
  end if;

  insert into public.friendships (user_low, user_high, requested_by)
  values (least(me, p_target), greatest(me, p_target), me);
  return 'pending';
end;
$$;

create or replace function public.respond_friend_request(p_requester uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_accept then
    update public.friendships
    set status = 'accepted', responded_at = now()
    where user_low = least(me, p_requester)
      and user_high = greatest(me, p_requester)
      and requested_by = p_requester
      and status = 'pending';
  else
    delete from public.friendships
    where user_low = least(me, p_requester)
      and user_high = greatest(me, p_requester)
      and requested_by = p_requester
      and status = 'pending';
  end if;
  return found;
end;
$$;

-- Unfriend, or cancel a request I sent.
create or replace function public.remove_friend(p_other uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.friendships
  where user_low = least(me, p_other) and user_high = greatest(me, p_other);
  return found;
end;
$$;

-- Friends and pending requests with the other user's profile card.
create or replace function public.get_friends()
returns table (
  user_id uuid,
  username extensions.citext,
  display_name text,
  avatar_path text,
  status public.friendship_status,
  direction text,
  since timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_path,
    f.status,
    case
      when f.status = 'accepted' then 'friend'
      when f.requested_by = auth.uid() then 'outgoing'
      else 'incoming'
    end,
    coalesce(f.responded_at, f.created_at)
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_low = auth.uid() then f.user_high else f.user_low end
  where auth.uid() in (f.user_low, f.user_high)
  order by f.status, coalesce(f.responded_at, f.created_at) desc;
$$;

-- Profile search for adding friends. LIKE wildcards in the query are escaped.
create or replace function public.search_profiles(p_query text, p_limit integer default 20)
returns table (user_id uuid, username extensions.citext, display_name text, avatar_path text, visibility public.account_visibility)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cleaned text := left(btrim(coalesce(p_query, '')), 40);
  pattern text;
begin
  if char_length(cleaned) < 2 then
    return;
  end if;
  pattern := replace(replace(replace(cleaned, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.username, p.display_name, p.avatar_path, p.visibility
    from public.profiles p
    where (p.username::text ilike pattern or p.display_name ilike pattern)
      and p.id <> auth.uid()
    order by p.username
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- Profile card + relationship + whether the caller may see the content.
create or replace function public.get_profile(p_user_id uuid)
returns table (
  user_id uuid,
  username extensions.citext,
  display_name text,
  bio text,
  avatar_path text,
  primary_discipline public.discipline,
  visibility public.account_visibility,
  relationship text,
  can_view_content boolean,
  post_count bigint,
  friend_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.bio,
    p.avatar_path,
    p.primary_discipline,
    p.visibility,
    case
      when p.id = auth.uid() then 'self'
      when f.status = 'accepted' then 'friend'
      when f.status = 'pending' and f.requested_by = auth.uid() then 'outgoing'
      when f.status = 'pending' then 'incoming'
      else 'none'
    end,
    private.can_view_author_content(auth.uid(), p.id),
    case when private.can_view_author_content(auth.uid(), p.id)
      then (select count(*) from public.posts po
            where po.author_id = p.id
              and private.can_view_author_content(auth.uid(), po.author_id, po.friends_only))
      else null end,
    (select count(*) from public.friendships fr
      where p.id in (fr.user_low, fr.user_high) and fr.status = 'accepted')
  from public.profiles p
  left join public.friendships f
    on f.user_low = least(p.id, auth.uid()) and f.user_high = greatest(p.id, auth.uid())
  where p.id = p_user_id
    and auth.uid() is not null
    and not private.is_blocked_between(auth.uid(), p.id);
$$;

-- -----------------------------------------------------------------------------
-- Feed. SECURITY INVOKER on purpose: posts, matches and analyses are filtered
-- by their RLS policies, so the feed can never return something the caller
-- could not read directly. Keyset pagination on created_at.
-- -----------------------------------------------------------------------------
create or replace function public.get_feed(
  p_before timestamptz default null,
  p_limit integer default 20,
  p_author uuid default null,
  p_friends_only boolean default false
)
returns table (
  post_id uuid,
  author_id uuid,
  username extensions.citext,
  display_name text,
  avatar_path text,
  body text,
  friends_only boolean,
  created_at timestamptz,
  match_id uuid,
  discipline public.discipline,
  variant text,
  match_title text,
  athlete_a_label text,
  athlete_b_label text,
  has_video boolean,
  highlight_start_ms integer,
  highlight_end_ms integer,
  result jsonb,
  totals jsonb,
  like_count bigint,
  liked_by_me boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.author_id,
    pr.username,
    pr.display_name,
    pr.avatar_path,
    p.body,
    p.friends_only,
    p.created_at,
    m.id,
    m.discipline,
    m.variant,
    m.title,
    m.athlete_a_label,
    m.athlete_b_label,
    coalesce(m.has_video, false),
    p.highlight_start_ms,
    p.highlight_end_ms,
    a.scorecard -> 'result',
    a.scorecard -> 'totals',
    (select count(*) from public.post_likes l where l.post_id = p.id),
    exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = auth.uid())
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  left join public.matches m on m.id = p.match_id
  left join public.match_analyses a on a.match_id = p.match_id
  where (p_before is null or p.created_at < p_before)
    and (p_author is null or p.author_id = p_author)
    and (not p_friends_only or p.author_id = auth.uid() or private.are_friends(auth.uid(), p.author_id))
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid),
  public.get_friends(),
  public.search_profiles(text, integer),
  public.get_profile(uuid),
  public.get_feed(timestamptz, integer, uuid, boolean)
from public, anon;

grant execute on function
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid),
  public.get_friends(),
  public.search_profiles(text, integer),
  public.get_profile(uuid),
  public.get_feed(timestamptz, integer, uuid, boolean)
to authenticated;
