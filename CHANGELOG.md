# Changelog

All notable changes to MatIQ. Versions follow [Semantic Versioning](https://semver.org);
pre-release channels are named in the release title.

## [1.5.0] Pre-Beta, 2026-10-29

### Moderation
- Word filter in the database (`private.blocked_terms`, migration
  `20261029000500_moderation.sql`): text is lower-cased, look-alike
  characters swapped (`0→o`, `1→i`, `3→e`, `4→a`, `5→s`, `7→t`, `@→a`,
  `$→s`), punctuation removed and spelled-out letters joined; terms match
  whole words, also with stretched letters, and `*` catches endings. It
  covers usernames and display names (a sign-up name that breaks it is
  replaced with `athlete_<id>`), bios, match titles and athlete labels,
  dispute notes and posts. Profiles, titles and notes are refused with
  `content_not_allowed`; a post is held back (`posts.moderation =
  'blocked'`, only its author can see it; the app deletes it and says why)
  and recorded as a strike. Three strikes in 30 days ban the account.
- 18+ content check: every analysis batch returns a `safety` result; a
  sexual-content finding with confidence ≥ 0.7 moves the match's frames and
  video to the private `moderation-quarantine` bucket, bans the owner and
  fails the analysis with `content_removed` (full and live analysis).
- Profile pictures: the app uploads `{user}/pending.jpg`, which only its
  owner can read; the new `moderation` function checks it (JPEG, ≤ 2 MB, AI
  check with the platform key) and publishes it under a new name, or
  quarantines it and bans the account. Clients can no longer set
  `avatar_path` (`avatar_requires_review`) or upload any other avatar name.
  Without `ANTHROPIC_API_KEY` new pictures are refused
  (`moderation_unavailable`).
- Bans (`private.bans`): Supabase Auth `banned_until`, sessions deleted,
  entitlements suspended; profile, posts, shared matches and videos hidden
  from everyone else; storage uploads refused. The request hook and the
  function middleware refuse a banned account (`banned`), even for reads.
- Network bans: HMAC-SHA256 fingerprints (keyed, IPv6 per /64) of the
  addresses in the account's sessions and auth log for the last 30 days,
  kept 30 days; requests from those networks are refused for any account.
  Addresses themselves are never stored. Strikes are kept 90 days.
- Owner panel → Moderation: bans with **Lift ban** (also clears the network
  blocks and strikes), the word filter (add and remove words), recent
  strikes; **Ban account** on a user. All audited. The owner account can't
  be banned.
- App: a banned screen (why, contact support, sign out) as soon as the
  server refuses the account; sign-in says when an account is banned
  (email and Google); messages for every new error code.

### Legal
- Terms: Community rules section; bans in Termination. Privacy Policy:
  Moderation and safety section (word filter, strikes, AI checks of frames
  and profile pictures, ban records, network fingerprints, quarantine and
  legal reporting). Both are version `2026-10-29.2`, so everyone accepts
  them again.

### Fixed
- Owner panel tabs no longer break words in two: six tabs wrap onto two rows.

## [1.4.1] Pre-Beta, 2026-10-29

### Uploads
- Full video check before upload (`@matiq/rules-engine/media`): the whole
  file is read on the phone. It must be MP4 or QuickTime with `ftyp` first,
  only known top-level boxes tiling the file exactly, one `moov` with a
  video track in a known codec, no encrypted tracks or external media, every
  chunk inside `mdat` without overlaps and at most a little unreferenced
  padding, and (H.264 / HEVC) every frame's NAL units adding up to the frame
  size. Fragmented MP4 is not accepted. The picker shows progress and says
  why a file is refused; in-app recordings are checked too.
- The app uploads to `upload.{mp4|mov}`; analyze-match moves it to
  `checking.*` (out of the client's reach), checks it again with HTTP range
  reads and publishes it as `video.*` or deletes it. Clients can't write
  `video.*`; people a match is shared with can only read `video.*`
  (migration `20261029000300_video_upload_check.sql`).
- Frames: JPEG start and end markers checked on the phone and the server.

### Privacy
- Location (GPS) and phone make and model are removed from every video
  before upload: `findPersonalMetadata` finds `udta` / `meta` / XMP boxes
  (Android `loci` and `©xyz`, Apple `com.apple.quicktime.location.*`, make,
  model) and GoPro / camera-motion telemetry; a copy is uploaded with those
  boxes blanked to `free` boxes of the same size and telemetry zeroed, so
  the video plays as before.
- Videos published before 1.4.1 may still contain location: only their
  owners can watch them now (migration `20261029000400_privacy_hardening.sql`).
- GraphQL (`pg_graphql`) removed: the app only uses the REST Data API.
- Privacy Policy: IP addresses (security logs only, never shown to other
  users) and the video metadata removal.

### Sign-in
- Device lockout after 5 wrong passwords (30 seconds, doubling up to 15
  minutes); cleared by a successful sign-in.
- Cloudflare Turnstile bot check on email sign-in and sign-up when
  `EXPO_PUBLIC_TURNSTILE_SITE_KEY` is set; Deploy backend turns on CAPTCHA
  protection in Supabase Auth when the `TURNSTILE_SECRET_KEY` secret exists.
- Deploy backend sets the Auth rate limits explicitly (per IP, per 5
  minutes: 30 sign-in / sign-up attempts, 30 code checks, 150 refreshes).

### Keys, headers and dependencies
- The app and the release build refuse a secret or `service_role` Supabase
  key; CI scans the built bundle for secrets (`scripts/scan-bundle.mjs`).
- Function responses add CSP `default-src 'none'`, `frame-ancestors
  'none'`, `X-Frame-Options: DENY`, HSTS, Permissions-Policy and COOP.
- Edge Functions: zod 4.6.5 → 4.6.7 (GHSA-mrhx-c7xc-m3w5).
- CI Dependency audit (`scripts/audit-deps.mjs`: app and Edge Functions,
  high / critical fail unless allow-listed with a reason and review date) and
  Dependency review on pull requests.
- pgTAP `07_rls_and_uploads` (16 tests): RLS on every table, nothing for
  `anon`, no views in the API schema, `svc_*` functions service-only, and the
  upload names.
- `docs/SECURITY_AND_DEPLOYMENT.md` section 10 maps the 21-point security
  checklist to these controls.

### Fixed
- Support, accessibility feedback, reports and the legal pages pointed at
  the placeholder `privacy@example.com` when `EXPO_PUBLIC_SUPPORT_EMAIL` and
  the `EXPO_PUBLIC_DMCA_AGENT_*` variables were not set. They now fall back
  to the public issue tracker (copyright notices, which carry personal
  details, never do), and the release build warns about each missing value.
- The Owner panel could stay hidden for up to 15 minutes after the age
  screen: the owner lookup is now a read (GET), which the server allows
  before the age check.
- Email sign-ups were asked to tick "I agree" again on first sign-in: the
  consent from the sign-up form is now saved right after the age check
  instead of before it (when the server refuses it).
- **Cancel** on the ranked Dispute form and on the Owner panel's Manage
  section.
- The browser preview's sample backend now refuses writes before the age
  check like the real server, and the walkthrough checks the Owner panel
  right after the age screen.
- The emulator release test scrolls the sign-up form and checks TalkBack
  labels on both halves (the end of the form had moved below the fold).

## [1.4.0] Pre-Beta, 2026-10-29

Not published on its own: the release's emulator check stopped it (the
end of the longer sign-up form was below the fold for the test). Everything
below ships in 1.4.1.

### Accessibility (WCAG 2.2 AA)
- Audit with axe-core 4.14 (WCAG 2.0/2.1/2.2 A and AA rules) on every screen
  of the UI walkthrough, now 50 states including large text, high contrast,
  landscape and 320 px; it runs in CI and in releases and fails on any
  violation. The baseline found 26 violations on 19 screens; all are fixed.
- Contrast: faint grey `#5D6676` → `#8A93A2`, red → `#F87171`, blue →
  `#60A5FA` (all text ≥ 4.5:1 on every surface and badge); filtered-out
  dashboard values stay readable; outlines ≥ 3:1 on inputs, switch tracks,
  checkboxes, option chips and selected segments.
- Names, roles and states: list rows are named by their visible title and
  subtitle, like and highlight buttons include their visible text, radios
  report `aria-checked`, progress bars have names and values, headings have
  the header role, decorative icons and avatars are hidden from screen
  readers, inline links are underlined.
- Status and errors are announced (live regions); loading spinners are named;
  text-only pages are keyboard-scrollable; visible focus ring.
- In-app **Accessibility** settings: text size (up to 1.5×, on top of the
  phone's), high contrast and reduced motion (also follows the phone's
  setting: no transitions, press animations or highlight autoplay). Segmented
  controls stack at large sizes instead of cutting words.
- Orientation unlocked (1.3.4); autocomplete tokens on personal-data fields
  (1.3.5); 44 pt minimum targets.
- Emulator release test: every tappable control on sign-in and sign-up must
  have a TalkBack label; the sign-in screen is checked at 200% font size and
  in landscape.
- `docs/ACCESSIBILITY.md`: criterion-by-criterion conformance report.

### Age check (COPPA) and consent
- Neutral age screen: birth month and year on email sign-up and, for Google
  sign-ups and existing accounts, once before using the app. Under 13: the
  sign-up sends nothing; after a Google sign-in the `account` function
  deletes the account and its storage at once. The device then blocks
  another attempt for 24 hours. Otherwise the month is kept in
  `private.age_checks` (export includes it, deleted with the account).
- Enforced by the server as well: until the age is answered an account can
  read but not create or change anything (RLS on writes, a Data API
  pre-request hook for RPCs, and the Edge Function middleware), so an older
  or modified app can't skip the screen.
- One unticked "I agree to the Terms of Service and Privacy Policy" box
  replaces the three switches; the policy screen has **Cancel** (signs out).
- Privacy Policy and Terms 2026-10-29: children's privacy section, minors
  need a parent's permission, copyright section.
- Migration `20261029000200_age_checks_and_takedowns.sql`, pgTAP
  `06_age_and_takedowns` (33 tests).

### Copyright (DMCA)
- Copyright Policy (notice and counter-notice requirements, repeat
  infringers) with the designated agent from `EXPO_PUBLIC_DMCA_AGENT_*`.
- **Report** on posts: copyright notices go to the agent by email with the
  post identified; anything else to support.
- Owner panel **Content** tab: `admin_remove_post` (owner only, reason
  required, audited against the author).

### Other
- **Cancel** on sign-up, the policy screen, Share and Report.

## [1.3.1] Pre-Beta, 2026-10-29

### Sign-in
- **Continue with Google** on sign-in and sign-up: Supabase OAuth with PKCE
  in the system browser (`expo-web-browser`; Custom Tabs on Android,
  ASWebAuthenticationSession on iOS). The Google client secret stays in
  Supabase; the redirect only carries a one-time code. On Android the
  redirect reaches both the browser session and `/auth/callback`, so the
  code exchange runs once and both wait for it.
- New Google accounts take their display name from Google's `full_name` /
  `name` (trimmed, 50 characters, same unsafe-character check) and get a
  generated username (migration `20261029000100_oauth_profile_names.sql`,
  pgTAP `05_oauth_signup`).
- **Edit profile** can change the username (same rules as sign-up; a taken
  name shows "That is already taken.").
- The policy screen now also confirms the minimum age, since Google
  sign-ups skip the sign-up form.
- `/auth/callback` explains a cancelled Google sign-in instead of showing
  "Link expired".

### Backend
- **Deploy backend** workflow (Actions → Deploy backend): applies the
  migrations, the hardened Auth / Data API / storage settings, the function
  secrets (key-encryption key generated once) and the Edge Functions, from
  the browser. Runs again when backend code reaches `main`; main only.
- Redirect allow-list: `matiq:///auth/callback` (what release builds send)
  as well as `matiq://auth/callback`.

## [1.3.0] Pre-Beta, 2026-10-28

### Look and feel
- MatIQ logo: a fighter with both arms raised inside the cage. App icon,
  Android adaptive and themed (monochrome) icons and a dark splash screen
  replace the placeholder Android icon; assets are rendered from the vector
  mark (`npm run brand:assets`).
- Sign-in welcome with the logo, tagline and highlights; logo in the Feed
  header, on sign-up and on two-factor sign-in.
- Redesigned throughout: deeper borderless surfaces, a type scale with
  section labels, softer tinted accents, 52 pt buttons with icons, inputs
  with a focus ring and a calmer segmented control.
- Feed posts as fight cards (corner colours, big score, winner trophy,
  heart likes, highlight pill); Profile with a header, badges and a grouped
  account menu; Settings as grouped lists with icons; Ranked with a rating
  hero, stat tiles, compact actions and tappable match rows; Analyze with
  sport tiles and corner-coloured fighter sections; the match dashboard with
  a fight-result header and time pills on highlights.
- Match list with sport icons and coloured status badges.
- No bright line under headers; switches use the MatIQ colours; the dark
  background now covers the whole window on Android (no white flashes).

### Fixed
- "WRESTLING" was shown in capitals in the match list and Owner Panel.

### Quality
- Every release is installed and opened on an Android emulator before it
  is published (sign-in and sign-up must render, no crash).

## [1.2.9] Pre-Beta, 2026-10-28

First public pre-beta of MatIQ: AI martial arts analysis for BJJ, wrestling
and MMA, with a ranked ladder and a privacy-first social hub. For testers:
expect rough edges, and treat scores as a training aid.

### Analysis
- Dual input: live recording (hardware-encoded 1080p at 60 FPS, 30 FPS
  minimum, chosen per device) or video upload from the gallery.
- AI frame sampling on the camera's own thread (~1 FPS, motion-pruned),
  progressive uploads through a bounded ring-buffer queue.
- Live analysis: a provisional score over the camera while you record; only
  frames no batch covered are analysed at the end.
- Deterministic two-fighter rules engine (Fighter 1 vs Fighter 2): BJJ
  (IBJJF, IBJJF + reversals, submission only), wrestling (folkstyle,
  freestyle) and MMA (unified, projected 10-point-must rounds).
- Post-match dashboard: tap-to-seek timeline, highlight clips, head-to-head
  stats, technique breakdown, athlete filter, coaching notes, scoring log,
  one-tap retry of failed analyses.

### Ranked ladder
- Challenges between users, recordings linked to the challenge, results
  confirmed by both fighters (a win you record needs your opponent's
  confirmation; disputes go to the Owner Panel).
- Elo with placement matches and a finish multiplier; tiers from Bronze /
  White Belt to Grandmaster / Black Belt with three divisions each.
- Matchmaking by rating, global and friends leaderboards, 16 dynamic titles
  (Submission Wizard, Takedown Machine, Iron Chin, ...).
- Anti-abuse: one open match per pair and discipline, at most 3 ranked
  matches per pair per week, versioned rating writes.

### Social and privacy
- Public or private accounts (private by default), friends, blocks, likes,
  feed of scorecards and highlights; privacy enforced by row-level security.
- Profile pictures re-encoded on the device (location and camera metadata
  removed).
- In-app Privacy Policy (2026-10-28) and Terms: data and videos are never
  sold or shared with data brokers. Data export and account deletion.

### Security
- No secrets in the app: AI keys, the service-role key and key-encryption
  keys stay in Edge Function secrets; bring-your-own API keys are encrypted
  with AES-256-GCM server side and never returned.
- Encrypted on-device storage (MMKV AES-256, key in Keychain / Keystore),
  TLS public-key pinning, rate limits, audited owner actions.
- Optional TOTP two-factor authentication, enforced by the database,
  Storage, Realtime and Edge Functions.

### Owner Panel
- User search, usage overview, per-user limits and suspension, the
  **Unlimited access** (`is_unlimited`) switch, ranked dispute resolution and
  an audit log.

### Fixed during pre-beta QA
- Cold start while signed out (or a deep link) could land on "Unmatched
  route" instead of sign-in; every guarded route now redirects explicitly.
- Duplicate React copies (19.3.0 and 19.3.1) in the dependency tree; pinned
  to one version so hooks can't break at runtime.
- Dashboard timeline, highlights and MMA round notes showed "A" / "B"
  instead of the fighters' names.
- The ladder crashed on web builds when highlighting your own row.
- Tab bar labels were clipped; tabs now have icons.
- Buttons lost their accessible name while loading, and text fields had no
  label for screen readers.
- The two-factor setup key used an iOS-only font.

### Dependencies
- Expo SDK 58.0.21 and React Native 0.88.1 (React stays at 19.3.0, the
  version React Native 0.88 is built for); TanStack Query 5.104.5, Zod 4.6.7.
- Type checking with TypeScript 7.

### Tooling
- Browser UI preview with sample data (`npm run preview:web`) and a
  Playwright walkthrough of every screen (`npm run preview:walkthrough`),
  also run in CI.
- Release workflow: tags `v*` (or a manual run with a tag) build an
  installable Android APK and publish the GitHub release.

### Known limitations
- The Android APK attached to the release is signed with a debug key, for
  sideloading by testers only. Store builds go through EAS (`eas.json`); iOS
  builds need EAS or a Mac.
- The APK needs a configured Supabase project (repository variables
  `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`); without
  them it opens to a "misconfigured" screen.
- No push notifications yet: challenges and confirmations appear live only
  while the app is open.
- No two-factor recovery codes; lost authenticators are recovered by support.
