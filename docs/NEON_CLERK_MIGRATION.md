# Moving MatIQ from Supabase to Neon + Clerk

Status: **in progress** (ships with Pre-Beta 1.7.0). Supabase stays live
until the cutover at the end; nothing here changes the running backend
before then.

| Today (Supabase) | After (Neon project in AWS Frankfurt, `aws-eu-central-1`) |
| --- | --- |
| Supabase Auth (email + password, Google, TOTP, Turnstile) | **Clerk** (email + password, Google, authenticator app, Clerk bot protection) |
| PostgREST + RLS (`supabase-js` in the app) | **Neon Data API** (PostgREST-compatible), Clerk tokens checked against Clerk's JWKS, same RLS |
| Storage buckets `match-videos`, `match-frames`, `avatars` + storage policies | **Neon Object Storage** (private buckets), presigned links minted by the `files` function with the same rules |
| 5 Deno Edge Functions | **Neon Functions** (Node.js 24, Hono): `account`, `analyze`, `apikeys`, `moderation`, `ranked`, `files` |
| Realtime (live score, ranked updates) | Polling while a screen needs fresh data (Neon Realtime is still in beta) |
| `supabase/migrations` + pgTAP | `neon/migrations` + the same pgTAP tests on a local Postgres with a `pg_session_jwt` stand-in |

Frankfurt because Object Storage and Functions are not offered in
`aws-eu-west-2` (London).

## Where things are

| | |
| --- | --- |
| Neon project | `MatIQ Frankfurt` (`young-poetry-71915783`), AWS `eu-central-1`, Postgres 17, branch `production` (`br-empty-forest-b9dmqj7f`), database `neondb` |
| Data API | `https://ep-soft-mode-b9v0ldxc.apirest.c-7.eu-central-1.aws.neon.tech/neondb/rest/v1`, schema `public`, anonymous role `anonymous`, max 1000 rows, tokens checked against Clerk's JWKS |
| Clerk | application `app_3LPF8Bs7c4zq8KT6NE4JWS7grpM` (development instance `funny-locust-4840.clerk.accounts.dev`; JWKS `https://funny-locust-4840.clerk.accounts.dev/.well-known/jwks.json`) |
| Old London project | `MatIQ` (`falling-morning-42423177`, `aws-eu-west-2`): not used (no Object Storage or Functions there) |

Schema on Neon: `DATABASE_URL=… node scripts/neon-db.mjs` applies
`neon/compat.sql`, the rewritten Supabase migrations and `neon/migrations`
(recorded in `app.schema_migrations`, so it only adds new ones).
`node scripts/test-db-neon-remote.mjs` runs every database test against a
Neon database inside transactions that always roll back.

Things to confirm against the live Data API with a real Clerk token (stage
5 rehearsal): that it sets `request.method` (the age check on API writes
relies on it; without it the RLS policies on user tables still apply) and
`request.headers` (network bans on API requests). `pg_session_jwt` isn't
preloaded on Neon: anything that sets `request.jwt.claims` itself (the
tests, the functions' "as the user" checks) must call `auth.session()`
first, or the claims are dropped when the extension loads.

## Identity: Clerk users keep their MatIQ ID

Every table keys users by the UUID Supabase gave them, and Neon's
`auth.uid()` (from `pg_session_jwt`) only returns a UUID when the token's
`sub` is one. Clerk's `sub` is `user_…` and can't be overridden, so:

- `app.users (id uuid primary key, clerk_id text unique, email, created_at,
  banned_until, meta jsonb)` replaces `auth.users`.
- `app.uid()` returns the MatIQ UUID for the request's Clerk user
  (`auth.user_id()` → `app.users.clerk_id`), and **null for banned users**,
  so every RLS policy and `SECURITY DEFINER` function that used
  `auth.uid()` keeps working and a ban cuts off all data access at once.
- Imported users: Clerk `externalId` = their Supabase UUID; the import
  stores the Clerk ID in `app.users.clerk_id`.
- New users: on first sign-in the app calls `public.register_user(...)`
  (username, display name, birth month for the age check), which creates
  the `app.users` row; the old `handle_new_user` trigger then creates the
  profile and entitlements exactly as before.
- `app.jwt()` replaces `auth.jwt()`. The owner panel's "two-factor
  required" rule reads Clerk's factor-verification claim instead of `aal`.

## Accounts move with their passwords

The import (Clerk Backend API `createUser`) sends, per Supabase user:
email (verified state kept), `externalId` = Supabase UUID,
`passwordDigest` + `passwordHasher: "bcrypt"` (Supabase stores bcrypt, so
nobody resets a password), `totpSecret` for authenticator-app users when
Supabase's factor secret is readable (otherwise they set it up again), and
`skipPasswordChecks`. Google users sign in with Google and are matched by
their verified email.

## Data access in the app

- `apps/mobile/src/lib/backend.ts` is the one client. Database reads and
  RPCs go to the Data API with `@supabase/postgrest-js` (the client
  `supabase-js` already used), so `.from()` / `.rpc()` calls stay as they
  are; the bearer token is Clerk's session token.
- Sign-in, sign-up (with an email code), Google and two-factor are Clerk's
  (`@clerk/expo`). With two-factor on, Clerk asks for the code before it
  starts a session, so there is no half-signed-in state to guard. After
  sign-in the app calls `register_user`, which returns the MatIQ ID (the
  imported one, or a new account with the username and display name from
  sign-up).
- Realtime is gone: the match being analysed, live-recording batches and
  ranked challenges are polled (5 s, 5 s and 60 s).
- Grants: `authenticated` keeps what it had; `anonymous` (Data API's name
  for `anon`) gets nothing. Tokens never carry a `role` claim.
- Storage calls become `files` function calls returning presigned upload /
  download links after the same checks the storage policies made
  (own folder, fixed file names, size and type, banned users refused).
- `supabase.functions.invoke(...)` becomes a call to the matching Neon
  Function URL with the Clerk token.

## Server functions

One Neon Function, `api` (`neon/functions/api`, Node 24 + Hono), with a
route per old Edge Function (`account`, `analyze-match`, `api-keys`,
`moderation`, `ranked`) keeping their request and response shapes, plus
`files/*` for storage and `jobs/clerk-sync` for a schedule.

- Callers send the Clerk session token; the function checks it against
  Clerk's JWKS (`jose`; issuer `CLERK_ISSUER`, browser tokens' `azp`
  against `CLERK_AUTHORIZED_PARTIES`) and maps it to the MatIQ UUID with
  `svc_user_for_clerk`. Then the same pipeline as before: bans (account
  and network), rate limits, the age check. The address it sees is
  recorded (`svc_record_address`) for network bans.
