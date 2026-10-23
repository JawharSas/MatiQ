-- =============================================================================
-- MatIQ: storage buckets and object policies
-- =============================================================================
-- All buckets are PRIVATE: objects are only reachable through RLS-checked
-- requests or short-lived signed URLs. Storage encrypts objects at rest
-- (AES-256) and is only served over TLS.
--
-- Layout:
--   match-videos/{owner_id}/{match_id}/video.mp4|video.mov
--   match-frames/{owner_id}/{match_id}/{t_ms}.jpg   (deleted after analysis)
--   avatars/{owner_id}/{file}
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('match-videos', 'match-videos', false, 524288000, array['video/mp4', 'video/quicktime']),
  ('match-frames', 'match-frames', false, 1048576, array['image/jpeg']),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- True when `object_name` is {auth.uid()}/{match_id}/... for a match the
-- caller owns.
create or replace function private.owns_match_folder(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.matches m
    where m.owner_id = auth.uid()
      and m.owner_id::text = (storage.foldername(object_name))[1]
      and m.id = private.try_uuid((storage.foldername(object_name))[2])
  );
$$;

grant execute on function private.owns_match_folder(text) to authenticated, service_role;

-- match-videos -----------------------------------------------------------------
create policy match_videos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'match-videos'
    and private.owns_match_folder(name)
    and storage.filename(name) in ('video.mp4', 'video.mov')
  );

create policy match_videos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'match-videos' and private.owns_match_folder(name))
  with check (
    bucket_id = 'match-videos'
    and private.owns_match_folder(name)
    and storage.filename(name) in ('video.mp4', 'video.mov')
  );

-- Owners, plus viewers of a post that shares the match (privacy rules apply).
create policy match_videos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'match-videos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.can_view_match(private.try_uuid((storage.foldername(name))[2]))
    )
  );

create policy match_videos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'match-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- match-frames: analysis input only, never shared ----------------------------------
create policy match_frames_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'match-frames'
    and private.owns_match_folder(name)
    and storage.filename(name) ~ '^\d{1,8}\.jpg$'
  );

create policy match_frames_select on storage.objects
  for select to authenticated
  using (bucket_id = 'match-frames' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy match_frames_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'match-frames' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- avatars ------------------------------------------------------------------------
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy avatars_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
