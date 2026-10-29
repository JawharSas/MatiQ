-- =============================================================================
-- MatIQ: moderation.
--
--   * Bans: the account can no longer sign in (auth.users.banned_until), its
--     sessions end, everything it posted disappears for others, and the IP
--     addresses it used are blocked for 30 days. Only one-way fingerprints of
--     those addresses are stored (HMAC-SHA256 with a key kept here), never the
--     addresses themselves.
--   * Word filter for everything people type: posts that break it are kept
--     but hidden from everyone else and count as a strike (3 strikes in 30
--     days = automatic ban); names, bios, match titles and dispute reasons
--     that break it are refused.
--   * Sexual content found by the AI in match frames or profile pictures
--     bans the account at once (Edge Functions call svc_ban_user) and the
--     files go to a quarantine bucket nobody but the service role can read.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Tables -------------------------------------------------------------------------
create table private.bans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null constraint ban_reason check (char_length(reason) between 1 and 280),
  category text not null constraint ban_category check (category in ('sexual_content', 'text', 'other')),
  source text not null constraint ban_source check (source in ('owner', 'automatic')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- The suspension the account had before the ban, restored when it is lifted.
  prior_suspended boolean not null default false,
  prior_suspended_reason text
);

-- One row per banned account and network: a network two banned accounts used
-- stays blocked until both bans are lifted (or the rows expire).
create table private.banned_ips (
  ip_hash text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (ip_hash, user_id)
);
create index banned_ips_user on private.banned_ips (user_id);

create table private.moderation_strikes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index moderation_strikes_user_time on private.moderation_strikes (user_id, created_at desc);

