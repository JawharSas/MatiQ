# Security & deployment guide

This guide covers how MatIQ protects data, how to configure secrets, how to
harden and deploy the Supabase backend and the mobile app, and how to publish
the repository safely.

## 1. Threat model and controls

| Threat | Control | Where |
|---|---|---|
| API keys extracted from the app bundle | Only the Supabase URL + publishable anon key ship in the app. AI keys, the service-role key and KEKs exist only as Edge Function secrets. CI scans the repo with gitleaks; a bundle check confirms no secrets compile in. | `apps/mobile/src/config/env.ts`, `.github/workflows/ci.yml` |
| User BYOK keys leaked | Sent once over TLS, verified, encrypted with AES-256-GCM (KEK in function secrets, AAD bound to user + provider), never returned, logged (redacting logger) or stored on the device. Screen capture blocked; device auth required to open the screen. | `supabase/functions/api-keys`, `_shared/crypto.ts`, `settings/api-keys.tsx` |
| Reading other users' data | RLS on every table; `anon` has no table access; helpers are `SECURITY DEFINER` with empty `search_path`; feed is `SECURITY INVOKER`. 58 automated policy tests. | `supabase/migrations/*`, `supabase/tests/database` |
| Privilege escalation (unlimited / owner) | Entitlements live in a separate table with no client write grants or policies; signup metadata cannot set roles; admin RPCs re-check the role (and MFA) every call and are audited. | `20261023000300_access_control.sql`, `20261023000600_owner_panel.sql` |
| Forged scores / analyses | Only the service role writes `match_analyses`, `status`, `frame_count`, `has_video`; column-level grants block client writes; duration frozen after analysis starts. | migrations 300 / 400 |
| Quota bypass / cost abuse | Atomic reservation with row lock, per-user rate limits on every function, frame caps, video-length entitlement, auth rate limits. | `_shared/quota.ts`, `_shared/middleware.ts`, `config.toml` |
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
| `ANTHROPIC_API_KEY` | **Yes** | `supabase secrets set` |
| `MATIQ_KEK_V{n}`, `MATIQ_KEK_CURRENT` | **Yes** | `supabase secrets set` (and a password manager / vault for recovery) |
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

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push                       # apply migrations
supabase secrets set --env-file supabase/functions/.env
npm run functions:deploy               # vendors the rules engine, then deploys
```

Then in the dashboard, mirror `supabase/config.toml`:

- **Authentication**
  - Email confirmations on; secure password change on; minimum password
    length 12 with letters, digits and symbols; enable leaked-password
    protection (available on paid plans).
  - JWT expiry 900 s; refresh token rotation on with a 10 s reuse interval.
  - Redirect URL allow-list: only `matiq://auth/callback` (plus your dev URL).
  - MFA: enable TOTP.
  - Disable providers and anonymous sign-ins you do not use.
  - Keep the auth rate limits at least as strict as `config.toml`.
- **Data API**: exposed schemas = `public` only; max rows = 100.
- **Database**: enforce SSL for direct connections, restrict network access
  to known IPs, enable Point-in-Time Recovery for production.
- **Storage**: raise the global upload limit to at least 500 MB if you allow
  long videos (bucket limits are set by the migration).
- **Realtime**: the migration adds `public.matches` to `supabase_realtime`;
  Realtime applies RLS, so users only receive their own (or shared) rows.
- Run the **Security Advisor** and **Performance Advisor** after every
  migration and resolve every finding.

Data is encrypted at rest by Supabase (AES-256 for the database volumes,
storage objects and backups) and in transit with TLS. BYOK API keys are
additionally encrypted at the application layer, so even a database dump does
not reveal them.

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

The app's Owner Panel then needs an `aal2` session (verify the TOTP factor
with `supabase.auth.mfa.challengeAndVerify` before opening it).

## 4. Edge Functions

| Function | Methods | Purpose | Rate limit (per user) |
|---|---|---|---|
| `analyze-match` | POST | validate, reserve quota, run analysis in background | 20 / hour |
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
| Suspected account takeover | Owner Panel: suspend the account; user signs out of all devices (`signOut({ scope: 'global' })`) and resets password. |
| AI provider key leaked | Revoke it at the provider, `supabase secrets set ANTHROPIC_API_KEY=<new>`. |
| KEK exposed | Rotate (section 4) immediately, then ask users to replace their stored keys. |
| Service-role key exposed | Rotate the project's API keys / JWT secret in the dashboard, redeploy functions. |
| Abuse of analysis quota | Lower `monthly_analysis_limit`, review `admin_usage_overview`, suspend offenders. |

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
- [ ] Production secrets set; no secrets in EAS `EXPO_PUBLIC_*` variables.
- [ ] TLS pins configured with a backup pin.
- [ ] Privacy Policy and Terms reviewed by counsel; `LEGAL_VERSIONS` bumped when they change.
- [ ] Rule values in `packages/rules-engine` checked against current rulebooks.
- [ ] App Store privacy labels / Play data-safety form match the Privacy Policy (no data sold, no tracking).
