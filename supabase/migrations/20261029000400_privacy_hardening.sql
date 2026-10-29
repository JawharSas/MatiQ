-- =============================================================================
-- MatIQ: less to find for outsiders, and no location in shared videos.
-- =============================================================================

-- GraphQL: Supabase enables pg_graphql by default, which answers schema
-- questions at /graphql/v1. MatIQ only uses the REST Data API, so it goes.
-- (Guarded: a project where it can't be dropped keeps it, with no grants to
-- anonymous users either way.)
do $$
begin
  drop extension if exists pg_graphql;
exception when others then
  raise notice 'pg_graphql was not dropped: %', sqlerrm;
end;
$$;

-- Shared videos: from 1.4.1 the app removes GPS and phone details from every
-- video before upload. Videos published before this migration were uploaded
-- by older apps and may still contain them, so only their owners can watch
-- them now; people a match is shared with see videos published from now on.
create table private.settings (
  key text primary key,
  value text not null
);
alter table private.settings enable row level security;
revoke all on private.settings from public, anon, authenticated;

insert into private.settings (key, value) values ('videos_clean_since', now()::text)
on conflict (key) do nothing;

create or replace function private.videos_clean_since()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select value::timestamptz from private.settings where key = 'videos_clean_since';
$$;

revoke all on function private.videos_clean_since() from public;
grant execute on function private.videos_clean_since() to authenticated, service_role;

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
        and private.can_view_match(private.try_uuid((storage.foldername(name))[2]))
      )
    )
  );
