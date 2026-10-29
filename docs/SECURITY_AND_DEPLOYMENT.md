# Security & deployment guide

This guide covers how MatIQ protects data, how to configure secrets, how to
harden and deploy the Supabase backend and the mobile app, and how to publish
the repository safely.

## 1. Threat model and controls

| Threat | Control | Where |
|---|---|---|
| API keys extracted from the app bundle | Only the Supabase URL + publishable anon key ship in the app; the app and the release build refuse a secret or `service_role` key. AI keys, the service-role key and KEKs exist only as Edge Function secrets. CI scans the full git history with gitleaks and the built bundle with `scripts/scan-bundle.mjs`. | `config/env.ts`, `config/public-key.ts`, `release.yml`, `ci.yml` |
| User BYOK keys leaked | Sent once over TLS, verified, encrypted with AES-256-GCM (KEK in function secrets, AAD bound to user + provider), never returned, logged (redacting logger) or stored on the device. Screen capture blocked; device auth required to open the screen. | `supabase/functions/api-keys`, `_shared/crypto.ts`, `settings/api-keys.tsx` |
| Reading other users' data | RLS on every table (a test fails if a table is added without it); `anon` has no table access or privileged functions; no views; helpers are `SECURITY DEFINER` with empty `search_path`; feed is `SECURITY INVOKER`. 187 automated database tests. | `supabase/migrations/*`, `supabase/tests/database` |
| Privilege escalation (unlimited / owner) | Entitlements live in a separate table with no client write grants or policies; signup metadata cannot set roles; admin RPCs re-check the role (and MFA) every call and are audited. | `20261023000300_access_control.sql`, `20261023000600_owner_panel.sql` |
| Forged scores / analyses | Only the service role writes `match_analyses`, `status`, `frame_count`, `has_video`; column-level grants block client writes; duration frozen after analysis starts. | migrations 300 / 400 |
| Quota bypass / cost abuse | Atomic reservation with row lock, per-user rate limits on every function, frame caps, video-length entitlement, auth rate limits. | `_shared/quota.ts`, `_shared/middleware.ts`, `config.toml` |
| Stolen or phished password | Optional TOTP two-factor authentication. Once enrolled, `aal1` sessions are refused by restrictive RLS policies (tables, Realtime, Storage), a PostgREST pre-request hook (RPCs) and the Edge Function middleware. | `20261024000300_mfa_enforcement.sql`, `_shared/mfa.ts`, `settings/two-factor.tsx` |
| Disguised or malicious uploads | Videos: the app reads the whole file before uploading (MP4/QuickTime structure, every chunk inside the media data, nothing hidden, every H.264/HEVC frame's NAL units); clients can only write `upload.*`; analyze-match moves the upload out of the client's reach, checks it again and only then publishes `video.*`, the only name viewers can read. Frames: JPEG start and end markers checked on the phone and the server. Buckets limit MIME types and sizes. | `rules-engine/src/media/video-check.ts`, `analyze-match/video.ts`, `20261029000300_video_upload_check.sql` |
| Password guessing, credential stuffing, bots | Supabase Auth rate limits per IP (set by Deploy backend), a device lockout after 5 wrong passwords (30 s, doubling to 15 min), optional Cloudflare Turnstile on email sign-in and sign-up, one error message for unknown email and wrong password. | `backend.yml`, `features/auth/sign-in-throttle.ts`, `features/auth/Captcha.tsx` |
| Vulnerable dependencies | Dependabot updates; CI audits the app's and the Edge Functions' runtime dependencies (high and critical fail unless allow-listed with a reason and review date); pull requests can't add dependencies with known high-severity advisories. | `scripts/audit-deps.mjs`, `.github/dependency-audit-allowlist.json`, `ci.yml` |
| API responses misused by a browser (framing, sniffing, caching) | Every function response is `no-store` JSON with `nosniff`, a `default-src 'none'` CSP, `frame-ancestors 'none'` / `X-Frame-Options: DENY`, HSTS, `no-referrer`, a closed Permissions-Policy and COOP; CORS only for allow-listed origins. | `_shared/http.ts` |
| Location leaks from photos | Profile pictures are re-encoded on the device (pixels only, no EXIF) before upload; private bucket, one-hour signed URLs. | `features/social/avatar.ts` |
| Live-analysis abuse (re-analysing frames, injecting paths) | Batches are claimed atomically: no overlapping frames, per-match frame budget, unique batch index, frames resolved against the user's own storage folder. One quota unit per match. | `20261024000200_live_analysis.sql`, `analyze-match/pipeline.ts` |
| Rating manipulation (fake results, alt-account farming, races) | Ratings, history and titles are written only by the `ranked` function via `svc_apply_ranked_result` (no client write grants). Results come from an analysed recording linked before upload; the opponent can watch it and dispute; a recorder's own win needs the opponent's confirmation; max 3 ranked matches per pair per week; versioned rows reject concurrent overwrites; settlement applies once. | `20261028000100_ranked.sql`, `supabase/functions/ranked` |
| Ranked data leaking private accounts | Ratings and titles follow the profile privacy rule; ranked matches and rating history are participant/own-only; ladder and matchmaking are `SECURITY INVOKER`, so RLS decides who appears. The owner can view a recording only while a dispute about it is open. | `20261028000100_ranked.sql` |
| Session theft from device | Tokens in AES-256 MMKV; key in Keychain/Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); `allowBackup=false`; short JWT expiry with rotating refresh tokens; sign out of all devices. | `lib/storage.ts`, `lib/secure-store.ts`, `app.config.ts` |
| Man-in-the-middle | HTTPS only (ATS / `usesCleartextTraffic=false`), SPKI pinning with backup pins and optional expiry, PKCE for email links. | `lib/ssl-pinning.ts`, `auth/callback.tsx` |
| Malicious input (XSS-style spoofing, oversized payloads, prompt injection) | Zod validation client and server, DB CHECK constraints (length, control chars, bidi overrides), body-size limits, plain-text rendering only, athlete hints stripped of markup and fenced as data in prompts, model output re-validated by the rules engine. | `lib/validation.ts`, `_shared/http.ts`, `_shared/ai/prompts.ts` |
| Scraping | Auth required for all reads, `max_rows = 100`, keyset pagination capped at 50, per-user rate limits, private-by-default accounts, LIKE wildcards escaped in search. | `config.toml`, `20261023000500_social.sql` |
| Reverse engineering | Hermes bytecode, R8 minification + resource shrinking, console calls stripped from release builds. Obfuscation only slows attackers down: every security decision is enforced server side. | `app.config.ts`, `babel/strip-console.js` |

