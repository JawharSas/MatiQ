# Changelog

All notable changes to MatIQ. Versions follow [Semantic Versioning](https://semver.org);
pre-release channels are named in the release title.

## [1.3.0] Pre-Beta, 2026-10-28

### Look and feel
- MatIQ logo: a fighter with both arms raised inside the cage. App icon,
  Android adaptive and themed (monochrome) icons and a dark splash screen
  replace the placeholder Android icon; assets are rendered from the vector
  mark (`npm run brand:assets`).
- Sign-in welcome with the logo, tagline and highlights; logo in the Feed
  header, on sign-up and on two-factor sign-in.
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
