# MatIQ

AI martial-arts analyzer and social hub (BJJ, wrestling, MMA): an Expo / React
Native app for Android and iOS. The backend is moving from Supabase to Neon
(Frankfurt), with sign-in through Clerk (release 1.7.0 Alpha). Both backends
are in the repository until the move is done.

## Layout

- `apps/mobile`: the Expo app (expo-router; screens in `src/app`, logic in
  `src/features/*`, shared UI in `src/ui`, clients in `src/lib`).
- `packages/rules-engine`: scoring rules, ranking (Elo, tiers, titles) and the
  video checker. Shared with the Edge Functions by `scripts/sync-shared.mjs`.
- `neon/`: the Neon backend.
  - `compat.sql` and `migrations/` hold the schema; `supabase/migrations` are
    applied too, rewritten by `scripts/neon-sql.mjs`.
  - `functions/api` is the `api` Neon Function (Hono, Node 24).
  - `tests/` holds the database, API and data-move tests.
  - `neon.ts` (repo root) declares the Data API, buckets, function and schedule.
- `supabase/`: the old backend (migrations, Edge Functions in Deno, pgTAP
  tests). It is still live for app versions 1.3 to 1.6.
- `scripts/move-to-neon.mjs`: copies tables, accounts (into Clerk) and files
  from Supabase to Neon.
- `docs/`: ARCHITECTURE, DEVELOPMENT, SECURITY_AND_DEPLOYMENT, ACCESSIBILITY,
  and NEON_CLERK_MIGRATION (the cutover steps).
- `release-notes/<version>.md` are the player-facing notes. `CHANGELOG.md` is
  the full log.

## Commands

```sh
npm ci
npm run typecheck                 # every workspace
npm test                          # unit tests: app, rules engine, api function
npm run functions:check           # deno check of the Supabase Edge Functions
npm run functions:test
PGHOST=localhost PGUSER=postgres ./scripts/test-db-local.sh   # Supabase schema + pgTAP
PGHOST=localhost PGUSER=postgres ./scripts/test-db-neon.sh    # Neon schema (NEON_API_TESTS=1 adds API integration tests)
./scripts/test-move-to-neon.sh    # data move end to end, with fakes
npm run secrets:scan              # gitleaks (allowlist in .gitleaks.toml)
```

In `apps/mobile`:

```sh
npm run bundle:check                                 # Android export must build
npm run preview:web && npm run preview:walkthrough   # web preview, every screen, axe (WCAG 2.2 AA), all themes
```

Run unit tests with `node --test --experimental-strip-types` (no Jest).

## Conventions

- **Theme.** `colors` and `font` from `src/ui/theme.ts` change in place when the
  theme changes (Light, Dark, Midnight, or System). The app opens in Dark.
  - Module styles use `themedStyles(() => ({...}))`.
  - Components call `useTheme()` so they re-render on a theme change.
  - Any file that reads the theme starts with `'use no memo'`. Without it,
    React Compiler (on in `app.config.ts`) keeps the old colours.
  - Camera and video overlays use the fixed `onVideo` palette.
  - The palettes (`src/ui/palettes.ts`) are red, black and white: neutral
    greys on black (Dark), true black (Midnight) and white (Light), with one
    red accent; no orange, no gradients. `accent` is red for text and icons;
    `accentFill` is the brand red behind filled controls (white labels).
    `palettes.test.ts` checks every contrast and that both stay red.
  - Players see the themes as Black (`dark`), Midnight, White (`light`, snow
    white) and Match my phone (`system`).
- **Type.** Barlow for text, Barlow Condensed for scores, numbers and
  headings (`src/ui/fonts.ts`). Use the app's `Text` and set `fontWeight`;
  ask for the condensed face with `fontFamily: CONDENSED`
  (`src/ui/typography.ts`). Navigation headers use `headerFont(size)`.
- **Accessibility.**
  - Every text colour must pass WCAG AA in every theme.
  - Interactive elements need labels and roles; radios need `aria-checked`.
  - The walkthrough fails on any axe violation.
- **Auth.** Clerk's native components (`@clerk/expo/native`, backed by
  `@clerk/expo-native-components` and themed by `clerk-theme.json`).
  - `AuthView` is the sign-in and sign-up screen; `UserProfileView` is
    Settings → Account and security. Don't rebuild these flows by hand.
  - React to auth state with `useAuth()` / `useUser()`; never `setActive()`.
  - The age check and consent come after sign-in (`ConsentGate`).
  - The database reads the user from Clerk's JWT: SQL uses `app.uid()` /
    `app.claims()`, never `auth.user_id()` or `auth.session()` first (loading
    `pg_session_jwt` inside a SECURITY DEFINER function drops the request's
    claims). Clerk tokens carry `"role": "authenticated"`. RLS is on for
    every table.
  - "Check sign-in" (Actions) proves sign-in against the live backend; the
    Release workflow won't publish without it.
- **Tutorial.** `features/onboarding/Tutorial.tsx` shows once per device
  after `ConsentGate`; Settings → Tutorial (`/tutorial`) shows it again.
  Keep its steps in line with the tabs and screens they describe.
- **Forced updates.** `public.app_requirements()` on Neon returns
  `min_version` and `download_url`.
  - The app reads it from the `api` function's `GET /app-requirements`.
    That works signed out; the Data API needs a token on every request.
  - When the app is older, it shows only the "Update MatIQ" screen.
  - To raise the minimum, update `app.release_policy` (SQL in
    `docs/NEON_CLERK_MIGRATION.md`).
- **Migrations.** Never edit a migration that has shipped; add a new one with
  a later timestamp, and add database tests with it.
- **UI rules.** Touch targets at least 44 pt; no text below 12 pt; skeletons
  (`Loading`) instead of spinners; buttons ignore a second tap while busy
  (`useSinglePress`: pass the action's promise); custom pressables use
  `withPressFeedback`; lists cache with `persisted()`; empty lists offer a
  next step; no emojis.
- **Preview.** The web preview uses `src/preview/fake-backend.ts` and stubs.
  When you add a backend call or a Clerk flow, cover it there and in
  `scripts/preview-walkthrough.cjs`.

## Security

- Never commit secrets or put a secret key in the app. Only `EXPO_PUBLIC_*`
  values reach the app, and a Clerk `sk_` key there fails the release build.
- Test fixtures that look like keys are built at runtime or allowlisted exactly
  in `.gitleaks.toml`. GitHub push protection blocks real-looking ones.
- Secrets live in GitHub Actions secrets and the Neon and Supabase project
  settings, never in files.

## Deploying and releasing

- **Supabase:** "Deploy backend" runs on every push to `main`.
- **Neon:** "Deploy Neon backend" is run by hand. Production is deployed only
  from `main`.
- **Data move:** "Move data to Neon". A rehearsal uses the `rehearsal` branch.
  Production needs `main`, dry run off, and the confirmation text. The real
  move first turns Supabase read-only.
- **Release:** push a tag `v<version>[-channel]`, or run the Release workflow
  with a tag. The tag must match `apps/mobile/package.json`. Channels such as
  `-alpha` or `-pre-beta` publish as pre-releases with the APK and notes from
  `release-notes/<version>.md`.
- Bump the version in these places together:
  - the root `package.json`;
  - `apps/mobile/package.json`;
  - `APP_VERSION` and `RELEASE_LABEL` in `apps/mobile/app.config.ts`.

  Then add the CHANGELOG and release-notes entries.
