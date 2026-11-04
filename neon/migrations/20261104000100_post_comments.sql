-- =============================================================================
-- Comments on posts.
--
-- Anyone who can see a post can comment on it, unless its author turned
-- comments off (when sharing, or later on the post). Turning them off stops
-- new comments; the ones already there stay, and the post's author can delete
-- any comment on it. Comments go through the same word filter as names and
-- titles (refused, not stored), and banned or blocked accounts' comments are
-- hidden like their posts.
-- =============================================================================

alter table public.posts add column comments_enabled boolean not null default true;
grant insert (comments_enabled) on public.posts to authenticated;

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null default app.uid() references app.users (id) on delete cascade,
  body text not null
    constraint comment_length check (char_length(btrim(body)) between 1 and 500)
    constraint comment_safe check (not private.has_unsafe_chars(body, true)),
  created_at timestamptz not null default now()
);

create index post_comments_post_created_idx on public.post_comments (post_id, created_at desc);
create index post_comments_author_idx on public.post_comments (author_id);

alter table public.post_comments enable row level security;
revoke all on public.post_comments from public, anon, anonymous, authenticated;
-- Written only through the functions below.
grant select on public.post_comments to authenticated;
grant all on public.post_comments to service_role;

create policy post_comments_select on public.post_comments
  for select to authenticated
  using (
    private.can_view_post(post_id)
    and (
      author_id = (select app.uid())
      or (not private.is_banned(author_id) and not private.is_blocked_between((select app.uid()), author_id))
    )
  );

-- -----------------------------------------------------------------------------
-- Writing, deleting and turning comments on or off.
-- -----------------------------------------------------------------------------
create or replace function public.add_post_comment(p_post_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := app.uid();
  text_body text := btrim(coalesce(p_body, ''));
  open boolean;
  new_id uuid;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if private.is_suspended(me) or private.is_banned(me) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- The same visibility as the feed: hidden, blocked and banned authors' posts are "not found".
  select p.comments_enabled into open
  from public.posts p
  where p.id = p_post_id
    and p.moderation is null
    and private.can_view_author_content(me, p.author_id, p.friends_only);
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not open then
    raise exception using errcode = '42501', message = 'comments_off',
      hint = 'The author turned off comments on this post.';
  end if;
  if char_length(text_body) = 0 or char_length(text_body) > 500 or private.has_unsafe_chars(text_body, true) then
    raise exception 'invalid comment' using errcode = '22023';
  end if;
  if private.text_violation(text_body) is not null then
    raise exception using errcode = '22023', message = 'content_not_allowed',
      hint = 'This text breaks the MatIQ community rules.';
  end if;
  perform private.enforce_rate_limit('post_comment:' || me, 30, 600);

  insert into public.post_comments (post_id, author_id, body)
  values (p_post_id, me, text_body)
  returning id into new_id;
  return new_id;
end;
$$;

-- The comment's author, the post's author or the owner (moderation).
create or replace function public.delete_post_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := app.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.post_comments c
  where c.id = p_comment_id
    and (
      c.author_id = me
      or exists (select 1 from public.posts p where p.id = c.post_id and p.author_id = me)
      or private.is_owner(me)
    );
  return found;
end;
$$;

-- Only the post's author.
create or replace function public.set_post_comments(p_post_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := app.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.posts
  set comments_enabled = coalesce(p_enabled, true)
  where id = p_post_id and author_id = me;
  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reading. SECURITY INVOKER: the posts, comments and profiles policies decide
-- what comes back, as for the feed.
-- -----------------------------------------------------------------------------
create or replace function public.get_post_comments(p_post_id uuid, p_limit integer default 100)
returns table (
  comment_id uuid,
  author_id uuid,
  username extensions.citext,
  display_name text,
  avatar_path text,
  body text,
  created_at timestamptz,
  can_delete boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.author_id,
    pr.username,
    pr.display_name,
    pr.avatar_path,
    c.body,
    c.created_at,
    c.author_id = app.uid() or p.author_id = app.uid()
  from public.post_comments c
  join public.posts p on p.id = c.post_id
  join public.profiles pr on pr.id = c.author_id
  where c.post_id = p_post_id
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

-- Who wrote the post and whether it takes comments (the comments screen's header).
create or replace function public.get_post_comment_state(p_post_id uuid)
returns table (author_id uuid, comments_enabled boolean, comment_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.author_id, p.comments_enabled,
    (select count(*) from public.post_comments c where c.post_id = p.id)
  from public.posts p
  where p.id = p_post_id;
$$;

revoke execute on function
  public.add_post_comment(uuid, text),
  public.delete_post_comment(uuid),
  public.set_post_comments(uuid, boolean),
  public.get_post_comments(uuid, integer),
  public.get_post_comment_state(uuid)
from public, anon, anonymous;
grant execute on function
  public.add_post_comment(uuid, text),
  public.delete_post_comment(uuid),
  public.set_post_comments(uuid, boolean),
  public.get_post_comments(uuid, integer),
  public.get_post_comment_state(uuid)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The feed also returns each post's comment count and whether it takes
-- comments. (A new result shape, so the function is replaced.)
-- -----------------------------------------------------------------------------
drop function public.get_feed(timestamptz, integer, uuid, boolean);

create function public.get_feed(
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
    and (p_author is null or p.author_id = p_author)
    and (not p_friends_only or p.author_id = app.uid() or private.are_friends(app.uid(), p.author_id))
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function public.get_feed(timestamptz, integer, uuid, boolean) from public, anon, anonymous;
grant execute on function public.get_feed(timestamptz, integer, uuid, boolean) to authenticated, service_role;
