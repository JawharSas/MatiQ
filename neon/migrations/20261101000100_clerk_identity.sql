-- =============================================================================
-- Clerk accounts on Neon (docs/NEON_CLERK_MIGRATION.md).
--
-- Applied after supabase/migrations (rewritten by scripts/neon-sql.mjs).
--
--   * register_user: the first time a Clerk user signs in, the app creates
--     their MatIQ account; the sign-up trigger from the Supabase days
--     (private.handle_new_user on app.users) makes the profile and the
--     entitlements as before.
--   * svc_user_for_clerk / svc_link_clerk_user: the functions map a Clerk
--     user to the MatIQ UUID; the import links imported accounts.
--   * svc_record_address: the addresses the functions see, for network bans
--     (Supabase kept these in its session table and sign-in log).
--   * private.clerk_sync: bans and unbans waiting to be applied in Clerk,
--     so a banned account can't sign in either.
-- =============================================================================

-- One row per account and address; the functions update `updated_at`.
create unique index if not exists sessions_user_ip_unique on app.sessions (user_id, ip);

create or replace function public.register_user(p_username text default null, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject text := auth.user_id();
  existing uuid;
  created uuid;
begin
  if subject is null or subject = '' then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- app.uid() also refuses banned accounts and networks.
  existing := app.uid();
  if existing is not null then
    return existing;
  end if;
  perform private.enforce_rate_limit('register:' || subject, 5, 3600);
  insert into app.users (clerk_id, raw_user_meta_data)
  values (
    subject,
    jsonb_strip_nulls(jsonb_build_object(
      'username', left(btrim(p_username), 24),
      'display_name', left(btrim(p_display_name), 50)
    ))
  )
  on conflict (clerk_id) do nothing
  returning id into created;
  return coalesce(created, (select u.id from app.users u where u.clerk_id = subject));
end;
$$;

revoke execute on function public.register_user(text, text) from public, anon, anonymous;
grant execute on function public.register_user(text, text) to authenticated;

-- The MatIQ account of a Clerk user (null when there is none yet).
create or replace function public.svc_user_for_clerk(p_clerk_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from app.users u where u.clerk_id = p_clerk_id;
$$;

-- The import: an account brought over from Supabase gets its Clerk user.
create or replace function public.svc_link_clerk_user(p_user uuid, p_clerk_id text, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app.users set clerk_id = p_clerk_id, email = coalesce(p_email, email) where id = p_user;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
end;
$$;

-- An address the account used (from the functions' requests).
create or replace function public.svc_record_address(p_user uuid, p_ip text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  address inet := private.try_inet(p_ip);
begin
  if address is null or p_user is null then
    return;
  end if;
  insert into app.sessions (user_id, ip, updated_at)
  values (p_user, address, now())
  on conflict (user_id, ip) do update set updated_at = excluded.updated_at;
end;
$$;

revoke execute on function
  public.svc_user_for_clerk(text),
  public.svc_link_clerk_user(uuid, text, text),
  public.svc_record_address(uuid, text)
from public, anon, anonymous, authenticated;
grant execute on function
  public.svc_user_for_clerk(text),
  public.svc_link_clerk_user(uuid, text, text),
  public.svc_record_address(uuid, text)
to service_role;

-- Bans and unbans for Clerk ---------------------------------------------------------
create table if not exists private.clerk_sync (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  clerk_id text not null,
  action text not null constraint clerk_sync_action check (action in ('ban', 'unban', 'delete')),
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);
alter table private.clerk_sync enable row level security;
revoke all on private.clerk_sync from public, anon, anonymous, authenticated;

create or replace function private.queue_clerk_ban()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Rows without a Clerk user answer to their own UUID (see neon/compat.sql).
  if new.clerk_id is null or new.clerk_id = new.id::text then
    return new;
  end if;
  if new.banned_until is distinct from old.banned_until then
    insert into private.clerk_sync (user_id, clerk_id, action)
    values (new.id, new.clerk_id, case when new.banned_until > now() then 'ban' else 'unban' end);
  end if;
  return new;
end;
$$;

drop trigger if exists users_queue_clerk_ban on app.users;
create trigger users_queue_clerk_ban after update of banned_until on app.users
  for each row execute function private.queue_clerk_ban();

create or replace function private.queue_clerk_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.clerk_id is not null and old.clerk_id <> old.id::text then
    insert into private.clerk_sync (user_id, clerk_id, action) values (old.id, old.clerk_id, 'delete');
  end if;
  return old;
end;
$$;

drop trigger if exists users_queue_clerk_delete on app.users;
create trigger users_queue_clerk_delete after delete on app.users
  for each row execute function private.queue_clerk_delete();

-- For the `account` function's scheduled run: the oldest pending changes,
-- and marking them done or failed.
create or replace function public.svc_next_clerk_sync(p_limit integer default 50)
returns table (id bigint, clerk_id text, action text)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.clerk_id, s.action from private.clerk_sync s
  where s.attempts < 10
  order by s.id
  limit least(greatest(p_limit, 1), 200);
$$;

create or replace function public.svc_finish_clerk_sync(p_id bigint, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.clerk_sync where id = p_id and p_error is null;
  update private.clerk_sync set attempts = attempts + 1, last_error = left(p_error, 500)
  where id = p_id and p_error is not null;
$$;

revoke execute on function public.svc_next_clerk_sync(integer), public.svc_finish_clerk_sync(bigint, text)
from public, anon, anonymous, authenticated;
grant execute on function public.svc_next_clerk_sync(integer), public.svc_finish_clerk_sync(bigint, text)
to service_role;
