-- =============================================================================
-- Names only one account may use.
--
-- A reserved name belongs to the account with the listed email. It is
-- compared without case, spaces, punctuation or look-alike digits, so
-- "Coach Max", "coach_max" and "C0achMax" are the same name. Anyone else
-- gets the ordinary answer for a name that is in use: changing a username or
-- display name to one fails as "already taken" (23505), and a new account
-- that brings one from sign-up gets a generated name instead. Nothing says
-- the name is reserved.
--
-- The list lives only in the database (it isn't published with the code).
-- Add a name as the database owner, from the SQL editor:
--   insert into private.reserved_names (name_key, owner_email)
--   values (private.name_key('Some Name'), 'owner@example.com');
-- =============================================================================

create or replace function private.name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(translate(lower(coalesce(p_name, '')), '013457@$', 'oieastas'), '[^a-z0-9]+', '', 'g');
$$;

create table private.reserved_names (
  name_key text primary key constraint reserved_name_key check (name_key ~ '^[a-z0-9]+$'),
  owner_email text not null constraint reserved_name_owner check (owner_email = lower(owner_email) and owner_email like '%@%'),
  created_at timestamptz not null default now()
);
alter table private.reserved_names enable row level security;
revoke all on private.reserved_names from public, anon, anonymous, authenticated;

-- True when `p_name` is reserved for an account other than `p_user`.
create or replace function private.name_reserved_for_other(p_name text, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.reserved_names r
    where r.name_key = private.name_key(p_name)
      and not exists (
        select 1 from app.users u where u.id = p_user and lower(u.email) = r.owner_email
      )
  );
$$;

revoke all on function private.name_key(text), private.name_reserved_for_other(text, uuid) from public;
grant execute on function private.name_key(text), private.name_reserved_for_other(text, uuid) to authenticated, service_role;

-- New profiles come from sign-up (no screen to answer on), so a reserved name
-- is swapped for a generated one, as names that break the word filter are.
create or replace function private.reserved_names_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.name_reserved_for_other(new.username::text, new.id) then
    new.username := 'athlete_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;
  if private.name_reserved_for_other(new.display_name, new.id) then
    new.display_name := new.username::text;
  end if;
  return new;
end;
$$;

-- Changing to a reserved name answers like a name someone already has.
create or replace function private.reserved_names_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.username is distinct from old.username and private.name_reserved_for_other(new.username::text, new.id))
     or (new.display_name is distinct from old.display_name and private.name_reserved_for_other(new.display_name, new.id)) then
    raise exception 'duplicate key value violates unique constraint "profiles_username_key"' using errcode = '23505';
  end if;
  return new;
end;
$$;

-- After profiles_clean_new (triggers fire in name order), so a generated
-- name from either check is final.
create trigger profiles_reserved_new before insert on public.profiles
  for each row execute function private.reserved_names_new_profile();
create trigger profiles_reserved_update before update of username, display_name on public.profiles
  for each row execute function private.reserved_names_profile_update();
