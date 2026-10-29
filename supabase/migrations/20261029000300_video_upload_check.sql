-- =============================================================================
-- MatIQ: uploaded videos are checked before anyone can watch them.
--
--   match-videos/{owner_id}/{match_id}/upload.mp4|upload.mov   written by the app
--   match-videos/{owner_id}/{match_id}/checking.*              being checked
--   match-videos/{owner_id}/{match_id}/video.mp4|video.mov     published
--
-- The app checks the whole file on the phone and uploads it as `upload.*`.
-- analyze-match moves it to `checking.*`, checks it again and publishes it as
-- `video.*` (see supabase/functions/analyze-match/video.ts). Clients can only
-- write `upload.*`, so every `video.*` object passed the server check, and
-- people a match is shared with can only read `video.*`.
-- =============================================================================

drop policy match_videos_insert on storage.objects;
drop policy match_videos_update on storage.objects;
drop policy match_videos_select on storage.objects;

create policy match_videos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'match-videos'
    and private.owns_match_folder(name)
    and storage.filename(name) in ('upload.mp4', 'upload.mov')
  );

create policy match_videos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'match-videos'
    and private.owns_match_folder(name)
    and storage.filename(name) in ('upload.mp4', 'upload.mov')
  )
  with check (
    bucket_id = 'match-videos'
    and private.owns_match_folder(name)
    and storage.filename(name) in ('upload.mp4', 'upload.mov')
  );

-- Owners see everything in their folders; viewers of a shared match only the
-- published video.
create policy match_videos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'match-videos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (
        storage.filename(name) in ('video.mp4', 'video.mov')
        and private.can_view_match(private.try_uuid((storage.foldername(name))[2]))
      )
    )
  );
