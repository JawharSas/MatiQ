# MatIQ architecture

## System overview

```mermaid
flowchart LR
  subgraph Device["Mobile app (Expo SDK 58, React Native 0.88, Hermes)"]
    UI["Expo Router screens<br/>React Query cache"]
    CAM["VisionCamera 5<br/>1080p/30 hardware encode"]
    IMG["Nitro Image<br/>native resize + JPEG"]
    MMKV[("MMKV AES-256<br/>session + offline cache")]
    KS[("Keychain / Keystore<br/>MMKV key")]
  end

  subgraph Supabase
    AUTH["Auth<br/>PKCE, rotating refresh tokens, TOTP MFA"]
    API["PostgREST<br/>RLS on every table"]
    RT["Realtime<br/>matches status"]
    ST[("Storage<br/>private buckets")]
    EF["Edge Functions (Deno)<br/>analyze-match · api-keys · account"]
    DB[("Postgres<br/>public + private schemas")]
  end

  AI["Anthropic API<br/>Claude vision, structured outputs"]

  UI -- "TLS + SPKI pinning" --> AUTH
  UI --> API --> DB
  UI --> RT
  CAM --> IMG --> UI
  UI -- "frames / video (signed URL, native upload)" --> ST
  UI -- "JWT" --> EF
  EF -- "service role (svc_* RPCs)" --> DB
  EF --> ST
  EF -- "platform key or decrypted BYOK key" --> AI
  MMKV --- KS
```

| Layer | Responsibility | Key files |
|---|---|---|
| Mobile app | Capture, local encryption, UI, optimistic caching | `apps/mobile/src` |
| Rules engine | Deterministic scoring shared by app and server | `packages/rules-engine` |
| Postgres | Data, RLS privacy rules, quotas, rate limits, audit log | `supabase/migrations` |
| Edge Functions | AI orchestration, BYOK vault, data export/deletion | `supabase/functions` |
| Anthropic API | Event detection from frames, coaching notes | `supabase/functions/_shared/ai` |

## Analysis pipeline

```mermaid
sequenceDiagram
  autonumber
  participant App
  participant DB as Postgres (RLS)
  participant ST as Storage
  participant EF as analyze-match
  participant AI as Claude
  App->>DB: insert matches (status=draft, client UUID)
  loop while recording / extracting (1-2 FPS, pruned)
    App->>ST: upload {user}/{match}/{t}.jpg (bounded queue, 3 parallel)
  end
  App->>ST: video.mp4 via signed URL (native streaming upload)
  App->>EF: POST {matchId, keySource, athlete hints}
  EF->>EF: auth · rate limit · ownership · length entitlement
  EF->>DB: svc_reserve_analysis (row lock, quota / unlimited / suspended)
  EF-->>App: 202 queued + usage
  EF->>DB: status=processing (Realtime -> app)
  par batches of 20 frames, 3 concurrent
    EF->>AI: frames + discipline schema (structured outputs)
    AI-->>EF: events + observations
  end
  EF->>EF: rules engine -> scorecard, phases, highlights
  EF->>AI: coaching summary (low effort)
  EF->>DB: svc_save_analysis (status=completed) + commit usage
  EF->>ST: delete frames (data minimisation)
  DB-->>App: Realtime update -> dashboard
```

Failure at any step marks the match `failed` with an error code and refunds
the reservation; reservations abandoned by a crashed worker are refunded
automatically after 30 minutes.

### Why the AI only detects events

Vision models are good at recognising *what happened* and poor at applying
rulebooks consistently. MatIQ therefore splits the job:

1. Claude receives timestamped frames and a schema generated from the rules
   engine's vocabulary (`_shared/ai/schemas.ts`), so it can only emit known
   event types.
2. The rules engine (`packages/rules-engine`) validates every event again,
   drops low-confidence ones, and computes points, advantages, round scores,
   phases and highlights deterministically.
3. Raw events are stored next to the scorecard, so matches can be re-scored
   when rules change without paying for another AI call.

## Capture and performance

