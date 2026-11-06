-- =============================================================================
-- Notifications.
--
-- The database writes a notification when someone sends you a friend request
-- or accepts yours, challenges you to a ranked match, accepts your challenge,
-- records a ranked match you need to confirm, or likes or comments on your
-- post. Nothing is written for your own actions, between blocked accounts or
-- from banned ones, and a like is notified once however often it is undone
-- and redone.
--
-- Everyone reads their notifications in the app (Activity). The `api`
-- function's push job (jobs/push) also sends them to your phones, for the
-- kinds you leave switched on (notification_settings), through Firebase
-- Cloud Messaging when it is configured.
-- =============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  kind text not null
    constraint notification_kind check (kind in (
      'friend_request', 'friend_accepted',
      'ranked_challenge', 'ranked_accepted', 'ranked_result',
      'post_like', 'post_comment'
    )),
  actor_id uuid not null references app.users (id) on delete cascade,
  -- The post or ranked match it is about (none for friend requests).
  subject_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  -- Set by the push job: 'sent', 'skipped' (switched off, no phone) or 'failed'.
  push_state text constraint notification_push_state check (push_state in ('sent', 'skipped', 'failed')),
  pushed_at timestamptz
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_push_pending_idx on public.notifications (created_at) where push_state is null;
-- One notification per like, however often it is undone and redone.
create unique index notifications_one_per_like on public.notifications (user_id, actor_id, subject_id) where kind = 'post_like';

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, anonymous, authenticated;
-- Read through get_notifications(), marked read through mark_notifications_read().
grant all on public.notifications to service_role;