## 2. Secrets: what goes where

| Value | Secret? | Lives in |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | No (public by design) | `apps/mobile/.env` locally, EAS environment variables for builds |
| `EXPO_PUBLIC_TLS_PINS` | No | same as above |
| `EXPO_PUBLIC_TURNSTILE_SITE_KEY` | No (public by design) | GitHub Actions variable (release builds) |
| `TURNSTILE_SECRET_KEY` | **Yes** | GitHub Actions secret; Deploy backend copies it into Supabase Auth's CAPTCHA settings |
| `SUPABASE_ACCESS_TOKEN` (and optionally `SUPABASE_DB_PASSWORD`) | **Yes** | GitHub Actions secret, used only by the Deploy backend workflow |
| `ANTHROPIC_API_KEY` | **Yes** | GitHub Actions secret (the Deploy backend workflow copies it into the function secrets) or `supabase secrets set` |
| `MATIQ_KEK_V{n}`, `MATIQ_KEK_CURRENT` | **Yes** | Function secrets: the Deploy backend workflow creates `MATIQ_KEK_V1` once if it is missing and never prints it; set it yourself first with `supabase secrets set` if you want a recovery copy in a password manager |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | injected automatically into Edge Functions; never anywhere else |
| Signing keystores, App Store Connect keys | **Yes** | EAS credentials service |

Rules:

1. Never put a secret in an `EXPO_PUBLIC_*` variable: everything with that
   prefix is compiled into the JavaScript bundle.
2. Never commit `.env` files. `.gitignore` excludes them; only `.env.example`
   templates are tracked.
3. Run `npm run secrets:scan` (gitleaks) before every push. CI runs it too.

Generate a key-encryption key:

```bash
openssl rand -base64 32
```

## 3. Supabase project setup and hardening

