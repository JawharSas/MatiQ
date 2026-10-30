-- =============================================================================
-- Network bans only for private networks.
--
-- A ban used to block every network the account used in the last 30 days.
-- On a shared network (a gym's Wi-Fi, a school, a mobile carrier putting many
-- phones behind one address) that also locked out everyone else there. Now a
-- network is blocked only when it is private to the banned person:
--
--   * never an address outside the public internet (private, carrier-grade
--     NAT, NAT64, loopback, link-local and other reserved ranges): those are
--     shared or internal by definition;
--   * only when no other account that isn't banned used the same network
--     (IPv4 address, or IPv6 /64) in the last 30 days.
--
-- The ban records how many networks were blocked and how many were skipped
-- as shared, for the owner panel. Blocks that already exist and turn out to
-- cover a shared network are lifted here as well.
-- =============================================================================

alter table private.bans
  add column networks_blocked integer not null default 0,
  add column networks_shared integer not null default 0;

-- An address as inet, or null when the text isn't one (the auth log keeps text).
create or replace function private.try_inet(p_value text)
returns inet
language plpgsql
immutable
set search_path = ''
as $$
begin
  return btrim(p_value)::inet;
exception when others then
  return null;
end;
$$;

-- The network an address belongs to: the address itself for IPv4, its /64 for IPv6.
create or replace function private.network_of(p_ip inet)
returns cidr
language sql
immutable
set search_path = ''
as $$
  select network(set_masklen(p_ip, case when family(p_ip) = 6 then 64 else 32 end));
$$;

-- False for addresses outside the public internet, which are always shared or internal.
create or replace function private.is_public_address(p_ip inet)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not (p_ip <<= any (array[
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
    '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
    '::/128', '::1/128', '::ffff:0:0/96', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64',
    'fc00::/7', 'fe80::/10', 'ff00::/8'
  ]::inet[]));
$$;

-- The networks an account used in the last 30 days (sessions and sign-in log).
create or replace function private.networks_used_by(p_user uuid)
returns cidr[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  nets cidr[] := '{}';
  more cidr[];
begin
  begin
    select coalesce(array_agg(distinct private.network_of(s.ip)), '{}') into more
    from auth.sessions s
    where s.user_id = p_user and s.ip is not null;
    nets := nets || more;
  exception when undefined_column or undefined_table or insufficient_privilege then
    null;
  end;
  begin
    select coalesce(array_agg(distinct private.network_of(private.try_inet(a.ip_address))), '{}') into more
    from auth.audit_log_entries a
    where a.payload ->> 'actor_id' = p_user::text
      and a.created_at > now() - interval '30 days'
      and private.try_inet(a.ip_address) is not null;
    nets := nets || more;
  exception when undefined_column or undefined_table or insufficient_privilege then
    null;
  end;
  return array(select distinct unnest(nets));
end;
$$;

-- True when an account other than p_user, and not banned, used the network in the last 30 days.
create or replace function private.network_shared(p_net cidr, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  begin
    if exists (
      select 1 from auth.sessions s
      where s.user_id <> p_user and s.ip is not null
        and private.network_of(s.ip) = p_net
        and not private.is_banned(s.user_id)
    ) then
      return true;
    end if;
  exception when undefined_column or undefined_table or insufficient_privilege then
    null;
  end;
  begin
    return exists (
      select 1 from auth.audit_log_entries a
      where a.created_at > now() - interval '30 days'
        and private.try_uuid(a.payload ->> 'actor_id') <> p_user
        and private.network_of(private.try_inet(a.ip_address)) = p_net
        and not private.is_banned(private.try_uuid(a.payload ->> 'actor_id'))
    );
  exception when undefined_column or undefined_table or insufficient_privilege then
    return false;
  end;
end;
$$;

-- Blocks the networks that are private to the account; returns (blocked, shared).
create or replace function private.block_private_networks(p_user uuid, out blocked integer, out shared integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  net cidr;
begin
  blocked := 0;
  shared := 0;
  foreach net in array private.networks_used_by(p_user) loop
    if not private.is_public_address(net) or private.network_shared(net, p_user) then
      shared := shared + 1;
      continue;
    end if;
    insert into private.banned_ips (ip_hash, user_id, expires_at)
    values (private.ip_fingerprint(host(net)), p_user, now() + interval '30 days')
    on conflict (ip_hash, user_id) do update set expires_at = excluded.expires_at;
    blocked := blocked + 1;
  end loop;
end;
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
  networks record;
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

  -- Only networks nobody else uses (see the top of this file).
  select * into networks from private.block_private_networks(p_user);
  update private.bans set networks_blocked = networks.blocked, networks_shared = networks.shared where user_id = p_user;

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
  values (p_actor, p_user, 'ban', null,
          jsonb_build_object('category', p_category, 'source', p_source, 'networks_blocked', networks.blocked, 'networks_shared', networks.shared),
          left(btrim(p_reason), 280));
end;
$$;

drop function public.admin_list_bans();
create function public.admin_list_bans()
returns table (
  user_id uuid,
  username text,
  reason text,
  category text,
  source text,
  created_at timestamptz,
  strikes bigint,
  networks_blocked integer,
  networks_shared integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.user_id, p.username::text, b.reason, b.category, b.source, b.created_at,
    (select count(*) from private.moderation_strikes s where s.user_id = b.user_id),
    b.networks_blocked, b.networks_shared
  from private.bans b
  left join public.profiles p on p.id = b.user_id
  where private.require_owner() is not null
  order by b.created_at desc
  limit 200;
$$;

revoke execute on function public.admin_list_bans() from public, anon;
grant execute on function public.admin_list_bans() to authenticated;

revoke all on function
  private.try_inet(text), private.network_of(inet), private.is_public_address(inet),
  private.networks_used_by(uuid), private.network_shared(cidr, uuid), private.block_private_networks(uuid)
from public;

-- Blocks made before this rule: lift the ones on networks someone else uses.
-- (Only fingerprints are stored, so each is matched against the banned
-- account's own networks.)
do $$
declare
  ban record;
  net cidr;
begin
  for ban in select distinct b.user_id from private.banned_ips b loop
    foreach net in array private.networks_used_by(ban.user_id) loop
      if not private.is_public_address(net) or private.network_shared(net, ban.user_id) then
        delete from private.banned_ips
        where user_id = ban.user_id and ip_hash = private.ip_fingerprint(host(net));
      end if;
    end loop;
  end loop;
end;
$$;
