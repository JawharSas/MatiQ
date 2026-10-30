-- =============================================================================
-- Read-only mode, for the move to Neon (docs/NEON_CLERK_MIGRATION.md, "Cutover").
--
-- With private.settings 'read_only' = 'on' nothing new can be written: the
-- Data API refuses every write (update_required), and so do Storage uploads
-- and the Edge Functions (svc_read_only). The data then stays exactly as it
-- was copied to Neon, and app versions still on Supabase can only read. The
-- real data move turns it on before it copies anything; it is off otherwise.
-- =============================================================================

create or replace function private.read_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.value = 'on' from private.settings s where s.key = 'read_only'), false);
$$;
grant execute on function private.read_only() to anon, authenticated, service_role;

-- As in 20261029000500_moderation.sql, plus the read-only check for writes.
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
  if private.read_only() then
    raise exception using errcode = '42501', message = 'update_required',
      hint = 'MatIQ has moved. Install the latest version to keep going.';
  end if;
  if not private.age_checked() then
    raise exception using errcode = '42501', message = 'age_check_required',
      hint = 'Enter your birth month and year first.';
  end if;
end;
$$;

-- Storage: no uploads, replacements or deletions (reading stays allowed).
create policy objects_insert_read_only on storage.objects
  as restrictive for insert to authenticated
  with check (not (select private.read_only()));
create policy objects_update_read_only on storage.objects
  as restrictive for update to authenticated
  using (not (select private.read_only()))
  with check (not (select private.read_only()));
create policy objects_delete_read_only on storage.objects
  as restrictive for delete to authenticated
  using (not (select private.read_only()));

-- For the Edge Functions, which write as the service role.
create or replace function public.svc_read_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.read_only();
$$;
revoke execute on function public.svc_read_only() from public, anon, authenticated;
grant execute on function public.svc_read_only() to service_role;