create table private.blocked_terms (
  term text primary key constraint blocked_term_format check (term ~ '^[a-z0-9]+( [a-z0-9]+)*\*?$' and char_length(term) between 2 and 60),
  category text not null constraint blocked_term_category check (category in ('sexual', 'hate', 'harassment')),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table private.bans enable row level security;
alter table private.banned_ips enable row level security;
alter table private.moderation_strikes enable row level security;
alter table private.blocked_terms enable row level security;
revoke all on private.bans, private.banned_ips, private.moderation_strikes, private.blocked_terms from public, anon, authenticated;

insert into private.settings (key, value) values ('ip_hash_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- Terms that are never part of normal training talk. Whole words only, so
-- "rear naked choke", "mount" or "analysis" are fine; a trailing * matches
-- word endings. The owner adds or removes terms in Owner panel -> Moderation.
insert into private.blocked_terms (term, category) values
  ('porn', 'sexual'), ('porno', 'sexual'), ('pornography', 'sexual'), ('pornhub', 'sexual'), ('xvideos', 'sexual'),
  ('onlyfans', 'sexual'), ('nsfw', 'sexual'), ('nudes', 'sexual'), ('hentai', 'sexual'), ('blowjob', 'sexual'),
  ('blow job', 'sexual'), ('handjob', 'sexual'), ('cumshot', 'sexual'), ('dick pic', 'sexual'), ('dickpic', 'sexual'),
  ('masturbat*', 'sexual'), ('orgasm*', 'sexual'), ('erotic*', 'sexual'), ('sexting', 'sexual'), ('camgirl', 'sexual'),
  ('milf', 'sexual'), ('titties', 'sexual'), ('tits', 'sexual'), ('boobs', 'sexual'), ('pussy', 'sexual'),
  ('cock', 'sexual'), ('dildo', 'sexual'), ('horny', 'sexual'), ('slut', 'sexual'), ('whore', 'sexual'), ('thot', 'sexual'),
  ('rape', 'sexual'), ('rapist', 'sexual'), ('pedo', 'sexual'), ('pedophile', 'sexual'), ('paedo', 'sexual'),
  ('paedophile', 'sexual'), ('child porn', 'sexual'),
  ('nigger', 'hate'), ('nigga', 'hate'), ('faggot', 'hate'), ('fag', 'hate'), ('tranny', 'hate'), ('dyke', 'hate'),
  ('kike', 'hate'), ('spic', 'hate'), ('chink', 'hate'), ('gook', 'hate'), ('wetback', 'hate'), ('beaner', 'hate'),
  ('towelhead', 'hate'), ('raghead', 'hate'), ('paki', 'hate'), ('sieg heil', 'hate'), ('heil hitler', 'hate'),
  ('retard', 'harassment'), ('retarded', 'harassment'), ('kys', 'harassment'), ('kill yourself', 'harassment')
on conflict (term) do nothing;

-- Text filter --------------------------------------------------------------------
-- Lower case, common character swaps (0->o, 1->i, 3->e, 4->a, 5->s, 7->t,
-- @->a, $->s), everything else that is not a letter or digit becomes a space,
-- and letters spelled out one by one ("p o r n", "p.o.r.n") are joined.
create or replace function private.normalize_for_filter(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(translate(lower(coalesce(p_text, '')), '013457@$', 'oieastas'), '[^a-z0-9]+', ' ', 'g'),
    '\m([a-z0-9]) (?=[a-z0-9]\M)', '\1', 'g'
  ));
$$;

-- The first blocked category found in `p_text`, or null.
create or replace function private.text_violation(p_text text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with candidate as (
    select private.normalize_for_filter(p_text) as normal
  ), variants as (
    -- Also with stretched letters squeezed ("pooorn" -> "porn").
    select normal as v from candidate
    union all
    select regexp_replace(normal, '([a-z])\1+', '\1', 'g') from candidate
  )
  select b.category
  from private.blocked_terms b, variants
  where variants.v <> ''
    and variants.v ~ ('\m' || replace(replace(b.term, ' ', '\s*'), '*', '[a-z0-9]*') || '\M')
  limit 1;
$$;

revoke all on function private.text_violation(text) from public;
grant execute on function private.text_violation(text) to authenticated, service_role;

-- Names, bios, titles and reasons: refused when they break the filter.
create or replace function private.reject_blocked_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  col text;
  row_json jsonb := to_jsonb(new);
begin
  foreach col in array tg_argv loop
    if private.text_violation(row_json ->> col) is not null then
      raise exception using errcode = '22023', message = 'content_not_allowed',
        hint = 'This text breaks the MatIQ community rules.';
    end if;
  end loop;
  return new;
end;
$$;

-- New profiles come from sign-up (no session to show an error to), so a
-- name that breaks the filter is replaced with a generated one instead.
create or replace function private.clean_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.text_violation(new.username::text) is not null then
    new.username := 'athlete_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;
  if private.text_violation(new.display_name) is not null then
    new.display_name := new.username::text;
  end if;
  if private.text_violation(new.bio) is not null then
    new.bio := null;
  end if;
  return new;
end;
$$;

create trigger profiles_clean_new before insert on public.profiles
  for each row execute function private.clean_new_profile();
create trigger profiles_text_filter before update of username, display_name, bio on public.profiles
  for each row execute function private.reject_blocked_text('username', 'display_name', 'bio');
create trigger matches_text_filter before insert or update of title, athlete_a_label, athlete_b_label on public.matches
  for each row execute function private.reject_blocked_text('title', 'athlete_a_label', 'athlete_b_label');
create trigger ranked_dispute_text_filter before update of dispute_reason on public.ranked_matches
  for each row execute function private.reject_blocked_text('dispute_reason');

-- Bans ---------------------------------------------------------------------------
create or replace function private.is_banned(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select uid is not null and exists (select 1 from private.bans where user_id = uid);
$$;

revoke all on function private.is_banned(uuid) from public;
grant execute on function private.is_banned(uuid) to authenticated, service_role;

-- One-way fingerprint of an IP address. IPv6 is taken per /64, the block a
-- single home or phone connection usually gets.
create or replace function private.ip_fingerprint(p_ip text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  addr inet;
begin
  begin
    addr := btrim(p_ip)::inet;
  exception when others then
    return null;
  end;
  return encode(extensions.hmac(
    case when family(addr) = 6 then network(set_masklen(addr, 64))::text else host(addr) end,
    (select value from private.settings where key = 'ip_hash_key'),
    'sha256'
  ), 'hex');
end;
$$;

-- Addresses PostgREST saw for this request (the proxy chain included, so an
-- added header can't hide the real address).
create or replace function private.request_ips()
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  headers jsonb;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return '{}';
  end;
  if headers is null then
    return '{}';
  end if;
  return array_remove(
    array[headers ->> 'cf-connecting-ip', headers ->> 'x-real-ip']
      || coalesce(string_to_array(replace(headers ->> 'x-forwarded-for', ' ', ''), ','), '{}'),
    null
  );
end;
$$;

create or replace function private.ip_is_banned(p_ips text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.banned_ips where expires_at > now())
     and exists (
       select 1 from private.banned_ips b
       where b.expires_at > now()
         and b.ip_hash in (select private.ip_fingerprint(ip) from unnest(p_ips) as ip)
     );
$$;

revoke all on function private.ip_fingerprint(text), private.request_ips(), private.ip_is_banned(text[]) from public;
grant execute on function private.ip_fingerprint(text), private.request_ips(), private.ip_is_banned(text[]) to authenticated, anon, service_role;

-- The fixed actor recorded for automatic actions.
create or replace function private.system_actor()
returns uuid
language sql
immutable
set search_path = ''
as $$
  select '00000000-0000-0000-0000-000000000000'::uuid;
$$;

create or replace function private.apply_ban(p_user uuid, p_reason text, p_category text, p_source text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_suspended boolean;
  was_reason text;
begin
  if exists (select 1 from public.user_entitlements where user_id = p_user and role = 'owner') then
    raise exception 'the owner account cannot be banned' using errcode = '22023';
  end if;

  select is_suspended, suspended_reason into was_suspended, was_reason
  from public.user_entitlements where user_id = p_user;
  -- A second ban keeps the state from before the first.
  insert into private.bans (user_id, reason, category, source, created_by, prior_suspended, prior_suspended_reason)
  values (p_user, left(btrim(p_reason), 280), p_category, p_source, nullif(p_actor, private.system_actor()),
          coalesce(was_suspended, false), was_reason)
  on conflict (user_id) do update
  set reason = excluded.reason, category = excluded.category, source = excluded.source,
      created_by = excluded.created_by, created_at = now();

  update public.user_entitlements
  set is_suspended = true, suspended_reason = left('Banned: ' || btrim(p_reason), 280)
  where user_id = p_user;

  -- Fingerprints of the addresses the account used in the last 30 days.
  begin
    insert into private.banned_ips (ip_hash, user_id, expires_at)
    select distinct f.hash, p_user, now() + interval '30 days'
    from auth.sessions s, lateral (select private.ip_fingerprint(host(s.ip)) as hash) f
    where s.user_id = p_user and s.ip is not null and f.hash is not null
    on conflict (ip_hash, user_id) do update set expires_at = excluded.expires_at;
  exception when undefined_column or undefined_table or insufficient_privilege then
    null;
  end;
  begin
    -- ip_address is free text: entries that aren't an address are skipped.
    insert into private.banned_ips (ip_hash, user_id, expires_at)
    select distinct f.hash, p_user, now() + interval '30 days'
    from auth.audit_log_entries a, lateral (select private.ip_fingerprint(a.ip_address) as hash) f
    where a.payload ->> 'actor_id' = p_user::text
      and a.created_at > now() - interval '30 days'
      and f.hash is not null
    on conflict (ip_hash, user_id) do update set expires_at = excluded.expires_at;
  exception when undefined_column or undefined_table or insufficient_privilege then
    null;
  end;

  -- Supabase Auth refuses sign-in and token refresh; current sessions end.
  -- (The ban holds without these too: the request hook and the functions
  -- refuse banned accounts.)
  begin
    update auth.users set banned_until = now() + interval '100 years' where id = p_user;
  exception when insufficient_privilege then
    raise warning 'could not set banned_until for %', p_user;
  end;
  begin
    delete from auth.sessions where user_id = p_user;
  exception when undefined_table or insufficient_privilege then
    null;
  end;

  insert into private.admin_audit_log (actor_id, target_user_id, action, old_value, new_value, reason)
  values (p_actor, p_user, 'ban', null, jsonb_build_object('category', p_category, 'source', p_source), left(btrim(p_reason), 280));
end;
$$;

-- Posts: a post that breaks the filter is hidden from everyone but its author
-- (the app then deletes it) and counts as a strike. Three strikes in 30 days
-- ban the account.
alter table public.posts add column moderation text
  constraint post_moderation check (moderation is null or moderation in ('blocked'));

create or replace function private.record_strike(p_user uuid, p_kind text, p_detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Keep moderation records no longer than they are needed.
  delete from private.moderation_strikes where created_at < now() - interval '90 days';
  delete from private.banned_ips where expires_at < now();
  insert into private.moderation_strikes (user_id, kind, detail) values (p_user, p_kind, left(p_detail, 280));
  if (select count(*) from private.moderation_strikes where user_id = p_user and created_at > now() - interval '30 days') >= 3
     and not private.is_banned(p_user)
     and not exists (select 1 from public.user_entitlements where user_id = p_user and role = 'owner') then
    perform private.apply_ban(p_user, 'Automatic: three posts that broke the community rules in 30 days', 'text', 'automatic', private.system_actor());
  end if;
end;
$$;

create or replace function private.moderate_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category text := private.text_violation(new.body);
begin
  if category is null then
    new.moderation := null;
  else
    new.moderation := 'blocked';
    perform private.record_strike(new.author_id, 'post:' || category, new.body);
  end if;
  return new;
end;
$$;

create trigger posts_moderation before insert or update of body on public.posts
  for each row execute function private.moderate_post();

drop policy posts_select on public.posts;
create policy posts_select on public.posts
  for select to authenticated
  using (
    (moderation is null or author_id = (select auth.uid()))
    and private.can_view_author_content((select auth.uid()), author_id, friends_only)
  );

-- Banned accounts disappear for everyone else.
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
    when private.is_banned(author) then false
    when private.is_blocked_between(viewer, author) then false
    when not friends_only and exists (
      select 1 from public.profiles where id = author and visibility = 'public'
    ) then true
    else private.are_friends(viewer, author)
  end;
$$;

create policy profiles_hide_banned on public.profiles
  as restrictive for select to authenticated
  using (id = (select auth.uid()) or not private.is_banned(id));

-- Matches of banned accounts, and matches shared only in hidden posts, are
-- not visible to others.
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
        or (
          not private.is_banned(m.owner_id)
          and (
            exists (
              select 1 from public.posts p
              where p.match_id = m.id
                and p.moderation is null
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
        )
      )
  );
$$;

-- Video files: other people only once the analysis, which includes the
-- content check, has completed (a ranked opponent sees the match itself
-- earlier, but not the footage).
drop policy match_videos_select on storage.objects;
create policy match_videos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'match-videos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (
        storage.filename(name) in ('video.mp4', 'video.mov')
        and created_at >= (select private.videos_clean_since())
        and exists (
          select 1 from public.matches m
          where m.id = private.try_uuid((storage.foldername(name))[2]) and m.status = 'completed'
        )
        and private.can_view_match(private.try_uuid((storage.foldername(name))[2]))
      )
    )
  );

-- Profile pages (SECURITY DEFINER, so RLS does not hide banned accounts).
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
    and not private.is_blocked_between(auth.uid(), p.id)
    and (p.id = auth.uid() or not private.is_banned(p.id));
$$;

-- Storage: banned accounts can't upload.
create policy objects_insert_not_banned on storage.objects
  as restrictive for insert to authenticated
  with check (not private.is_banned((select auth.uid())));
create policy objects_update_not_banned on storage.objects
  as restrictive for update to authenticated
  using (not private.is_banned((select auth.uid())))
  with check (not private.is_banned((select auth.uid())));

-- Profile pictures are checked before anyone sees them: the app uploads
-- {user}/pending.jpg, the moderation function checks it and publishes it
-- under a new name as the profile's avatar_path (clients can only clear it).
drop policy avatars_insert on storage.objects;
drop policy avatars_update on storage.objects;
drop policy avatars_select on storage.objects;

create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '/pending.jpg');

create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '/pending.jpg')
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '/pending.jpg');

create policy avatars_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.profiles p where p.avatar_path = storage.objects.name)
    )
  );

