# Browser UI preview

A way to see and click through the whole MatIQ app in a browser, with sample
data and no backend. It is a development and QA tool, **not** a web version of
MatIQ: the camera, encrypted storage, TLS pinning and Supabase only exist in
the iOS and Android builds.

```bash
cd apps/mobile
npm run preview:web           # build dist-preview/ (web platform, sample data)
npm run preview:serve         # open http://127.0.0.1:8081
npm run preview:walkthrough   # Playwright clicks through every screen
```

Sign in with **demo@matiq.app** / **matiq-preview** (the account is the app
owner, so the Owner Panel is reachable). Other sample users use the same
password, e.g. `sam_okafor@example.com`. Two-factor codes: any 6 digits except
`000000`, which shows the error path.

## How it works

| Native piece | In the preview |
|---|---|
| Supabase (Auth, Postgres + RLS, Storage, Realtime, Edge Functions) | `fake-backend.ts`: in-memory tables with the same visibility rules, RPCs, functions, TOTP and Realtime events, seeded by `fixtures.ts` |
| AI analysis | Synthetic events for the discipline, scored by the real rules engine |
| Ranked settlement | The real `settleRankedMatch` (Elo, totals, titles) |
| Camera (VisionCamera) | `stubs/vision-camera.tsx` placeholder; `useLiveCapture.web.ts` simulates a 2:30 round |
| Frame sampling, Nitro Image, file system | `video-frame-extractor.web.ts`, `stubs/nitro-image.ts`, `stubs/file-system.ts` |
| MMKV + Keychain/Keystore, TLS pinning, biometrics | `lib/*.web.ts` (memory store, no-ops) |

Only `*.web.ts` files and the Metro web aliases (`metro.config.js`) reach this
folder, so none of it is bundled into iOS or Android builds; `setup.ts` is a
no-op on native.

The walkthrough (`scripts/preview-walkthrough.cjs`) signs in, accepts the
policies, records and analyses a round, opens every dashboard, accepts and
confirms ranked matches, uses matchmaking, the ladder and titles, enables
two-factor authentication, resolves a dispute in the Owner Panel and signs in
again through the two-factor screen. It fails on any uncaught page error and
writes a screenshot per step to `preview-screenshots/`. CI runs it on every
pull request.
