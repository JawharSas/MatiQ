-- =============================================================================
-- Gyms and teams.
--
-- A person belongs to at most one gym. Anyone can start one (they become its
-- owner) and others join with its 8-character invite code. Only members see
-- a gym, its members and its leaderboard: joining shows your name and your
-- ranked ratings to your teammates. The gym feed is the ordinary feed limited
-- to teammates, so a private account's posts still need a friendship.
--
-- The owner can remove members and issue a new code (the old one stops
-- working). When the owner leaves, the longest-standing member takes over;
-- when the last member leaves, the gym is deleted.
-- =============================================================================

create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint gym_name_length check (char_length(btrim(name)) between 3 and 60)
    constraint gym_name_safe check (not private.has_unsafe_chars(name)),
  city text
    constraint gym_city_length check (city is null or char_length(btrim(city)) between 1 and 60)
    constraint gym_city_safe check (city is null or not private.has_unsafe_chars(city)),
  invite_code text not null unique constraint gym_code_format check (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_by uuid references app.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.gym_members (
  gym_id uuid not null references public.gyms (id) on delete cascade,
  -- One gym per person.
  user_id uuid not null unique references app.users (id) on delete cascade,
  role text not null default 'member' constraint gym_member_role check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (gym_id, user_id)
);

create unique index gym_one_owner on public.gym_members (gym_id) where role = 'owner';

alter table public.gyms enable row level security;
alter table public.gym_members enable row level security;
revoke all on public.gyms, public.gym_members from public, anon, anonymous, authenticated;
-- Read through the functions below; written only by them.
grant select on public.gym_members to authenticated;
grant all on public.gyms, public.gym_members to service_role;

-- The signed-in person's gym, or null.
create or replace function private.my_gym_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gym_id from public.gym_members where user_id = app.uid();
$$;

revoke all on function private.my_gym_id() from public;
grant execute on function private.my_gym_id() to authenticated, service_role;

-- Teammates see each other's membership rows (used by the gym feed).
create policy gym_members_select on public.gym_members
  for select to authenticated
  using (gym_id = (select private.my_gym_id()));

create or replace function private.gym_require_member(out gym_id uuid, out role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := app.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select m.gym_id, m.role into gym_id, role from public.gym_members m where m.user_id = me;
  if not found then
    raise exception 'not in a gym' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function private.gym_require_member() from public;
grant execute on function private.gym_require_member() to authenticated, service_role;

-- Readable invite codes: no 0/O, 1/I/L.
create or replace function private.new_gym_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.gyms where invite_code = code);
  end loop;
  return code;
end;
$$;

revoke all on function private.new_gym_code() from public;

create or replace function private.gym_check_text(p_name text, p_city text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.text_violation(p_name) is not null or (p_city is not null and private.text_violation(p_city) is not null) then
    raise exception using errcode = '22023', message = 'content_not_allowed',
      hint = 'This text breaks the MatIQ community rules.';
  end if;
end;
$$;

revoke all on function private.gym_check_text(text, text) from public;

-- -----------------------------------------------------------------------------
-- Starting, joining and leaving.
-- -----------------------------------------------------------------------------
create or replace function public.create_gym(p_name text, p_city text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := app.uid();
  clean_name text := btrim(coalesce(p_name, ''));
  clean_city text := nullif(btrim(coalesce(p_city, '')), '');
  new_id uuid;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if private.is_suspended(me) or private.is_banned(me) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.gym_members where user_id = me) then
    raise exception using errcode = '23505', message = 'already_in_gym', hint = 'Leave your gym first.';
  end if;
  perform private.gym_check_text(clean_name, clean_city);
  perform private.enforce_rate_limit('gym_create:' || me, 5, 86400);
  insert into public.gyms (name, city, invite_code, created_by)
  values (clean_name, clean_city, private.new_gym_code(), me)
  returning id into new_id;
  insert into public.gym_members (gym_id, user_id, role) values (new_id, me, 'owner');
  return new_id;
end;
$$;

create or replace function public.join_gym(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := app.uid();
  target uuid;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if private.is_suspended(me) or private.is_banned(me) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Guessing codes is slow: 10 tries an hour.
  perform private.enforce_rate_limit('gym_join:' || me, 10, 3600);
  if exists (select 1 from public.gym_members where user_id = me) then
    raise exception using errcode = '23505', message = 'already_in_gym', hint = 'Leave your gym first.';
  end if;
  select id into target from public.gyms where invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if target is null then
    raise exception using errcode = 'P0002', message = 'gym_not_found', hint = 'Check the code with your gym.';
  end if;
  insert into public.gym_members (gym_id, user_id, role) values (target, me, 'member');
  return target;
end;
$$;

create or replace function public.leave_gym()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership record;
  successor uuid;
begin
  select * into membership from private.gym_require_member();
  delete from public.gym_members where user_id = app.uid();
  if membership.role = 'owner' then
    select user_id into successor from public.gym_members where gym_id = membership.gym_id order by joined_at, user_id limit 1;
    if successor is null then
      delete from public.gyms where id = membership.gym_id;
    else
      update public.gym_members set role = 'owner' where gym_id = membership.gym_id and user_id = successor;
    end if;
  end if;
  return true;
end;
$$;

create or replace function public.remove_gym_member(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership record;
begin
  select * into membership from private.gym_require_member();
  if membership.role <> 'owner' then
    raise exception 'only the gym owner can remove members' using errcode = '42501';
  end if;
  if p_user = app.uid() then
    raise exception 'leave the gym instead' using errcode = '22023';
  end if;
  delete from public.gym_members where gym_id = membership.gym_id and user_id = p_user;
  return found;
end;
$$;

create or replace function public.rotate_gym_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership record;
  code text;
begin
  select * into membership from private.gym_require_member();
  if membership.role <> 'owner' then
    raise exception 'only the gym owner can change the code' using errcode = '42501';
  end if;
  code := private.new_gym_code();
  update public.gyms set invite_code = code where id = membership.gym_id;
  return code;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reading: your gym, its members, its leaderboard and its feed.
-- -----------------------------------------------------------------------------
create or replace function public.get_my_gym()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := app.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'id', g.id, 'name', g.name, 'city', g.city, 'invite_code', g.invite_code, 'role', m.role,
      'member_count', (select count(*) from public.gym_members x where x.gym_id = g.id and not private.is_banned(x.user_id)),
      'created_at', g.created_at)
    from public.gym_members m join public.gyms g on g.id = m.gym_id
    where m.user_id = me
  );
end;
$$;

create or replace function public.get_gym_members()
returns table (user_id uuid, username text, display_name text, avatar_path text, role text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  membership record;
begin
  select * into membership from private.gym_require_member();
  return query
    select m.user_id, p.username::text, p.display_name::text, p.avatar_path::text, m.role, m.joined_at
    from public.gym_members m join public.profiles p on p.id = m.user_id
    where m.gym_id = membership.gym_id
      and not private.is_banned(m.user_id)
      and not private.is_blocked_between(app.uid(), m.user_id)
    order by (m.role = 'owner') desc, p.display_name;
end;
$$;

create or replace function public.get_gym_leaderboard(p_discipline public.discipline)
returns table (user_id uuid, username text, display_name text, avatar_path text, rating integer, games integer, wins integer, losses integer, draws integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  membership record;
begin
  select * into membership from private.gym_require_member();
  return query
    select m.user_id, p.username::text, p.display_name::text, p.avatar_path::text,
           r.rating::integer, r.games::integer, r.wins::integer, r.losses::integer, r.draws::integer
    from public.gym_members m
    join public.profiles p on p.id = m.user_id
    join public.ranked_ratings r on r.user_id = m.user_id and r.discipline = p_discipline
    where m.gym_id = membership.gym_id
      and r.games > 0
      and not private.is_banned(m.user_id)
      and not private.is_blocked_between(app.uid(), m.user_id)
    order by r.rating desc, r.games desc, p.display_name;
end;
$$;

-- The ordinary feed (with its visibility rules: security invoker), teammates only.
create function public.get_gym_feed(p_before timestamptz default null, p_limit integer default 20)
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
  liked_by_me boolean,
  comment_count bigint,
  comments_enabled boolean
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
    exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = app.uid()),
    (select count(*) from public.post_comments c where c.post_id = p.id),
    p.comments_enabled
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  left join public.matches m on m.id = p.match_id
  left join public.match_analyses a on a.match_id = p.match_id
  where (p_before is null or p.created_at < p_before)
    and p.author_id in (select gm.user_id from public.gym_members gm where gm.gym_id = private.my_gym_id())
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.create_gym(text, text)', 'public.join_gym(text)', 'public.leave_gym()', 'public.remove_gym_member(uuid)',
    'public.rotate_gym_code()', 'public.get_my_gym()', 'public.get_gym_members()',
    'public.get_gym_leaderboard(public.discipline)', 'public.get_gym_feed(timestamptz, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, anonymous', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
