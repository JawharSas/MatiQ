-- =============================================================================
-- MatIQ: core tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Profiles: public-facing identity. One row per auth user, created by trigger.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext not null unique
    constraint username_format check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  display_name text not null
    constraint display_name_length check (char_length(display_name) between 1 and 50)
    constraint display_name_safe check (not private.has_unsafe_chars(display_name)),
  bio text not null default ''
    constraint bio_length check (char_length(bio) <= 280)
    constraint bio_safe check (not private.has_unsafe_chars(bio, true)),
  avatar_path text
    constraint avatar_path_format check (avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  primary_discipline public.discipline,
  -- Privacy by default: new accounts are private until the user opts in.
  visibility public.account_visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Avatars must live in the user's own storage folder.
  constraint avatar_path_owner check (starts_with(avatar_path, id::text || '/'))
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Entitlements: role, quota and the owner-controlled "unlimited" flag.
-- Kept out of `profiles` so no client-writable row ever holds privileges.
-- -----------------------------------------------------------------------------
create table public.user_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'user',
  is_unlimited boolean not null default false,
  monthly_analysis_limit integer not null default 10
    constraint monthly_limit_range check (monthly_analysis_limit between 0 and 100000),
  max_video_seconds integer not null default 600
    constraint max_video_seconds_range check (max_video_seconds between 30 and 7200),
  is_suspended boolean not null default false,
  suspended_reason text
    constraint suspended_reason_length check (char_length(suspended_reason) <= 280),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create trigger user_entitlements_touch_updated_at
  before update on public.user_entitlements
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Legal acceptances: immutable record of which ToS / Privacy Policy version a
-- user accepted and when.
-- -----------------------------------------------------------------------------
create table public.legal_acceptances (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  document text not null constraint legal_document check (document in ('terms', 'privacy')),
  version text not null constraint legal_version check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, document, version)
);

-- -----------------------------------------------------------------------------
-- Matches: one recorded or uploaded sparring session.
-- Storage layout (deterministic, enforced by storage policies):
--   match-videos/{owner_id}/{match_id}/video.{mp4|mov}
--   match-frames/{owner_id}/{match_id}/{t_ms}.jpg
-- -----------------------------------------------------------------------------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  discipline public.discipline not null,
  variant text not null constraint variant_format check (variant ~ '^[a-z_]{2,32}$'),
  title text not null default ''
    constraint title_length check (char_length(title) <= 80)
    constraint title_safe check (not private.has_unsafe_chars(title)),
  athlete_a_label text not null default 'Me'
    constraint athlete_a_label_length check (char_length(athlete_a_label) between 1 and 40)
    constraint athlete_a_label_safe check (not private.has_unsafe_chars(athlete_a_label)),
  athlete_b_label text not null default 'Opponent'
    constraint athlete_b_label_length check (char_length(athlete_b_label) between 1 and 40)
    constraint athlete_b_label_safe check (not private.has_unsafe_chars(athlete_b_label)),
  source public.match_source not null,
  status public.match_status not null default 'draft',
  -- Client-declared; re-validated server side against the uploaded frames.
  duration_ms integer not null constraint duration_range check (duration_ms between 1000 and 7200000),
  round_duration_ms integer constraint round_duration_range check (round_duration_ms between 60000 and 1800000),
  -- Written by the analysis worker (service role) only.
  frame_count integer not null default 0 constraint frame_count_range check (frame_count between 0 and 2000),
  has_video boolean not null default false,
  error_code text constraint error_code_format check (error_code ~ '^[a-z_]{1,48}$'),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index matches_owner_created_idx on public.matches (owner_id, created_at desc);

create trigger matches_touch_updated_at
  before update on public.matches
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Analyses: AI-detected events + the deterministic scorecard. Written only by
-- the analysis worker; one current analysis per match.
-- -----------------------------------------------------------------------------
create table public.match_analyses (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matches (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  ruleset_version text not null,
  model text not null,
  events jsonb not null constraint events_is_array check (jsonb_typeof(events) = 'array'),
  scorecard jsonb not null constraint scorecard_is_object check (jsonb_typeof(scorecard) = 'object'),
  coaching_summary text constraint coaching_summary_length check (char_length(coaching_summary) <= 4000),
  created_at timestamptz not null default now()
);

create index match_analyses_owner_idx on public.match_analyses (owner_id);

-- -----------------------------------------------------------------------------
-- Friend graph. One row per unordered pair (user_low < user_high).
-- Declined requests are deleted; accepted rows are friendships.
-- -----------------------------------------------------------------------------
create table public.friendships (
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_low, user_high),
  constraint friendship_ordered check (user_low < user_high),
  constraint friendship_requester check (requested_by = user_low or requested_by = user_high)
);