- Postgres through the injected `DATABASE_URL` (`pg` pool). `shared/db.ts`
  answers `rpc()` / `from()` the way PostgREST did, so the ported handlers
  kept their code; `asUser()` runs work as the signed-in user (role
  `authenticated` and their claims, `auth.session()` loaded first), so Row
  Level Security decides.
- Files: bytes in the Neon buckets, a row per file in `storage.objects`.
  The `files` routes change the row as the user first, in one transaction
  with the bytes, so the storage policies from the Supabase days still
  decide (own folder, fixed names, age check, bans). Frames and pictures
  pass through the function; videos get a PUT link signed for their exact
  size and type. The service side (`shared/storage.ts`) keeps rows and
  bytes in step when it moves, quarantines or deletes files.
- Bans and deletions reach Clerk through the `private.clerk_sync` queue:
  applied right after an account is deleted and by `jobs/clerk-sync` on a
  schedule (a Function Trigger; Neon's proxy strips `x-neon-*` headers from
  outside, so only Neon can call it). Without `CLERK_SECRET_KEY` they wait.
- Function environment: `CLERK_ISSUER`, `CLERK_SECRET_KEY` (optional),
  `CLERK_AUTHORIZED_PARTIES` (optional), `MATIQ_KEK_CURRENT` /
  `MATIQ_KEK_V*`, the AI settings (`ANTHROPIC_API_KEY` or `AI_*`,
  `ANALYSIS_*`), `ALLOWED_ORIGINS`. Neon injects `DATABASE_URL` and the
  `AWS_*` storage variables.
- Tests: the ported unit tests (`npm test --workspace @matiq/api`) and
  integration tests against the Neon schema in Postgres
  (`NEON_API_TESTS=1 ./scripts/test-db-neon.sh`, in CI): the adapter, the
  token check, the storage rules through `files`, bans and the Clerk queue.

Until the cutover the Supabase Edge Functions keep serving the released
app, so a change to shared server logic is made in both
`supabase/functions` and `neon/functions/api`; the Supabase copy is
deleted at the cutover.

## Moving the data (workflow "Move data to Neon", run by hand)

`scripts/move-to-neon.mjs` reads Supabase through the Management API
(`SUPABASE_ACCESS_TOKEN`; SQL and the service key) and changes nothing
there. Into the Neon branch it copies:

1. **Tables**, in one transaction: user triggers off, rows already there
   deleted, Supabase's rows inserted in foreign-key order, identity
   sequences moved past the copied IDs, triggers back on, and each table's
   row count compared with Supabase's (any difference rolls everything
   back). Supabase Auth's users, sessions and sign-in log become
   `app.users`, `app.sessions` and `app.audit_log_entries`. Not copied: the
   AI keys people saved (decided: they add them again; Supabase's
   key-encryption key can't be read back), rate-limit counters, two-factor
   factors (Clerk's now) and Neon's Clerk queue.
2. **Accounts into Clerk**: found by external ID (the MatIQ UUID) or created
   with the bcrypt password hash and `password_hasher: bcrypt`, so
   passwords keep working; Google-only accounts without a password (Clerk
   links their Google sign-in by the verified email); authenticator
   secrets when Supabase has them readable (the run reports how many must
   set two-factor up again). Banned accounts are banned in Clerk. Someone
   who already signed up in Clerk with the same email keeps that Clerk
   user. Accounts that never confirmed their email aren't imported.
3. **Files**: each `storage.objects` row's bytes from Supabase Storage into
   the Neon bucket, skipped when already there with the same size; a row
   without a file is reported.

`--dry-run` checks everything and writes nothing. Running it again is
safe. `scripts/test-move-to-neon.sh` (in CI) runs it end to end on local
databases with fakes for Clerk, Supabase Storage and S3: a dry run, the
move, a second run, and an existing Clerk sign-up.

The workflow resets a Neon branch `rehearsal` from production, deploys it
(Deploy Neon backend, called with the branch) and moves the data into it.
Start it by adding the label `neon-rehearsal` to the pull request, or by
hand. The production branch is only filled from `main`, after deploying it,
with the dry run off and the confirmation typed.

## Cutover (release 1.7.0 Alpha)

1. GitHub secrets and variables in place ("What the deploy needs").
2. Rehearsal (recommended): label the pull request `neon-rehearsal`; build
   a test app against the rehearsal branch and try it with real accounts.
3. Merge the pull request. "Deploy backend" (Supabase) runs by itself and
   adds the read-only switch (off) and the 8-minute videos to Supabase.
4. "Deploy Neon backend" for production; its notice gives the address for
   `EXPO_PUBLIC_FUNCTIONS_URL` (the Data API address is in "Where things
   are").
5. "Move data to Neon" for production: a dry run, then the real run, which
   first turns Supabase read-only (from then on 1.6 and older can only
   read), then copies tables, accounts and files.
6. Tag `v1.7.0-alpha`: the release builds the APK against Neon.

Updating: 1.7 and later read a minimum version at start
(`app.release_policy`, now 1.7.0) and show "Update MatIQ" with the download
link when they are older. To make everyone update later:
`update app.release_policy set min_version = '1.8.0', updated_at = now();`.
Versions 1.6 and older have no such check and show fixed messages, so
they can't be told to update in the app; read-only Supabase keeps their
data safe, and the release notes tell people to install the new one.
Supabase stays (read-only) as a fallback until it is switched off.

## What the deploy needs

`neon.ts` (repository root) declares the Neon side: the Data API checking
Clerk's JWKS, the four private buckets, the `api` function with its
settings, and a five-minute schedule for `jobs/clerk-sync`. The **Deploy
Neon backend** workflow (`.github/workflows/neon.yml`, run by hand from
`main`) applies the database schema (`scripts/neon-db.mjs`, only new
migrations), shows `neon config plan`, runs `neon deploy`, and checks that
the function answers, printing its address for `EXPO_PUBLIC_FUNCTIONS_URL`.
Its bundle was checked locally with the CLI's own esbuild settings.

GitHub secrets: `NEON_API_KEY`, `MATIQ_KEK_V1` (a new key-encryption key
for the AI keys people store on Neon: `openssl rand -base64 32`),
`CLERK_SECRET_KEY` (bans and deletions in Clerk; the data move), the
existing `SUPABASE_ACCESS_TOKEN` (the data move reads Supabase with it),
optional AI keys as for Supabase (`ANTHROPIC_API_KEY` or `AI_API_KEY`).
GitHub variables: `NEON_PROJECT_ID`, `CLERK_ISSUER` (Clerk Frontend API
URL), optional `NEON_BRANCH`, `AI_PROVIDER` / `AI_MODEL` / `AI_BASE_URL`,
`ALLOWED_ORIGINS`, `CLERK_AUTHORIZED_PARTIES`; for the app build
`EXPO_PUBLIC_DATA_API_URL`, `EXPO_PUBLIC_FUNCTIONS_URL`,
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (the release build checks all three and
refuses a Clerk secret key).

Clerk Dashboard (already set on the development instance): email +
password (12+ characters with upper, lower, number and symbol, breached
passwords refused), email code verification, Google, authenticator app
and backup codes, new-device email check. On the production instance,
also add `matiq://auth/callback` under Native applications → allowlist
for mobile SSO redirect (Google sign-in returns there).

## Stages

1. **Done.** Database for Neon: `app.users`, `app.uid()`, the Supabase
   migrations rewritten for Neon plus `neon/migrations`; all 292 database
   tests pass locally (with a `pg_session_jwt` stand-in) and on the
   Frankfurt database.
2. **Done.** Clerk sign-in in the app (sign-up with the age check and an
   email code, Google, two-factor with backup codes, new-device check),
   the app's data client pointed at the Data API, polling instead of
   Realtime, and the browser preview on a Clerk stand-in.
3. **Done.** The `api` Neon Function (the five functions on Node, `files`,
   the Clerk sync job), tested against the Neon schema; the app's
   storage and function calls point at it (videos send their size and
   type for the signed link).
4. **Done.** `neon.ts`, the deploy workflow and the data move (with its
   rehearsal), tested end to end locally.
5. Rehearsal, cutover, release.