### Local development

```bash
npm install
supabase start                 # local stack (Docker)
supabase db reset              # applies supabase/migrations
supabase test db               # pgTAP security tests (or ./scripts/test-db-local.sh without Docker)
cp supabase/functions/.env.example supabase/functions/.env   # fill in values
npm run functions:serve
```

### Hosted project

From the browser, with the
[Deploy backend workflow](../.github/workflows/backend.yml):

1. Repository variable `EXPO_PUBLIC_SUPABASE_URL` (also used by the app
   build) and the Actions secrets `SUPABASE_ACCESS_TOKEN` (an access token
   from supabase.com/dashboard/account/tokens) and, optionally,
   `ANTHROPIC_API_KEY`.
2. **Actions → Deploy backend → Run workflow**. It applies the migrations,
   sets the Auth, Data API and storage settings below, creates the function
   secrets and deploys every Edge Function. It runs again by itself whenever
   a change under `supabase/` or `packages/rules-engine/src/` reaches `main`.

Or with the CLI:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push                       # apply migrations
supabase secrets set --env-file supabase/functions/.env
npm run functions:deploy               # vendors the rules engine, then deploys
```

The workflow mirrors `supabase/config.toml` in the hosted project; with the
CLI, set the same in the dashboard:

- **Authentication**
  - Email confirmations on; secure password change on; minimum password
    length 12 with letters, digits and symbols; enable leaked-password
    protection (available on paid plans).
  - JWT expiry 900 s; refresh token rotation on with a 10 s reuse interval.
  - Redirect URL allow-list: `matiq:///auth/callback` (what
    `Linking.createURL` builds in a release build) and
    `matiq://auth/callback`, plus your dev URL. The workflow sets the Site URL
    to the repository page, so any other redirect lands on the download page.
  - MFA: enable TOTP (enroll + verify).
  - Disable providers and anonymous sign-ins you do not use.
  - Keep the auth rate limits at least as strict as `config.toml`.
  - **Email delivery**: the built-in mailer only sends to members of the
    Supabase team and a few emails an hour, so other people never receive
    their confirmation email. Set up custom SMTP under Authentication →
    Emails → SMTP Settings (for example Resend, which needs a domain you own)
    before inviting anyone. The workflow leaves email confirmation and SMTP
    as set in the dashboard.
- **Data API**: exposed schemas = `public` only; max rows = 100.
- **Database**: enforce SSL for direct connections, restrict network access
  to known IPs, enable Point-in-Time Recovery for production.
- **Storage**: raise the global upload limit to at least 500 MB if you allow
  long videos (bucket limits are set by the migration). The Free plan caps
  uploads at 50 MB; the workflow warns when it cannot raise the limit.
- **Realtime**: the migrations add `public.matches`,
  `public.match_live_batches` and `public.ranked_matches` to
  `supabase_realtime`; Realtime applies RLS, so users only receive their own
  (or shared / participant) rows.
- **Two-factor pre-request hook**: migration `20261024000300` sets
  `pgrst.db_pre_request = 'public.check_request_mfa'` on the `authenticator`
  role. Confirm it took effect with
  `select rolconfig from pg_roles where rolname = 'authenticator';`. If you
  already use a pre-request function, call `public.check_request_mfa()` from
  it instead (PostgREST supports only one).
- Run the **Security Advisor** and **Performance Advisor** after every
  migration and resolve every finding.

Data is encrypted at rest by Supabase (AES-256 for the database volumes,
storage objects and backups) and in transit with TLS. BYOK API keys are
additionally encrypted at the application layer, so even a database dump does
not reveal them.

### Google sign-in

The app opens Supabase's Google OAuth flow (PKCE) in the system browser and
returns to `matiq:///auth/callback`, which the allow-list above already
covers. The Google client secret lives only in Supabase.