create index friendships_high_idx on public.friendships (user_high, status);
create index friendships_low_idx on public.friendships (user_low, status);

create table public.blocks (
  blocker_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint block_not_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

-- -----------------------------------------------------------------------------
-- Posts: scorecards / highlights shared to the feed.
-- Effective audience: public account and not friends_only -> everyone,
-- otherwise accepted friends only.
-- -----------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  match_id uuid references public.matches (id) on delete cascade,
  body text not null default ''
    constraint body_length check (char_length(body) <= 500)
    constraint body_safe check (not private.has_unsafe_chars(body, true)),
  highlight_start_ms integer constraint highlight_start_range check (highlight_start_ms >= 0),
  highlight_end_ms integer,
  friends_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_has_content check (char_length(body) > 0 or match_id is not null),
  constraint highlight_window check (
    (highlight_start_ms is null and highlight_end_ms is null)
    or (
      highlight_start_ms is not null
      and highlight_end_ms is not null
      and match_id is not null
      and highlight_end_ms > highlight_start_ms
      and highlight_end_ms - highlight_start_ms <= 60000
    )
  )
);

create index posts_created_idx on public.posts (created_at desc);
create index posts_author_created_idx on public.posts (author_id, created_at desc);
create index posts_match_idx on public.posts (match_id) where match_id is not null;

create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function private.touch_updated_at();

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index post_likes_user_idx on public.post_likes (user_id);

-- -----------------------------------------------------------------------------
-- Usage ledger: one row per analysis. Reservations are taken atomically before
-- any AI call and committed or refunded afterwards.
-- -----------------------------------------------------------------------------
create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id uuid references public.matches (id) on delete set null,
  kind text not null default 'analysis' constraint usage_kind check (kind in ('analysis')),
  key_source text not null constraint usage_key_source check (key_source in ('platform', 'byok')),
  units integer not null constraint usage_units check (units >= 0),
  status public.usage_status not null default 'reserved',
  period_start date not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index usage_ledger_user_period_idx on public.usage_ledger (user_id, period_start) where status <> 'refunded';
create index usage_ledger_match_idx on public.usage_ledger (match_id) where status = 'reserved';

-- -----------------------------------------------------------------------------
-- Private tables (never exposed through the Data API).
-- -----------------------------------------------------------------------------

-- Single-row application settings.
create table private.app_config (
  id boolean primary key default true constraint app_config_singleton check (id),
  -- When true, owner-panel RPCs require an MFA-verified session (aal2).
  owner_requires_mfa boolean not null default false,
  default_monthly_analysis_limit integer not null default 10,
  default_max_video_seconds integer not null default 600
);
insert into private.app_config (id) values (true);

-- Encrypted bring-your-own-key provider keys. Ciphertext is produced by the
-- `api-keys` Edge Function with AES-256-GCM; the key-encryption key never
-- touches the database.
create table private.user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null constraint api_key_provider check (provider in ('anthropic')),
  ciphertext text not null constraint api_key_ciphertext check (char_length(ciphertext) between 16 and 4096),
  iv text not null constraint api_key_iv check (char_length(iv) = 16),
  key_version smallint not null constraint api_key_version check (key_version > 0),
  last4 text not null constraint api_key_last4 check (last4 ~ '^[A-Za-z0-9_-]{4}$'),
  fingerprint text not null constraint api_key_fingerprint check (fingerprint ~ '^[0-9a-f]{16}$'),
  label text constraint api_key_label check (char_length(label) <= 40),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, provider)
);

-- Fixed-window rate-limit counters.
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- Append-only audit trail of owner-panel actions.
create table private.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_user_id uuid,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_idx on private.admin_audit_log (created_at desc);

create or replace function private.forbid_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only';
end;
$$;

create trigger admin_audit_log_append_only
  before update or delete on private.admin_audit_log
  for each row execute function private.forbid_audit_mutation();
