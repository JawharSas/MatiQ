-- =============================================================================
-- Two-factor authentication enforcement.
--
-- Once a user has a verified TOTP factor, a password-only (aal1) session is
-- not enough to read or change their data: it must be stepped up to aal2.
-- The app shows a challenge screen for this, but a stolen password must not
-- be usable against the API directly, so it is enforced here:
--
--   * RESTRICTIVE RLS policies on every user-data table and on storage
--     objects (covers the Data API, Realtime and the Storage API);
--   * a PostgREST pre-request hook (covers SECURITY DEFINER RPCs, which
--     bypass RLS);
--   * the Edge Function middleware checks the same rule (see
--     supabase/functions/_shared/mfa.ts).
--
-- Users without a verified factor are unaffected.
-- =============================================================================

-- True unless the caller has a verified factor and this session has not
-- completed it. Wrapped in `(select ...)` in policies so it runs once per
-- statement, not once per row.
create or replace function private.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
    or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    );
$$;

revoke all on function private.mfa_satisfied() from public;
grant execute on function private.mfa_satisfied() to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_entitlements', 'legal_acceptances', 'matches', 'match_analyses', 'match_live_batches',
    'friendships', 'blocks', 'posts', 'post_likes', 'usage_ledger'
  ] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()))',
      t || '_require_mfa', t
    );
  end loop;
end;
$$;

create policy objects_require_mfa on storage.objects
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied()))
  with check ((select private.mfa_satisfied()));

-- PostgREST runs this before every Data API request (tables and RPCs). It
-- lives in `public` because anon requests run it too; it only raises.
create or replace function public.check_request_mfa()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.mfa_satisfied() then
    raise exception using errcode = '42501', message = 'mfa_required',
      hint = 'Complete two-factor verification for this session.';
  end if;
end;
$$;

revoke all on function public.check_request_mfa() from public;
grant execute on function public.check_request_mfa() to anon, authenticated, service_role;

do $$
begin
  -- The `authenticator` role only exists on a Supabase stack.
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.check_request_mfa';
    notify pgrst, 'reload config';
  end if;
end;
$$;