| Concern | Approach |
|---|---|
| 60 FPS UI | Preview and H.264/HEVC encoding stay native (VisionCamera 5, Nitro/JSI). JS never touches full frames. |
| AI payload sampling | A timer grabs a preview snapshot at 1 FPS (planSampling stretches the interval to stay within a 240-frame budget). Resize, raw-pixel read and JPEG encode run natively on background threads. |
| Frame pruning | A 16-px luminance signature per frame; near-identical frames are dropped, with a keyframe at least every 4 s (`FramePruner`). |
| Memory / heat | Snapshots are skipped while the previous one is processing and halved when the upload queue fills; native image buffers are disposed immediately; frames are capped at 640 px on the long side. |
| Ring buffer | `FrameUploadQueue` holds at most 120 pending frames; overflow evicts the oldest (and deletes its file) instead of growing without bound. |
| Progressive upload | Frames upload in batches of 8 while recording continues, so Stop -> analysis is quick. |
| Large videos | Streamed from disk by the OS uploader (`expo-file-system` `File.upload`, background session on iOS) to a short-lived signed URL. |
| Gallery uploads | `expo-video-thumbnails` decodes one frame at a time, then the same native processing path; extraction yields to the UI between frames and pauses under upload backpressure. |

## Data model

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : has
  AUTH_USERS ||--|| USER_ENTITLEMENTS : has
  AUTH_USERS ||--o{ MATCHES : owns
  MATCHES ||--o| MATCH_ANALYSES : "scored by"
  AUTH_USERS ||--o{ POSTS : writes
  MATCHES ||--o{ POSTS : "shared in"
  POSTS ||--o{ POST_LIKES : receives
  AUTH_USERS ||--o{ FRIENDSHIPS : "user_low / user_high"
  AUTH_USERS ||--o{ BLOCKS : blocks
  AUTH_USERS ||--o{ USAGE_LEDGER : consumes
  AUTH_USERS ||--o{ LEGAL_ACCEPTANCES : accepts
  AUTH_USERS ||--o| USER_API_KEYS : "stores (private schema)"
```

`private` schema (not exposed through the API): `user_api_keys`,
`rate_limits`, `admin_audit_log`, `app_config`, and every helper used by RLS.

## Privacy model

Effective visibility of a **post** (and of the match, analysis and video it
shares), enforced by `private.can_view_author_content`:

| Viewer | Author account | Post | Visible? |
|---|---|---|---|
| Author | any | any | yes |
| Blocked (either direction) | any | any | **no** |
| Accepted friend | any | any | yes |
| Other signed-in user | Public | not friends-only | yes |
| Other signed-in user | Public | friends-only | no |
| Other signed-in user | Private (default) | any | no |
| Anonymous | any | any | no (anon has no table access) |

Matches, analyses and videos that are **not** shared in a post are visible
only to their owner. Profile cards (username, display name, avatar, bio) are
visible to signed-in users who are not blocked, so friend requests work for
private accounts.

The feed (`get_feed`) is `SECURITY INVOKER`: it runs under the caller's RLS,
so it cannot return anything the caller could not read directly.

## Usage limits

- `user_entitlements` holds `role`, `is_unlimited`, `monthly_analysis_limit`,
  `max_video_seconds`, `is_suspended`. Clients can read only their own row and
  cannot write it (no write grants, no write policies).
- `svc_reserve_analysis` locks the entitlements row (`FOR UPDATE`), sums the
  month's reserved + committed units and inserts a reservation, so concurrent
  requests cannot both pass. `is_unlimited = true` bypasses the cap; BYOK
  analyses are recorded with 0 units.
- Owner Panel RPCs (`admin_*`) re-check `role = 'owner'` on every call,
  optionally require an MFA (aal2) session, are rate limited, and append to
  `private.admin_audit_log` (update/delete blocked by trigger).

## Known limits and next steps

- **Long videos:** analysis runs as a background task inside the Edge
  Function, bounded by the platform's wall-clock limit. The defaults
  (240 frames, 20 per request, 3 concurrent) fit typical rounds. For longer
  sessions, move the pipeline to a queue (Supabase Queues / pgmq) with a
  worker that processes one batch per invocation.
- **Resumable uploads:** signed-URL uploads are single requests. For very
  large files on poor networks, switch to Supabase's TUS endpoint with a
  native TUS client.
- **Pinning coverage:** pinning applies to `fetch` traffic. Native
  file uploads use the OS networking stack; they only carry short-lived,
  path-scoped signed URLs.
- **Typed database client:** generate types with
  `supabase gen types typescript --local > apps/mobile/src/types/database.ts`
  and pass them to `createClient<Database>()`.
- **Device integrity:** add App Attest / Play Integrity verification in an
  Edge Function before trusting high-cost requests.
- **Model evaluation:** build a labelled set of rounds to measure event
  precision/recall per discipline before tuning prompts or sampling rates.
