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

- Database reads and RPCs go to the Data API with `@supabase/postgrest-js`
  (the client `supabase-js` already used), so `.from()` / `.rpc()` calls
  stay as they are; the bearer token is Clerk's session token.
- Grants: `authenticated` keeps what it had; `anonymous` (Data API's name
  for `anon`) gets nothing. Tokens never carry a `role` claim.
- Storage calls become `files` function calls returning presigned upload /
  download links after the same checks the storage policies made
  (own folder, fixed file names, size and type, banned users refused).
- `supabase.functions.invoke(...)` becomes a call to the matching Neon
  Function URL with the Clerk token.

## Server functions

Node.js 24 + Hono, one per old Edge Function, sharing the ported
`_shared` code (AI providers, moderation, video and JPEG checks, rate
limits, crypto). They verify the Clerk token with `@clerk/backend`, map it
to the MatIQ UUID, and talk to Postgres through the injected
`DATABASE_URL` (the `svc_*` functions are called with SQL instead of
through PostgREST). Secrets (`CLERK_SECRET_KEY`, `MATIQ_KEK_V1`, AI keys)
are Function environment variables set by the deploy workflow.

Network bans: functions record the caller's address (as Supabase's
sign-in log did), and bans also call Clerk's `banUser`, so a banned
account can't sign in at all.

## Moving the data (workflow `migrate-to-neon.yml`, run by hand)

1. Dump `public` + `private` data from Supabase (schema comes from
   `neon/migrations`), restore into Neon.
2. Export `auth.users` (+ TOTP factors), import into Clerk, fill
   `app.users`.
3. Copy every object from the three Supabase buckets into the Neon buckets.
4. Compare row and object counts; the run fails on any difference.

## Cutover

1. Run the migration once as a rehearsal on a Neon branch; test the 1.7.0
   APK against it.
2. Turn on read-only mode on Supabase (a flag the request hook checks:
   old app versions show "Update MatIQ to keep going").
3. Final migration run into the main branch, release 1.7.0.
4. Supabase stays (read-only) as a fallback until it is switched off.

## What the deploy needs

GitHub secrets: `NEON_API_KEY`, `CLERK_SECRET_KEY` (and, for the data move,
the existing `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF`).
GitHub variables: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEON_PROJECT_ID`.
Clerk Dashboard: email + password, Google, authenticator app enabled.

## Stages

1. Database for Neon: `app.users`, `app.uid()`, the baseline schema in
   `neon/migrations`, pgTAP on a local Postgres with a `pg_session_jwt`
   stand-in.
2. Clerk sign-in in the app (sign-up with the age check, Google, two-factor).
3. Functions on Node + `files`; app storage and function calls switched.
4. `neon.ts`, deploy workflow, data-move workflow.
5. Rehearsal, cutover, release.
