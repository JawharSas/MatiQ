-- A small Supabase-shaped source for scripts/test-move-to-neon.sh: four
-- people (Alex: password and two-factor; Sam: Google only; Kim: never
-- confirmed the email; Bo: banned), a match, a post, a friendship, rating
-- history (identity IDs), files, and rows that must not move (a stored AI
-- key, rate-limit counters).

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'alex@example.test', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BWX4Z3mJJdlhNWpFtnKsqqq7c1nS', now(), '{"username": "alex_moves", "display_name": "Alex"}', now() - interval '60 days'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'sam@example.test', null, now(), '{"username": "sam_google", "display_name": "Sam"}', now() - interval '40 days'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'kim@example.test', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BWX4Z3mJJdlhNWpFtnKsqqq7c1nS', null, '{"username": "kim_pending"}', now() - interval '20 days'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'bo@example.test', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BWX4Z3mJJdlhNWpFtnKsqqq7c1nS', now(), '{"username": "bo_banned"}', now() - interval '10 days');

insert into auth.mfa_factors (user_id, factor_type, status, secret) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'totp', 'verified', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
insert into auth.sessions (user_id, ip) values ('aaaaaaaa-0000-4000-8000-000000000001', '203.0.113.7');
insert into auth.audit_log_entries (payload, ip_address) values ('{"action": "login"}', '203.0.113.7');

insert into public.matches (id, owner_id, discipline, variant, source, duration_ms) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'bjj', 'ibjjf', 'upload', 300000);
insert into public.posts (author_id, match_id, body) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Good round');
insert into public.friendships (user_low, user_high, requested_by, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'accepted');
insert into public.rating_history (user_id, discipline, outcome, rating_before, rating_after, delta) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'bjj', 'win', 1000, 1016, 16),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'bjj', 'loss', 1000, 984, -16);

insert into private.user_api_keys (user_id, provider, ciphertext, iv, key_version, last4, fingerprint) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'openai', 'Y2lwaGVydGV4dC1ub3QtcmVhbA==', 'aXYtbm90LXJlYWwh', 1, 'abcd', '0123456789abcdef');
insert into private.rate_limits (key, window_start, hits) values ('test', now(), 3);

do $$ begin perform public.svc_ban_user('aaaaaaaa-0000-4000-8000-000000000004', 'test ban', 'other'); end $$;

insert into storage.objects (bucket_id, name, owner, metadata) values
  ('avatars', 'aaaaaaaa-0000-4000-8000-000000000001/avatar.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', '{"size": 4, "mimetype": "image/jpeg"}'),
  ('match-frames', 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000001/1000.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', '{"size": 3, "mimetype": "image/jpeg"}'),
  ('match-videos', 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000001/video.mp4', 'aaaaaaaa-0000-4000-8000-000000000001', '{"size": 99, "mimetype": "video/mp4"}');
