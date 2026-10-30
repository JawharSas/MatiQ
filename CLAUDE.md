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
  theme changes (Light, Dark, Midnight, or System).
  - Module styles use `themedStyles(() => ({...}))`.
  - Components call `useTheme()` so they re-render on a theme change.
  - Any file that reads the theme starts with `'use no memo'`. Without it,
    React Compiler (on in `app.config.ts`) keeps the old colours.
  - Camera and video overlays use the fixed `onVideo` palette.
- **Accessibility.**
  - Every text colour must pass WCAG AA in every theme.
  - Interactive elements need labels and roles; radios need `aria-checked`.
  - The walkthrough fails on any axe violation.
- **Auth.** Use `@clerk/expo` (Core 3, Future API).
  - Sensitive changes (password, Google, two-factor) go through
    `useVerifiedAction` (`src/features/auth/reverify.tsx`).
  - The database reads the user from Clerk's JWT through `pg_session_jwt`. RLS
    is on for every table.
- **Forced updates.** `public.app_requirements()` on Neon returns
  `min_version` and `download_url`.
  - The app reads it from the `api` function's `GET /app-requirements`.
    That works signed out; the Data API needs a token on every request.
  - When the app is older, it shows only the "Update MatIQ" screen.
  - To raise the minimum, update `app.release_policy` (SQL in
    `docs/NEON_CLERK_MIGRATION.md`).
- **Migrations.** Never edit a migration that has shipped; add a new one with
  a later timestamp, and add database tests with it.
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