1. In the [Google Cloud console](https://console.cloud.google.com), create a
   project, then **Google Auth Platform**:
   - **Branding**: app name MatIQ, support email, developer contact email.
   - **Audience**: External, then **Publish app** so any Google account can
     sign in (MatIQ only asks for the basic `openid`, `email` and `profile`
     scopes, which need no Google review).
   - **Clients → Create client**: type **Web application**, authorized
     redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
     Copy the client ID and client secret.
2. In Supabase: **Authentication → Sign In / Providers → Google**, turn it
   on, paste the client ID and secret, save.

No Android or iOS client (and no signing-key SHA-1) is needed for this flow.
New Google accounts get their Google name as the display name and a
generated username they can change under Edit profile; the policy screen
asks them to accept the Terms and Privacy Policy and confirm their age.
Signing in with Google on an email that already has a confirmed MatIQ
account links to that account.

### Copyright (DMCA) designated agent

U.S. safe harbour (17 U.S.C. § 512(c)) needs a designated agent registered
with the U.S. Copyright Office and the agent's contact details shown in the
service. The app shows them in **Settings → Copyright and DMCA** and on the
Report screen.

1. Register at [dmca.copyright.gov](https://dmca.copyright.gov): create an
   account, then **Designate agent**. You enter the service provider's full
   legal name and address, any alternative names (MatIQ), and the agent's
   name, postal address, phone and email. The fee is $6; the designation
   expires after 3 years unless renewed, and must be amended when details
   change.
2. Add the same details as repository **variables** (Settings → Secrets and
   variables → Actions → Variables): `EXPO_PUBLIC_DMCA_AGENT_NAME`,
   `EXPO_PUBLIC_DMCA_AGENT_ADDRESS`, `EXPO_PUBLIC_DMCA_AGENT_EMAIL`,
   `EXPO_PUBLIC_DMCA_AGENT_PHONE`, plus `EXPO_PUBLIC_SUPPORT_EMAIL` and
   `EXPO_PUBLIC_LEGAL_ENTITY`, then build a release. The release build warns
   about each one that is missing. Until they are set, the agent name falls
   back to `EXPO_PUBLIC_LEGAL_ENTITY` and the email to
   `EXPO_PUBLIC_SUPPORT_EMAIL`; with no email at all, support links open the
   public issue tracker, and the Report screen and Copyright Policy say the
   agent's details aren't published yet (copyright notices are never sent to
   the public page). The app never shows a made-up address.

Handling a notice: check it has the six elements listed in the Copyright
Policy, remove the post in **Owner panel → Content** (by the post ID in the
email; the removal is audited against the author), email the author a copy
of the notice, and keep the notice. On a valid counter-notice, forward it to
the sender and restore the material 10 to 14 business days later unless they
file suit (re-post it from the author's match, or ask the author to). Suspend
repeat infringers in **Owner panel → Users**.

### Children's privacy (COPPA)

- Everyone answers a neutral age screen (birth month and year, nothing
  pre-selected, no hint of the cut-off) before using the app: on the email
  sign-up form, and after the first Google sign-in.
- Under 13 on the sign-up form: nothing is sent to the server. Under 13
  after a Google sign-in: the `account` Edge Function deletes the account and
  its storage at once and keeps nothing (`svc_record_age` stores no row).
  Either way the device blocks another attempt for 24 hours.
- For everyone else the month is stored in `private.age_checks` (not exposed
  to the Data API, never shown to other users, included in the data export,
  deleted with the account).
- The server enforces the order, not just the app: until a user has an
  `age_checks` row their session can read but not create or change anything.
  Restrictive RLS policies cover inserts and updates (tables and storage),
  the PostgREST pre-request hook `public.check_request()` refuses every
  non-GET request (so RPCs too), and the Edge Function middleware calls
  `svc_age_checked` (all functions except `account`, which records the
  answer and handles export and deletion). Clients built before 1.4.0 can
  therefore no longer save anything until the person updates the app.
- If a parent reports a child under 13, delete the account (Supabase
  dashboard → Authentication → Users, after removing their storage folder in
  the three buckets, or ask the person to use Settings → Delete account).
- MatIQ has no ads, trackers or analytics SDKs, which keeps it outside most
  COPPA "support for internal operations" questions; keep it that way.

### Sign-in protection and bot protection

Deploy backend sets the Supabase Auth rate limits explicitly on every run
(per IP address, per 5 minutes: 30 sign-in or sign-up attempts, 30 code
checks, 150 session refreshes) and the app locks sign-in on the device after
5 wrong passwords. The Free plan has no per-account lockout hook, so the
per-IP limits and the device lockout are the controls.

Bot protection (Cloudflare Turnstile, free) is ready but off until you set
it up, because it needs your own Cloudflare keys:

1. Cloudflare dashboard → **Turnstile → Add widget**. Hostname: your Supabase
   project host (`<project-ref>.supabase.co`; the app's check page claims
   that host). Widget mode: **Managed**.
2. GitHub → Settings → Secrets and variables → Actions:
   - **Variables**: `EXPO_PUBLIC_TURNSTILE_SITE_KEY` = the site key.
   - Do **not** add the secret yet.
3. Run **Release** and get testers onto the new build: only builds with the
   site key can pass the check.
4. Then add the **secret** `TURNSTILE_SECRET_KEY` and run **Deploy
   backend**: it turns on CAPTCHA protection in Supabase Auth. From then on
   email sign-in and sign-up need the check (Google sign-in doesn't);
   builds without the site key can no longer sign in with email.

To turn it off again, delete the secret and switch CAPTCHA protection off in
Supabase → Authentication → Attack Protection.

### Bootstrap the owner account

Sign up in the app first, then run once in the SQL editor (as `postgres`):

```sql
update public.user_entitlements
set role = 'owner', is_unlimited = true
where user_id = (select id from auth.users where email = 'you@example.com');
```

After enrolling a TOTP factor for that account, require MFA for every Owner
Panel call:

```sql
update private.app_config set owner_requires_mfa = true;
```

The app's Owner Panel then needs an `aal2` session. Enrol the factor in the
app under Settings → Two-factor authentication; every later sign-in of that
account then asks for a code before the app opens.

### Recovering a user who lost their authenticator

There are no self-service recovery codes. After verifying the person's
identity out of band (e.g. a reply from the account's email address plus
details only they would know), remove the factor with the Auth admin API from
a trusted machine, never from the app:

```ts
// service-role client, run locally
const { data } = await admin.auth.admin.mfa.listFactors({ userId });
await admin.auth.admin.mfa.deleteFactor({ userId, id: data.factors[0].id });
```

Then ask the user to sign in, set up a new authenticator and review their
sessions (sign out of all devices).

## 4. Edge Functions

| Function | Methods | Purpose | Rate limit (per user) |
|---|---|---|---|
| `analyze-match` | POST | validate, reserve quota, run analysis (one-shot or live batches) in background | 20 starts / hour, 300 requests / hour |
| `ranked` | POST | confirm ranked results, settle Elo / titles with version checks | 60 / hour |
| `api-keys` | GET, POST, DELETE | BYOK vault | 60 / min (writes 10 / hour) |
| `account` | GET, DELETE | data export, account deletion | 30 / hour (export 5 / day) |

All functions run behind `verify_jwt = true` and re-validate the user with the
Auth server (`auth.getUser`), so revoked sessions are rejected. Errors return
`{ error: { code, message, requestId } }` without stack traces; logs are JSON
with credential redaction.

### Rotating the BYOK key-encryption key

1. `openssl rand -base64 32`
2. `supabase secrets set MATIQ_KEK_V2=<new> MATIQ_KEK_CURRENT=2` (keep `MATIQ_KEK_V1`).
3. Run `scripts/rotate-api-key-kek.ts` (instructions in the file header).
4. When it reports 0 remaining rows, `supabase secrets unset MATIQ_KEK_V1`.

## 5. Certificate pinning

Pins are base64 SHA-256 hashes of a certificate's SubjectPublicKeyInfo. Pin
the **intermediate CA** (and a backup from a different CA or the root), not
the leaf certificate, which rotates every few months.

```bash
HOST=<project-ref>.supabase.co
openssl s_client -servername "$HOST" -connect "$HOST:443" -showcerts </dev/null 2>/dev/null \
  | awk '/BEGIN CERT/{n++} {print > ("cert" n ".pem")}'
for cert in cert*.pem; do
  openssl x509 -in "$cert" -noout -subject 2>/dev/null || continue
  openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform der \
    | openssl dgst -sha256 -binary | openssl enc -base64
done
```

Set `EXPO_PUBLIC_TLS_PINS=<intermediate>,<backup>` and optionally
`EXPO_PUBLIC_TLS_PINS_EXPIRE=yyyy-MM-dd` as a fail-open safety net. Because
pins are applied at runtime from JS config, they can be updated with an OTA
update (EAS Update) without a store release. A Supabase custom domain gives
you control over the certificate chain and makes pinning more predictable.

## 6. Mobile builds

VisionCamera, Nitro Image, MMKV and SSL pinning are native modules, so use a
development build (not Expo Go):

```bash
cd apps/mobile
cp .env.example .env            # public values only
npx expo prebuild --clean
npx expo run:ios                # or run:android
```

Release builds with EAS:

```bash
npm install -g eas-cli
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon-key> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_TLS_PINS --value <pin1>,<pin2> --visibility plaintext
eas build --profile production --platform all
```

Build-time hardening (already configured): Hermes bytecode, R8 minify and
resource shrinking, cleartext traffic disabled, `allowBackup=false`, console
calls stripped in production, screenshots blocked on the API-key and Owner
Panel screens, device authentication before opening them.

## 7. Incident response

| Event | Action |
|---|---|
| Suspected account takeover | Owner Panel: suspend the account; user signs out of all devices (`signOut({ scope: 'global' })`), resets password and turns on two-factor authentication. |
| AI provider key leaked | Revoke it at the provider, `supabase secrets set ANTHROPIC_API_KEY=<new>`. |
| KEK exposed | Rotate (section 4) immediately, then ask users to replace their stored keys. |
| Service-role key exposed | Rotate the project's API keys / JWT secret in the dashboard, redeploy functions. |
| Abuse of analysis quota | Lower `monthly_analysis_limit`, review `admin_usage_overview`, suspend offenders. |
| Ranked cheating reported | Owner Panel → Disputes: watch the recording, void the match. For accounts farming ratings, suspend them (suspended users cannot play ranked). |

## 8. Publishing the repository to GitHub

```bash
git init -b main
git add .
git status                      # confirm no .env, keystores or node_modules
npm run secrets:scan            # requires gitleaks locally
git commit -m "Initial MatIQ architecture"
git remote add origin git@github.com:<you>/matiq.git
git push -u origin main
```

Then in the GitHub repository settings:

- Enable **secret scanning** and **push protection**.
- Protect `main`: require pull requests and the CI checks (`node`,
  `database`, `edge-functions`, `secrets`) to pass.
- Keep Dependabot enabled (`.github/dependabot.yml`) and consider pinning
  third-party actions to commit SHAs.

## 9. Pre-release checklist

- [ ] `npm test`, `npm run typecheck`, `npm run functions:check`, database tests all green.
- [ ] Supabase Security Advisor has no findings.
- [ ] Owner account bootstrapped, MFA enrolled, `owner_requires_mfa = true`.
- [ ] `authenticator` role has `pgrst.db_pre_request = public.check_request`; a test account with 2FA gets `mfa_required` from the Data API with an `aal1` token, and a new account gets `age_check_required` on writes until it answers the age check.
- [ ] CI's Dependency audit, Secret scan and bundle scan are green; allow-list entries in `.github/dependency-audit-allowlist.json` are still justified.
- [ ] `ranked` function deployed (`npm run functions:deploy` deploys all functions); one ranked match played end to end between two test accounts, including a dispute resolved in the Owner Panel.
- [ ] Production secrets set; no secrets in EAS `EXPO_PUBLIC_*` variables.
- [ ] TLS pins configured with a backup pin.
- [ ] Privacy Policy and Terms reviewed by counsel; `LEGAL_VERSIONS` bumped when they change.
- [ ] Rule values in `packages/rules-engine` checked against current rulebooks.
- [ ] App Store privacy labels / Play data-safety form match the Privacy Policy (no data sold, no tracking).

## 10. Security checklist

How each item of the common web and mobile security checklist is covered.

| # | Item | How MatIQ does it |
|---|---|---|
| 1 | Hide API keys | Only the Supabase URL and publishable key are in the app. AI keys, the service-role key and key-encryption keys are Edge Function secrets; people's own AI keys are encrypted server side and never returned. CI scans the built bundle (`scripts/scan-bundle.mjs`). |
| 2 | Purge Git secrets | gitleaks scans the full history in CI (`fetch-depth: 0`); no `.env`, keystore or key file has ever been committed; `.gitignore` blocks them. If a secret is ever pushed: rotate it first, then rewrite history. |
| 3 | Use the public DB key | The app and the release build refuse anything but a publishable key or an `anon` JWT (`config/public-key.ts`, release "Check public configuration"). |
| 4 | Enable RLS | On every table in `public` and `private` and on storage objects; pgTAP `07_rls_and_uploads` fails if a table without RLS is added, if `anon` gets any table grant or privileged function, or if a view appears in the API schema. |
| 5 | Encrypt sensitive data | TLS (with certificate pinning) in transit; Supabase encrypts the database and storage at rest (AES-256); BYOK keys AES-256-GCM with a key-encryption key; session tokens in AES-256 MMKV with the key in Keychain / Keystore. |
| 6 | Enforce server-side auth | Every table, RPC, storage object and function checks the JWT on the server; functions re-validate it with Supabase Auth (revoked sessions fail); two-factor and the age check are enforced by the database and the functions, not just the app. |
| 7 | Lock record access | RLS policies scope every row to its owner or to what privacy settings allow; storage paths are `{user}/{match}/…` and checked by policies. |
| 8 | Block field tampering | Column-level grants: clients can't write roles, `is_unlimited`, status, scores, `has_video` or ratings; server-owned fields are written only by `svc_*` functions as the service role. |
| 9 | Secure session cookies | The app uses no cookies: short-lived JWTs (15 min) with rotating refresh tokens, stored encrypted on the device, `allowBackup=false`. The Edge Functions set none. |
| 10 | Hash passwords | Supabase Auth stores bcrypt hashes; minimum 12 characters with upper, lower, digit and symbol; changing the password needs re-authentication. |
| 11 | Rate limit login | Supabase Auth per-IP limits set by Deploy backend; device lockout after 5 wrong passwords; per-user limits on every function and on sensitive RPCs. |
| 12 | Add bot protection | Cloudflare Turnstile on email sign-in and sign-up, verified by Supabase Auth (turn on as described in section 3). |
| 13 | Parameterize queries | supabase-js and PostgREST send parameters separately; SQL functions use typed parameters and no dynamic SQL built from input; search escapes LIKE wildcards. |
| 14 | Validate all input | Zod in the app and in every function (strict objects, size limits), database CHECK constraints, body-size limits, model output re-validated. |
| 15 | Escape user content | React Native renders text, never HTML; no `dangerouslySetInnerHTML` or user content in WebViews (the Turnstile page holds only the site key, JSON-escaped); control and bidi characters are rejected; prompt hints are fenced as data. |
| 16 | Restrict file uploads | Private buckets with MIME and size limits (videos MP4/MOV up to 500 MB, frames JPEG up to 1 MB, avatars JPEG/PNG/WebP up to 2 MB); fixed file names enforced by policies; videos are checked in full (item 21), frames are checked for JPEG markers on the phone and the server, and avatars are re-encoded to a fresh JPEG on the phone. |
| 17 | Trim API responses | Explicit column lists (no `select *`), `max_rows = 100`, functions return only what the screen needs, errors are a code, a message and a request id (no stack traces). |
| 18 | Add security headers | `_shared/http.ts`: CSP `default-src 'none'`, `frame-ancestors 'none'`, `X-Frame-Options`, HSTS, `nosniff`, `no-referrer`, Permissions-Policy, COOP, `no-store`. |
| 19 | Force HTTPS | The app requires an `https://` Supabase URL (plain HTTP only for a local dev stack), Android blocks cleartext traffic, iOS ATS is on, TLS pinning; HSTS on function responses; Supabase serves only HTTPS. |
| 20 | Scan dependencies | Dependabot; CI Dependency audit of the app and the Edge Functions; Dependency review on pull requests. |
| 21 | Only videos, fully scanned before upload | The phone reads the whole file before uploading: it must be an MP4 or QuickTime file whose boxes tile the file exactly, with a real video track, nothing hidden in or after the media data, and H.264 / HEVC frames whose NAL units add up. Anything else (documents, archives, apps, images, audio, renamed files, files with data appended) is refused with a message. The server checks the uploaded copy again before anyone can watch it and deletes anything that fails. |