create or replace function private.protect_avatar_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.avatar_path is distinct from old.avatar_path and new.avatar_path is not null
     and coalesce(auth.role(), '') <> 'service_role' and current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'avatar_requires_review',
      hint = 'Profile pictures are set by the moderation function.';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_avatar before update of avatar_path on public.profiles
  for each row execute function private.protect_avatar_path();

-- Quarantine for removed media: no policies, so only the service role.
insert into storage.buckets (id, name, public)
values ('moderation-quarantine', 'moderation-quarantine', false)
on conflict (id) do update set public = false;

-- Every Data API request: banned address or account first, then two-factor
-- and the age check.
create or replace function public.check_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.ip_is_banned(private.request_ips()) or private.is_banned(auth.uid()) then
    raise exception using errcode = '42501', message = 'banned',
      hint = 'This account or network is banned from MatIQ.';
  end if;
  perform public.check_request_mfa();
  if coalesce(current_setting('request.method', true), '') in ('GET', 'HEAD') then
    return;
  end if;
  if not private.age_checked() then
    raise exception using errcode = '42501', message = 'age_check_required',
      hint = 'Enter your birth month and year first.';
  end if;
end;
$$;

-- Service functions (Edge Functions) -----------------------------------------------
create or replace function public.svc_ban_user(p_user_id uuid, p_reason text, p_category text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_ban(p_user_id, p_reason, p_category, 'automatic', private.system_actor());
end;
$$;

create or replace function public.svc_access_denied(p_user_id uuid, p_ips text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_banned(p_user_id) or private.ip_is_banned(coalesce(p_ips, '{}'));
$$;

create or replace function public.svc_publish_avatar(p_user_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text;
begin
  select avatar_path into previous from public.profiles where id = p_user_id for update;
  update public.profiles set avatar_path = p_path where id = p_user_id;
  return previous;
end;
$$;

revoke execute on function public.svc_ban_user(uuid, text, text), public.svc_access_denied(uuid, text[]),
  public.svc_publish_avatar(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_ban_user(uuid, text, text), public.svc_access_denied(uuid, text[]),
  public.svc_publish_avatar(uuid, text) to service_role;

-- Owner panel ------------------------------------------------------------------------
create or replace function public.admin_ban_user(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
begin
  perform private.enforce_rate_limit('admin_write:' || actor, 60, 60);
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if p_user_id = actor then
    raise exception 'you cannot ban yourself' using errcode = '22023';
  end if;
  perform private.apply_ban(p_user_id, p_reason, 'other', 'owner', actor);
end;
$$;

create or replace function public.admin_unban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
  removed private.bans;
begin
  perform private.enforce_rate_limit('admin_write:' || actor, 60, 60);
  delete from private.bans where user_id = p_user_id returning * into removed;
  if not found then
    raise exception 'this account is not banned' using errcode = 'P0002';
  end if;
  -- Back to the suspension from before the ban, unless it was changed since.
  update public.user_entitlements
  set is_suspended = removed.prior_suspended, suspended_reason = removed.prior_suspended_reason
  where user_id = p_user_id and suspended_reason is not distinct from left('Banned: ' || removed.reason, 280);
  begin
    update auth.users set banned_until = null where id = p_user_id;
  exception when insufficient_privilege then
    raise warning 'could not clear banned_until for %', p_user_id;
  end;
  delete from private.banned_ips where user_id = p_user_id;
  delete from private.moderation_strikes where user_id = p_user_id;
  insert into private.admin_audit_log (actor_id, target_user_id, action, old_value, new_value, reason)
  values (actor, p_user_id, 'unban', jsonb_build_object('category', removed.category, 'source', removed.source, 'reason', removed.reason), null, null);
end;
$$;

create or replace function public.admin_list_bans()
returns table (user_id uuid, username text, reason text, category text, source text, created_at timestamptz, strikes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select b.user_id, p.username::text, b.reason, b.category, b.source, b.created_at,
    (select count(*) from private.moderation_strikes s where s.user_id = b.user_id)
  from private.bans b
  left join public.profiles p on p.id = b.user_id
  where private.require_owner() is not null
  order by b.created_at desc
  limit 200;
$$;

create or replace function public.admin_list_strikes()
returns table (user_id uuid, username text, kind text, detail text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, p.username::text, s.kind, s.detail, s.created_at
  from private.moderation_strikes s
  left join public.profiles p on p.id = s.user_id
  where private.require_owner() is not null
  order by s.created_at desc
  limit 100;
$$;

create or replace function public.admin_list_blocked_terms()
returns table (term text, category text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.term, b.category, b.created_at from private.blocked_terms b
  where private.require_owner() is not null
  order by b.category, b.term;
$$;

create or replace function public.admin_add_blocked_term(p_term text, p_category text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
  term text := btrim(regexp_replace(lower(coalesce(p_term, '')), '\s+', ' ', 'g'));
begin
  perform private.enforce_rate_limit('admin_write:' || actor, 60, 60);
  insert into private.blocked_terms (term, category, added_by) values (term, p_category, actor)
  on conflict on constraint blocked_terms_pkey do update set category = excluded.category;
  insert into private.admin_audit_log (actor_id, action, new_value) values (actor, 'add_blocked_term', jsonb_build_object('term', term, 'category', p_category));
exception when check_violation then
  raise exception 'use 2 to 60 letters or digits (spaces between words, * at the end for any ending)' using errcode = '22023';
end;
$$;

create or replace function public.admin_remove_blocked_term(p_term text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_owner();
begin
  perform private.enforce_rate_limit('admin_write:' || actor, 60, 60);
  delete from private.blocked_terms where term = lower(btrim(p_term));
  if not found then
    raise exception 'not on the list' using errcode = 'P0002';
  end if;
  insert into private.admin_audit_log (actor_id, action, old_value) values (actor, 'remove_blocked_term', jsonb_build_object('term', lower(btrim(p_term))));
end;
$$;

revoke execute on function public.admin_ban_user(uuid, text), public.admin_unban_user(uuid), public.admin_list_bans(),
  public.admin_list_strikes(), public.admin_list_blocked_terms(), public.admin_add_blocked_term(text, text),
  public.admin_remove_blocked_term(text) from public, anon;
grant execute on function public.admin_ban_user(uuid, text), public.admin_unban_user(uuid), public.admin_list_bans(),
  public.admin_list_strikes(), public.admin_list_blocked_terms(), public.admin_add_blocked_term(text, text),
  public.admin_remove_blocked_term(text) to authenticated;

-- Legal documents can have more than one version on a day (2026-10-29.2).
alter table public.legal_acceptances drop constraint legal_version;
alter table public.legal_acceptances add constraint legal_version check (version ~ '^\d{4}-\d{2}-\d{2}(\.\d{1,2})?$');