create table public.notification_settings (
  user_id uuid primary key default app.uid() references app.users (id) on delete cascade,
  friend_requests boolean not null default true,
  ranked boolean not null default true,
  likes boolean not null default true,
  comments boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from public, anon, anonymous, authenticated;
grant select, insert, update on public.notification_settings to authenticated;
grant all on public.notification_settings to service_role;

create policy notification_settings_select on public.notification_settings
  for select to authenticated using (user_id = (select app.uid()));
create policy notification_settings_insert on public.notification_settings
  for insert to authenticated with check (user_id = (select app.uid()));
create policy notification_settings_update on public.notification_settings
  for update to authenticated using (user_id = (select app.uid())) with check (user_id = (select app.uid()));

-- Phones that receive pushes. Written only through the functions below and
-- read only by the push job: a token is never readable by any account.
create table public.push_tokens (
  token text primary key
    constraint push_token_format check (char_length(token) between 16 and 4096 and token !~ '\s'),
  user_id uuid not null references app.users (id) on delete cascade,
  platform text not null constraint push_token_platform check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from public, anon, anonymous, authenticated;
grant all on public.push_tokens to service_role;

-- -----------------------------------------------------------------------------
-- Writing notifications.
-- -----------------------------------------------------------------------------
create or replace function private.notify(p_user uuid, p_kind text, p_actor uuid, p_subject uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or p_actor is null or p_user = p_actor then
    return;
  end if;
  if private.is_banned(p_actor) or private.is_blocked_between(p_user, p_actor) then
    return;
  end if;
  insert into public.notifications (user_id, kind, actor_id, subject_id)
  values (p_user, p_kind, p_actor, p_subject)
  on conflict do nothing;
end;
$$;

revoke all on function private.notify(uuid, text, uuid, uuid) from public;

create or replace function private.notify_friendship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.notify(
      case when new.requested_by = new.user_low then new.user_high else new.user_low end,
      'friend_request', new.requested_by, null);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform private.notify(
      new.requested_by, 'friend_accepted',
      case when new.requested_by = new.user_low then new.user_high else new.user_low end, null);
  end if;
  return null;
end;
$$;

create trigger friendships_notify
  after insert or update of status on public.friendships
  for each row execute function private.notify_friendship();

create or replace function private.notify_ranked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.notify(new.opponent_id, 'ranked_challenge', new.challenger_id, new.id);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform private.notify(new.challenger_id, 'ranked_accepted', new.opponent_id, new.id);
    elsif new.status = 'awaiting_confirmation' then
      -- Fighter 1 recorded it; Fighter 2 checks and confirms the result.
      perform private.notify(new.fighter_b_id, 'ranked_result', new.fighter_a_id, new.id);
    end if;
  end if;
  return null;
end;
$$;

create trigger ranked_matches_notify
  after insert or update of status on public.ranked_matches
  for each row execute function private.notify_ranked();

create or replace function private.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify((select p.author_id from public.posts p where p.id = new.post_id), 'post_like', new.user_id, new.post_id);
  return null;
end;
$$;

create trigger post_likes_notify
  after insert on public.post_likes
  for each row execute function private.notify_post_like();

create or replace function private.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify((select p.author_id from public.posts p where p.id = new.post_id), 'post_comment', new.author_id, new.post_id);
  return null;
end;
$$;

create trigger post_comments_notify
  after insert on public.post_comments
  for each row execute function private.notify_post_comment();

-- -----------------------------------------------------------------------------
-- Whether a notification may still be shown or pushed: not from someone
-- banned or blocked since, and about a post or ranked match that still
-- exists. Activity and the push job (jobs/push) both ask this, right before
-- showing or sending.
-- -----------------------------------------------------------------------------
create or replace function private.notification_visible(p_user uuid, p_kind text, p_actor uuid, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.is_banned(p_actor)
    and not private.is_blocked_between(p_user, p_actor)
    and (p_kind not in ('post_like', 'post_comment') or exists (select 1 from public.posts p where p.id = p_subject))
    and (p_kind not like 'ranked\_%' or exists (select 1 from public.ranked_matches r where r.id = p_subject));
$$;

revoke all on function private.notification_visible(uuid, text, uuid, uuid) from public;
grant execute on function private.notification_visible(uuid, text, uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Reading them (Activity) and marking them read.
-- -----------------------------------------------------------------------------
create or replace function public.get_notifications(p_limit integer default 50)
returns table (
  id uuid,
  kind text,
  actor_id uuid,
  actor_username text,
  actor_display_name text,
  actor_avatar_path text,
  subject_id uuid,
  created_at timestamptz,
  read_at timestamptz
)
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
  return query
    select n.id, n.kind, n.actor_id, pr.username::text, pr.display_name::text, pr.avatar_path::text, n.subject_id, n.created_at, n.read_at
    from public.notifications n
    join public.profiles pr on pr.id = n.actor_id
    where n.user_id = me
      -- Someone blocked or banned since, or a deleted post or ranked match, drops out.
      and private.notification_visible(me, n.kind, n.actor_id, n.subject_id)
    order by n.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.get_notifications(integer) from public, anon, anonymous;
grant execute on function public.get_notifications(integer) to authenticated;

create or replace function public.mark_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := app.uid();
  marked integer;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.notifications set read_at = now() where user_id = me and read_at is null;
  get diagnostics marked = row_count;
  return marked;
end;
$$;

revoke all on function public.mark_notifications_read() from public, anon, anonymous;
grant execute on function public.mark_notifications_read() to authenticated;

-- -----------------------------------------------------------------------------
-- Phones: register on sign-in (a token moves to whoever signs in on that
-- phone), remove on sign-out.
-- -----------------------------------------------------------------------------
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
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
  if p_platform not in ('android', 'ios') or p_token is null or char_length(p_token) not between 16 and 4096 or p_token ~ '\s' then
    raise exception 'invalid push token' using errcode = '22023';
  end if;
  perform private.enforce_rate_limit('push_token:' || me, 20, 3600);
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, me, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
  -- At most ten phones per account: the ones not seen longest go.
  delete from public.push_tokens t
  where t.user_id = me
    and t.token not in (select t2.token from public.push_tokens t2 where t2.user_id = me order by t2.last_seen_at desc limit 10);
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon, anonymous;
grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
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
  delete from public.push_tokens where token = p_token and user_id = me;
  return found;
end;
$$;

revoke all on function public.unregister_push_token(text) from public, anon, anonymous;
grant execute on function public.unregister_push_token(text) to authenticated;
