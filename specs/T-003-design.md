# T-003 technical design: the Operative app (Phase 2b)

Epic: [tickets/T-003-operative-app.md](../tickets/T-003-operative-app.md). Build order and file
ownership: [T-003-work-packages.md](T-003-work-packages.md). Per-ticket specs:
`specs/T-003a.md` to `specs/T-003p.md`. Contract: [api/openapi.yaml](../api/openapi.yaml)
v0.6.0 (staged; hidden by `PENDING_TICKETS` in `backend/tests/contract.py` until each ticket is
built). Owner: architect. Written 2026-11-09. Status: **planned**, nothing built.

## 0. Decisions for Paul (recommended defaults are in effect until you answer)

| # | Question | Recommended default | Why / trade-off |
|---|---|---|---|
| T3-1 | How long are report photos and their location data kept on the server? (Q12) | **6 years after the job's completion date, then the photo files and location are deleted** (the report text stays with the job and billing record). Phone copies: 7 days after the report is reviewed (NFR-8). Signed-out or expired device sessions: purged 90 days after they end | Six years is the UK limitation period for contract claims, i.e. how long a customer can dispute a bill the photos prove. Shorter loses evidence; longer is hard to justify under UK GDPR (storage limitation). The automatic deletion job is not built in this epic (first deletions fall due in 2032); the privacy notice states the period from day one. If you choose a different period only the notice text and a later job change |
| T3-2 | May an operative submit while photos are still sending? (T-003h scenario 4) | **Yes**, with the warning "2 photos are still sending..." The manager sees "2 photos still to arrive" and may still review, with a warning beside the Review button | Blocking would stop operatives in poor signal from finishing the day. The photos are registered on the server before submission, so the office knows exactly what is missing |
| T3-3 | Who owns the Google Play developer account? (T-003p) | **An organisation account in the company's legal name, with you as administrator**, and the operative pilot on the **internal testing track** (up to 100 named testers, no store review wait) | An organisation account needs a D-U-N-S number (free, but can take days to weeks: start now) and a one-off registration fee (US$25 when last published; please confirm at sign-up). Verified: new *personal* accounts must run a closed test with at least 12 testers for 14 continuous days before production access; internal testing does not count towards it. A company app should not hang off a personal Google account anyway |
| T3-4 | Session length (Q1, P7) | **30 days since last use, never more than 90 days from sign-in**; ending at once when the office deactivates the account | "Stay signed in" for a month of normal use without a never-ending credential. A phone unused for 30 days asks for the password again |
| T3-5 | Two phones with different drafts for one job (T-003j) | **First submit wins**; the other phone keeps its extra photos as "Not sent: report already submitted" and the office is not told | Rare with one phone per operative (Q13). Merging two drafts is a large feature |
| T3-6 | Crash reporting | **No third-party crash service in the pilot**: Google Play Console's crash and ANR reports only | Every extra processor of customer-home data needs a contract and a privacy-notice line. Revisit (for example Sentry, EU region, scrubbed) after the pilot |
| T3-7 | Production address for the Play build | **Buy the custom domain (INFRA P11) before T-003p's release build.** Until then, preview builds point at the dev AWS address | An installed app cannot follow a CloudFront address that changes if the distribution is rebuilt |
| T3-8 | App name on the phone, privacy contact | "JobProof" until you choose; privacy contact = the office email you give us | Needed for T-003a's placeholder and T-003l's notice |

Product questions Q2 to Q16 in the epic keep their recommended defaults; each ticket spec lists
the ones it relies on as assumptions.

## 1. Summary

An Expo (React Native) app for Android that lets an operative sign in once, see today's jobs,
photograph work, tick the checklist, and submit a completion report, all while offline, without
ever losing a photo. The backend gains device sessions (rotating refresh tokens), an
operative-scoped API (`/api/v1/operative/*`), draft and submitted report states, photo upload
with evidence metadata into private object storage (S3 in AWS, SeaweedFS in compose, moto in
tests and the no-Docker path), and the manager web app gains a small evidence display.

Main technical choices, each justified below:

1. **Photos upload through the API** (two idempotent requests per photo: JSON metadata, then the
   raw file), not by presigned PUT straight to S3. The **manager views photos by presigned S3
   GET**. (Section 5.)
2. **Local-first app with state-based sync**: the phone's SQLite database is the source of truth
   for the operative's work; a sync engine reconciles dirty state with the server. No operation
   log. (Section 3.4.)
3. **Device sessions**: 15-minute JWT access tokens plus opaque refresh tokens, rotated on each
   use with reuse detection, stored server-side so they can be revoked. (Section 4.)
4. **One report per job, identified by the job**: the job id is the report's idempotency key;
   photos and the submission carry client-generated UUIDs. (Section 6.)

## 2. Versions (verified 2026-11-09)

| Item | Version | Source / note |
|---|---|---|
| Expo SDK | **58** (released 2026-10-15) | expo.dev changelog SDK 58. Stable. Expo Go for SDK 58 lagging: we use development builds anyway |
| React Native | **0.88** | SDK 58 reference table |
| React | **19.3.0** (exact, as bundled by SDK 58) | SDK 58 reference table. The web is on 19.3.1: see risk R4 (one React copy across workspaces) |
| Android | minSdk: Expo supports Android 7+; **we set minSdk 29 (Android 10, P8)**; compileSdk 37, targetSdk 36 | SDK 58 reference table. T-003p re-checks Google Play's target-API rule for the release date |
| Node (tooling) | 22.13+ on the 22 line | SDK 58 changelog; repo already requires >=22.22 |
| Expo packages | SDK-aligned `~58.0.x` (e.g. `expo-router` ~58.0.30, `expo-background-task` ~58.0.12); exact versions chosen by `npx expo install` and locked in `package-lock.json` in T-003a | Expo now versions its packages with the SDK number |
| Expo Router | ~58.0.x; `Stack.Protected` for the signed-in guard, typed routes | docs.expo.dev v58 router reference |
| expo-file-system | ~58.0.x, new `File`/`Directory` API. Upload tasks: multipart or binary body, `onProgress`, `AbortSignal`; background session is **iOS-only** (Android ignores it); the JS task is not restored after the app is killed. SDK 58: `File.write()` is now async | unpkg `expo-file-system@57.0.1` `NetworkTasks.types.ts`; SDK 58 changelog |
| expo-background-task | ~58.0.12: Android WorkManager, minimum interval 15 minutes, runs only with network and enough battery; resumes after reboot; `triggerTaskWorkerForTestingAsync` in development builds only | docs.expo.dev v58 background-task |
| @testing-library/react-native | **14.x** (14.0.0, 2026-06-05): async `render`, React 19+, RN 0.78+, Node ^22.13 | release notes |
| jest-expo | SDK-aligned `~58.0.x` | installed with `npx expo install` |
| Maestro CLI | 2.x (2.8.0 seen in release notes); used outside the workspace only | maestro.dev |
| boto3 | **1.43.126** (2026-11-06), Python >=3.10 | PyPI |
| Pillow | **13.0.0** (2026-10-16); 12.1.1 to 13.0.0 each carry security fixes, so stay current | Pillow release notes |
| moto[s3,server] (dev) | **5.2.5** (2026-10-27) | PyPI |
| SeaweedFS (compose S3) | image `chrislusf/seaweedfs`, Apache-2.0; **tag not verified** (Docker Hub not reachable from the workspace); pinned by digest from the first CI run, like B3/B6 | MinIO stopped publishing community images in Oct 2025 and archived its repo on 2026-04-25; LocalStack has required an account since March 2026 |
| python-multipart | **not used** | Many 2026 DoS advisories (e.g. GHSA-pp6c-gr5w-3c5g); the raw-body upload avoids multipart parsing entirely |

Not verified, to be fixed in T-003a and recorded in ARCHITECTURE.md section 3: eas-cli version,
`@tanstack/react-query-persist-client` / `query-async-storage-persister` (same 5.x line as
react-query 5.107.1).

## 3. Mobile app architecture

### 3.1 Layout (`mobile/`, npm workspace `@jobproof/mobile`)

```
mobile/
  app.config.ts          # name, android.package, minSdk 29, allowBackup false, plugins, permissions;
                         # reads APP_VARIANT and API_BASE_URL from the build environment
  eas.json               # profiles development | preview | screenshots | production (no URLs, no secrets)
  metro.config.js        # expo/metro-config default (monorepo support) + single-React guard (R4)
  jest.config.js         # projects: "logic" (node env) and "ui" (jest-expo preset + RNTL)
  app/                   # Expo Router routes (file = screen)
    _layout.tsx          # providers: QueryClient(+persister), Branding, Session, Sync; Stack.Protected
    sign-in.tsx
    (app)/_layout.tsx    # header: company name, sync status line, offline banner
    (app)/index.tsx      # My jobs
    (app)/jobs/[jobId]/index.tsx        # job detail, checklist, photo groups, submit button
    (app)/jobs/[jobId]/camera.tsx       # in-app camera (stage buttons, counter)
    (app)/jobs/[jobId]/items/[itemId].tsx  # item: done / can't do + reason / note / photos
    (app)/jobs/[jobId]/photos/[photoId].tsx  # full screen, stage/item/caption, delete
    (app)/jobs/[jobId]/submit.tsx       # summary, problems, confirmation
    (app)/jobs/[jobId]/sign-off.tsx     # T-003o
    (app)/sync.tsx       # every unsent item by job; Sync now
    (app)/settings/index.tsx, privacy.tsx
  src/
    config.ts            # runtime config from expo-constants `extra` (API origin, variant)
    api/                 # configureApiClient wiring, SessionManager (refresh, single flight), SecureTokenStore
    db/                  # LocalDb Adapter (expo-sqlite | node:sqlite), migrations, repositories
    files/               # PhotoFiles Adapter over expo-file-system (paths, move, delete, free space)
    capture/             # camera and picker helpers, EXIF reading, upload copy, SHA-256
    sync/                # engine (pure decide functions + runner), retry policy, monitors, background task
    features/            # screen components: jobs, job, items, photos, submit, sync, settings
    ui/                  # Button (56 dp primary), StatusBadge (icon + word), Banner, a11y helpers
    theme/               # branding -> RN style tokens (shared DEFAULT_THEME, contrast)
    privacy/notice.ts    # the privacy notice text (also the Play privacy policy source)
  modules/volume-shutter/  # local Expo module (Kotlin) for the volume-key shutter (T-003m)
  test/integration/      # headless sync tests against the real backend (section 9)
  .maestro/              # UI flows, run on a phone or emulator outside the workspace
```

Root `package.json` adds `mobile` to `workspaces`; `npm run lint` and `npm test` include it.
Expo Go is not used (local native module, config plugins): developers use a development build.

### 3.2 Reuse of the generated client and `shared/`

Unchanged and reused: the generated client and types (`shared/src/generated/`), the Adapter
`configureApiClient`/`callApi`, `ApiError`, query keys, `DEFAULT_THEME`, `contrast.ts`,
`cleanText` and the forbidden set, date formatting (Europe/London), `useBranding`.

Changed in `shared/` (platform-neutral, Vitest-tested, web behaviour unchanged):
- `api/client.ts`: (a) feature-detect `AbortSignal.any`/`AbortSignal.timeout` and fall back to a
  manual `AbortController` plus `setTimeout` (Hermes may not ship them: R5); (b) optional
  `refresh?: () => Promise<boolean>` in `ApiClientOptions`: on a 401 other than
  `invalid_credentials` the Adapter calls it once (single flight, shared promise) and retries the
  call; only if it fails does `onUnauthorized` run. Web passes no `refresh`, so nothing changes.
- New `shared/src/operative/`: `status.ts` (job status words, "6 of 9 done"), `submitRules.ts`
  (the submit completeness rule, twin of the backend, with a case table
  `submitCases.json` read by pytest and Vitest), `validation.ts` (caption 140 single-line; item
  note 500, job notes 2,000, multi-line; sign-off name 120), `evidence.ts`
  (`photoEvidenceFlags(photo, job)`: clock offset over 300 s, "Taken on a different day",
  "From gallery", location recorded; used by the web manager view and the app), `semver.ts`.
- New `shared/src/hooks/useOperative.ts`: `useOperativeJobs`, `useOperativeJob` (TanStack Query,
  keys `["operative","jobs"]`, `["operative","job",id]`). Writes are **not** shared hooks: they
  go through the mobile sync engine (they must work offline).

Platform-specific (mobile only): navigation, camera and picker, SQLite and files, the sync
engine, the session manager, secure storage, permissions, background task, theming in RN styles.
Web only: the manager evidence display (T-003g/h/k).

### 3.3 Local storage

| What | Where | Why |
|---|---|---|
| Refresh token, device id | `expo-secure-store` (Android Keystore-backed) | NFR-10. Access token lives in memory only |
| Work: drafts, checklist states, photo records, sync state | SQLite (`expo-sqlite`), one file `jobproof.db`, `journal_mode=WAL`, **`synchronous=FULL`** | A photo row committed 2 s before the battery dies must survive (T-003i scenario 10) |
| Photo originals and upload copies | `Paths.document/photos/<userId>/<photoId>.jpg` and `.../upload/<photoId>.jpg` (app-private) | P6: not in the gallery; app-private storage is excluded from backup with `allowBackup: false` |
| Server cache (job list and details, branding) | TanStack Query persisted to `expo-sqlite/kv-store`, key per user (`jobproof.query.v1.<userId>`), max age 7 days | Offline list and detail (T-003c 9, T-003d 9) without a second schema |

Every work table has `owner_user_id`; every query filters on the signed-in user, so a second
operative on the same phone never sees or sends the first one's items (Q13, T-003b 10). This is
application-level separation, not encryption: shared phones remain unsupported.

SQLite schema (migrations by `PRAGMA user_version`, in `mobile/src/db/migrations.ts`):

- `drafts(owner_user_id, job_id, notes, notes_rev, notes_synced_rev, sign_off_json, sign_off_rev,
  sign_off_synced_rev, local_state ['draft'|'submit_queued'|'submitted'|'rejected'],
  submission_id, device_submitted_at, last_error_code, PRIMARY KEY(owner_user_id, job_id))`
- `checklist_states(owner_user_id, job_id, item_id, status, note, rev, synced_rev, PRIMARY KEY(...))`
- `photos(id PRIMARY KEY, owner_user_id, job_id, stage, checklist_item_id, caption, meta_rev,
  meta_synced_rev, source, taken_at, taken_at_source, latitude, longitude, accuracy_m,
  location_source, original_path, original_width, original_height, original_bytes,
  original_sha256, upload_path, upload_width, upload_height, upload_bytes, upload_sha256,
  sync_state, attempts, next_attempt_at, last_error_code, deleted, created_at)`
- `sync_meta(key, value)`: clock offset and when measured, last list refresh, battery/Wi-Fi flags.

`rev`/`synced_rev` pairs are the dirty flags: an edit bumps `rev`; a successful send records the
`rev` it sent as `synced_rev`. An edit made while a request is in flight therefore stays dirty and
is sent next time (no lost update).

### 3.4 Sync engine (the heart of T-003f/g/h/i/j)

**State-based reconciliation, not an operation log.** For each job with local work the engine
asks "what is the next request that makes the server match the phone?", sends it, records the
result and asks again. Repeats are safe because every request is idempotent (section 6), edits
coalesce for free (only the latest values are sent), and there is no ordering bug to make.

Photo `sync_state` transitions (a transition table in `mobile/src/sync/photoStates.ts`; plain
data, not GoF State classes, because states carry no behaviour beyond "next action"):

| State | Next request | On success | Shown to the operative |
|---|---|---|---|
| `saved` | create upload copy (once, then reuse) and SHA-256s; `PUT .../photos/{id}` | `registered` | Waiting |
| `registered` | `PUT .../photos/{id}/content` (progress events) | `sent` | Waiting / Sending 40% |
| `sent` + `meta_rev > meta_synced_rev` | `PUT .../photos/{id}` (stage/item/caption) | stays `sent` | Sent |
| any + `deleted` | if registered: `DELETE .../photos/{id}`; then remove row and files | gone | (hidden) |
| `failed` | none until the operative acts (delete) or Sync now for retryable codes | | Couldn't be sent: reason |

Order inside one run (per user, single flight with a mutex; a trigger during a run sets a
"run again" flag, so an automatic retry racing "Sync now" cannot double-send, T-003j 9):
1. `GET /app/status` (clock offset, minimum version). 426 pauses everything ("Please update").
2. Draft fields with `rev > synced_rev` → one `PATCH .../report` per job.
3. Deleted photos → `DELETE`. Unregistered photos → register (oldest first).
4. File uploads, oldest first, **at most 2 at once** (T-003g 11), job of a queued submit first.
5. Queued submits → `POST .../report/submit` with the stored `submission_id`, once every photo
   of that job is `sent`, **or** each unsent photo of that job has had one failed upload attempt
   in this run (stuck photos do not block a submit, T-003h 4; T-003i 4 photos-first is honoured
   whenever the signal allows).
6. Job list refresh if older than 5 minutes (NFR-6).

**Upload copy is created once and persisted** (path and SHA-256 stored before registration). A
crash and a second resize would produce different bytes for the same photo id, which the server
would refuse as `photo_content_mismatch`.

**Error classification** (`mobile/src/sync/classify.ts`, pure, table-tested):

| Response | Treatment |
|---|---|
| network error, timeout, 5xx, 429, 503 `busy` | retry with backoff: 5 s, 15 s, 1 min, 5 min, then every 15 min, ±20% jitter; `Retry-After` wins if longer (NFR-4) |
| 401 | refresh once (SessionManager); if refresh fails: `session_ended` → "Please sign in again to finish sending" (queue kept); `account_inactive` → T-003b 11 |
| 426 `app_update_required` | pause all sync; "Please update the app to continue." with Play link |
| 404 on a job or photo | job reassigned or gone: items → Needs attention "This job was changed by the office. Contact the office." (never deleted) |
| 409 `job_cancelled` / `job_closed` | Needs attention with the T-003h/n wording; photos kept |
| 409 `already_submitted` | compare `submission_id` from a fresh `GET`; mine → Submitted; another → "already submitted from another device"; unsent photos → "Not sent: report already submitted" |
| 409 `photos_not_registered` | register the missing ids, then retry submit (same run) |
| 409 `report_submitted` | photo changes after submission: mark "Not sent: report already submitted" |
| 409 `photo_content_mismatch` | permanent failure for that photo (should never happen; reported in Sync screen) |
| 409 `duplicate_photo` | "This photo is already on this job." (T-003j 5); operative may delete |
| 409 `photo_limit_reached` | Needs attention with the limit message |
| 413, 415 | photo `failed` "Couldn't be sent: file too large / not a photo" (T-003g 9) |
| 422 `checksum_mismatch` | recompute the upload copy's SHA-256 from the file; if it matches the registration, retry (transient corruption, max 3); else `failed` |
| 422 `submission_incomplete` | draft back to `draft` with the server's reasons shown (should not happen: the app checks first with the shared twin) |

**Triggers**: app start and foreground; network regained (`expo-network` listener); 2 s after any
local edit (debounced); backoff timers; "Sync now" (ignores backoff, battery saver, and asks
"Use mobile data this time?" when Wi-Fi-only blocks, T-003g 10); the background task.

**Battery saver**: `expo-battery` low-power state pauses automatic runs ("Paused by battery
saver. Tap Sync now."), Sync now still runs (NFR-6, T-003i 14). No polling faster than every 5
minutes in the foreground.

**Status**: the engine is an Observer subject (`subscribe`/`getSnapshot`), read in React through
`useSyncExternalStore`. Header line: "All sent", "Sending 3 photos", "Waiting for signal (3
photos)", "Needs attention (1)" (T-003g 4).

### 3.5 Background and resumable upload on Android, within Expo's limits

- **What Android and Expo allow** (verified): `expo-file-system` upload tasks run while the app
  process lives (foreground, or briefly backgrounded); their background session is iOS-only and
  a killed app does not restore the JS task. `expo-background-task` schedules a WorkManager job
  at least every 15 minutes, only with network and enough battery, surviving reboot; vendors may
  delay it (dontkillmyapp.com).
- **Design**: uploads run in the foreground engine; when the app goes to the background the
  current uploads continue as long as Android keeps the process; a registered background task
  (`jobproof-sync`, minimum interval 15 minutes) runs one engine pass headless (open SQLite, read
  the refresh token, refresh, run steps 1 to 5 with a 25-second budget, stop cleanly). On the
  next open the engine resumes at once. When the app is backgrounded with unsent items, the Sync
  screen and My jobs show "Open the app to finish sending" if nothing has moved for 30 minutes.
- **Not chosen**: an Android foreground service (persistent notification, a notification
  permission, Play "foreground service type" declarations, and Android 15's time limits for data
  sync) and push-triggered sync. Revisit only if pilot data shows photos waiting for hours.
- **Resumable (NFR-5)**: a photo upload is a single request of 0.8 to 2 MB; an interrupted upload
  restarts **only that photo**, never the report, and never creates a second copy (the server
  stores a photo id once). NFR-5 allows this ("or restarts only that photo"). Byte-range resume
  would need a custom protocol for little gain at this size.

### 3.6 Capture ("a photo is never lost")

1. In-app camera (`expo-camera` `CameraView`; never the system camera app, which may save to the
   gallery, P6). `takePictureAsync({ exif: true, skipProcessing: false })`.
2. When it resolves (the shutter sound and thumbnail moment): **move** the file from the cache
   into `photos/<userId>/<photoId>.jpg` (same filesystem: a rename), then insert the `photos` row
   in one SQLite transaction with `synchronous=FULL`. Only then is the thumbnail shown.
3. Startup recovery: any file in `photos/<userId>/` without a row becomes a row (stage = last used,
   flagged "Recovered: check the stage"), so a kill between steps 2a and 2b loses nothing.
4. Location (T-003k): if permitted, `getLastKnownPositionAsync` (max age 2 min) else
   `getCurrentPositionAsync` with a 5 s timeout, in parallel with capture, written to the row
   when it arrives; never delays the next shot (NFR-3).
5. Gallery: `expo-image-picker` `launchImageLibraryAsync({ mediaTypes: ['images'],
   allowsMultipleSelection: true, exif: true })` (system photo picker, no media permission,
   T-003l 8); each picked file is **copied** into app storage (the evidence must survive the
   user deleting it from the gallery). EXIF `DateTimeOriginal` (+ `OffsetTimeOriginal` if present,
   else read as Europe/London local time) → `taken_at_source = file_metadata`; none →
   `added_time`. GPS from the file only if present (Android redacts it without
   `ACCESS_MEDIA_LOCATION`, which we do not request), recorded with `source = file`.
6. Same gallery photo twice on one job: refused locally by `original_sha256` (computed lazily in
   the engine) and by the server's unique index (T-003j 5).
7. Free space: warn under 500 MB, refuse capture under 100 MB (NFR-8), from
   `Paths.availableDiskSpace`.
8. Upload copy (in the engine, not at capture): `expo-image-manipulator` resize to long edge
   2560 px, JPEG quality 0.8 (re-encoding drops EXIF), SHA-256 with `expo-crypto` over the bytes.
   HEIC and PNG gallery files are converted to JPEG here, so the server only ever needs JPEG/PNG.

### 3.7 Secure token storage and session handling on the phone

`SecureTokenStore` implements the shared `TokenStore` (async) over `expo-secure-store` for the
refresh token; the access token and its expiry live in memory in `SessionManager`, which
refreshes proactively 60 s before expiry and on a 401 (single flight). `allowBackup: false`
keeps Keystore-encrypted values from being restored onto a phone that cannot decrypt them.
Sign-out: `DELETE /auth/sessions/current` when online (best effort), then delete the refresh
token; with unsent items the T-003b scenario 9 choice applies and items stay under the user id.

## 4. Session mechanism (P7: stay signed in 30 days per device, revocable at once)

The web keeps today's 30-minute JWT with no refresh (unchanged, out of scope).

- **Sign-in** `POST /auth/sessions` (operatives only): verifies the password (argon2), refuses
  other roles with 403 `operatives_only` **after** the password check (so it reveals nothing to
  someone without the password), revokes an active session for the same `(user, device_id)`
  (`replaced`), creates an `auth_sessions` row, returns a 900 s access JWT with claim `sid` and a
  refresh token `"<session_id>.<43 chars of base64url(32 random bytes)>"`. Only
  `sha256(secret)` is stored (the secret has 256 bits of entropy, so a fast hash is right here;
  argon2 is for passwords).
- **Refresh** `POST /auth/sessions/refresh`: parse the session id, `SELECT ... FOR UPDATE`, then:
  revoked → 401 `session_ended`; `now >= idle_expires_at` or `>= absolute_expires_at` →
  `session_ended`; user inactive → revoke (`deactivated`), 401 `account_inactive`; hash equals
  current → rotate (previous := current, new current, `rotated_at`, `generation + 1`,
  `last_used_at`, `idle_expires_at = min(now + 30 d, absolute)`); hash equals previous and
  `now - rotated_at <= 60 s` → rotate again (the client lost the last response; the unreceived
  token dies); anything else → revoke (`reuse_detected`) and 401 `session_ended`. Constant-time
  comparisons.
- **Every authenticated request**: `current_user` already reloads the user (role, `is_active`).
  When the token has `sid`, it also loads the session by primary key and answers 401
  `session_ended` if revoked or past `absolute_expires_at`, and 401 `account_inactive` for an
  inactive user. Deactivation is therefore effective on the next request, within seconds, not
  after the 15-minute access token expires. Web tokens (no `sid`) keep today's behaviour and code.
- **Deactivation**: no user-management UI exists (B13). New CLI `python -m app.cli
  deactivate-user --email ...` sets `is_active=false` and revokes the user's sessions; demos and
  tests use it.
- **Device clock**: the app never decides expiry from its own clock; it tries and lets the
  server answer.
- **Rate limiting**: the prod WAF login rule extends to `POST /api/v1/auth/sessions` (INFRA delta).
- Settings: `DEVICE_ACCESS_TTL_SECONDS=900`, `DEVICE_SESSION_IDLE_DAYS=30`,
  `DEVICE_SESSION_MAX_DAYS=90`, `REFRESH_REUSE_GRACE_SECONDS=60`.

## 5. Photo upload and viewing: decision

**Decision: upload through the API; view through presigned S3 GET.**

| | Through the API (chosen) | Presigned PUT to S3 |
|---|---|---|
| Requests per photo | 2 (metadata JSON, raw file) | 3 (init, PUT to S3, complete) plus a verification read |
| Validation | in one place, synchronously: size cap, magic bytes, SHA-256, decode check, dimensions, metadata removal, thumbnail | after the fact: needs HeadObject/GetObject on complete, plus a worker or Lambda for thumbnails and metadata removal (we have no worker) |
| "Exactly one copy" | one transaction on the photo row | coordination between S3 state and the DB |
| Phone talks to | one origin, one auth mechanism | API plus the S3 regional endpoint |
| Cost | backend bandwidth and memory (0.8 to 2 MB per photo, 60 per operative per day) | S3 does the heavy lifting |
| Local substitute | any S3-compatible store for server-side PUT | must also support presigned PUT with signed checksum headers |

At pilot volume (a few operatives, about 60 photos each a day, ~100 MB per operative per day)
the API path is well within one 0.25 vCPU task. A per-task limit (`PHOTO_UPLOAD_CONCURRENCY`,
default 4) answers 503 `busy` with `Retry-After: 5` beyond it, and the app backs off. **Deferred:**
presigned PUT, revisit when more than ~50 operatives upload daily or upload p95 exceeds 5 s
(ARCHITECTURE section 13.2).

Upload rules (contract `registerOperativePhoto`, `uploadOperativePhotoContent`):
- Raw body, not multipart (no `python-multipart`, see versions). `Content-Length` required, at
  most 10 MiB, checked before reading; body read in chunks with a hard cap.
- Type: `image/jpeg` or `image/png`, declared at registration, checked against magic bytes.
  HEIC is converted on the phone (3.6 step 8), so the server does not accept it: a deliberate
  narrowing of NFR-1's "JPEG/HEIC/PNG" (the app never sends HEIC; accepting it would add a native
  HEIF decoder to the backend).
- Integrity: SHA-256 of the body must equal the registered `upload.sha256` (transport check).
  The phone also registers `original.sha256` of the full-size file it keeps: in a dispute the
  phone's original can be matched to the record.
- Decode: Pillow opens and verifies, `Image.MAX_IMAGE_PIXELS = 50_000_000`, decompression-bomb
  warnings are errors (415/413); width and height must equal the registration.
- **Malware**: no antivirus engine. Mitigations: only JPEG/PNG that decode are stored; files are
  never executed or parsed again except by Pillow for the thumbnail; objects carry a fixed
  `Content-Type`, `Content-Disposition: inline`, and are served from a separate origin (S3) with
  `X-Content-Type-Options: nosniff`. Option for prod later: GuardDuty Malware Protection for S3.
- **EXIF/GPS**: the phone's upload copy has no EXIF (re-encoded). Defence in depth: the server
  removes JPEG APP1 (EXIF, XMP), APP13 (IPTC) and COM segments and PNG `eXIf`/`tEXt`/`iTXt`/`zTXt`
  chunks **without re-encoding** (a small segment parser, `app/photos/metadata.py`). It records
  `sha256` (received bytes, equals the phone's upload copy) and `stored_sha256` (equal unless
  something was removed). Location is stored only in database columns, from the registration,
  visible only to managers.
- Thumbnail: 480 px long edge, JPEG quality 75, via Pillow `draft()` (cheap). Objects:
  `reports/<report_id>/photos/<photo_id>/full.(jpg|png)` and `.../thumb.jpg`, SSE-S3, private.
- Never replaced: once `received_at` is set, the same bytes are a 200 no-op and different bytes
  are 409 `photo_content_mismatch` (T-003k 9).

Viewing: `PhotoStore` (existing Strategy) gains an object-store branch: seeded photos
(`registered_at` null) keep the HMAC-signed placeholder URL; uploaded photos get boto3
presigned GET URLs (`PHOTO_URL_TTL_SECONDS`, default 900) for `full` and `thumb`. The web's
existing refetch-on-expiry logic still applies. **CSP change**: `img-src` adds the photos origin
(AWS: `https://<bucket>.s3.eu-west-2.amazonaws.com`, virtual-hosted style; local:
`http://localhost:8333`, path style). The URLs carry no location (metadata removed), so a link
that leaks shows only the picture (T-003k 12). The app shows its own thumbnails from the same
presigned URLs only after reinstall (otherwise it uses its local files, NFR-7).

Local substitutes: **SeaweedFS** in docker compose (S3 API on 8333, a `photos-init` one-shot
creates the bucket); **moto** server for `scripts/dev.sh` (no Docker) and moto's in-process mock
in pytest. The same `S3ObjectStore` code runs everywhere; only `PHOTO_S3_ENDPOINT_URL`,
`PHOTO_S3_PUBLIC_ENDPOINT_URL` (host used when presigning, as seen by browsers and phones),
`PHOTO_S3_ADDRESSING_STYLE` and dummy credentials differ. In staging/production the endpoint and
static credentials must be unset (task role only; the config guard refuses otherwise).

## 6. API (contract v0.6.0, all additive)

Personas: every operation below is **painter only** (403 for manager and admin), except the
public `getAppStatus` and the two public session calls. Ownership: `get_own_job(session, user,
job_id)` filters `jobs.painter_id = user.id`; anything else is 404 `not_found` (no hint that it
exists, T-003c 2). No Policy class: there is one rule, applied by one function.

| Operation | Ticket | Idempotency |
|---|---|---|
| `GET /api/v1/app/status` `getAppStatus` (public) | T-003a | read |
| `POST /api/v1/auth/sessions` `createDeviceSession` (public) | T-003b | new session per call; same device replaces |
| `POST /api/v1/auth/sessions/refresh` `refreshDeviceSession` (public) | T-003b | rotation with a 60 s replay grace |
| `DELETE /api/v1/auth/sessions/current` `endDeviceSession` | T-003b | 204 always |
| `GET /api/v1/operative/jobs` `listOperativeJobs` | T-003c | read |
| `GET /api/v1/operative/jobs/{job_id}` `getOperativeJob` | T-003d | read |
| `PATCH /api/v1/operative/jobs/{job_id}/report` `saveOperativeDraft` | T-003f | set-to-value fields; job id = report key |
| `PUT /api/v1/operative/jobs/{job_id}/photos/{photo_id}` `registerOperativePhoto` | T-003g | client photo id; identical repeat 200 |
| `DELETE /api/v1/operative/jobs/{job_id}/photos/{photo_id}` `deleteOperativePhoto` | T-003g | 204 even if absent |
| `PUT /api/v1/operative/jobs/{job_id}/photos/{photo_id}/content` `uploadOperativePhotoContent` | T-003g | stored once; same bytes 200 |
| `POST /api/v1/operative/jobs/{job_id}/report/submit` `submitOperativeReport` | T-003h | client `submission_id`; replay 200 |

Contract changes to existing schemas (additive, `x-ticket`): `ReportDetail.submitted_by`,
`pending_photo_count` (T-003h), `device_submitted_at`, `submit_clock_offset_seconds` (T-003k),
`sign_off` (T-003o); `ReportPhoto` evidence fields and `location` (T-003k); `ChecklistItem.
cannot_do`, `removed` (T-003k); `AuditAction` gains `report.submitted`, `report.photo_received`;
`Problem.code` gains 17 codes. New header convention: the app sends `X-App-Version`; below
`MOBILE_MIN_VERSION_ANDROID` the operative and session operations answer 426 (T-003n).

**B9 (painter vs operative):** the new surface is named "operative" (paths, schema names,
fields such as `notes` instead of `painter_notes`); the stored role value stays `painter`, and
existing manager fields (`painter`, `painter_id`, `painter_notes`, `/manager/painters`) are not
renamed. Renaming the role value touches the JWT, the DB enum and the web guard for no user
benefit; it is left for a deliberate v1.0 contract clean-up (B9 stays open, narrowed).

Manager endpoints: drafts are invisible. Every manager query filters `job_reports.state =
'submitted'` through one helper (`services/reports.py` `submitted_reports()`); a draft report id
is 404 on GET, PATCH, review and history; the dashboard, lists, invoice `report_id`, and customer
impact counts ignore drafts. Test: a seeded draft never appears on any manager operation
(enumerated from the contract).

## 7. Data model and migrations (numbered after head 0008)

One linear chain, one revision per ticket. **T-002m's optional job types move to the next free
number (0014) if ever built.**

| Rev | Ticket | Change | Risk and downgrade |
|---|---|---|---|
| 0009 | T-003b | `auth_sessions` (below) | additive; drop table |
| 0010 | T-003c | `job_checklist_items` (job's planned checklist) backfilled from existing report items **with the same ids**; FK `report_checklist_items.id → job_checklist_items.id`; `report_checklist_items.cannot_do`; `report_state` enum and `job_reports.state` (existing rows `submitted`), `submitted_at` and `review_status` become nullable, `submitted_by_id` (backfilled = `painter_id`), consistency checks | **The risky one**: nullable columns change ORM types used by manager code (mypy will flag every site); drafts must never leak to manager endpoints (test). Rolling deploy: old code never sees drafts because only new code creates them, and the app is released after the backend. Downgrade refuses if any draft or any `cannot_do` exists |
| 0011 | T-003g | `report_photos` evidence and upload columns, unique `(report_id, original_sha256)` | additive; drop columns (refuses if any uploaded photo exists, since files would be orphaned) |
| 0012 | T-003h | `job_reports.submission_id` (unique), `device_submitted_at`, `submit_clock_offset_seconds`; audit enum values `report.submitted`, `report.photo_received` (autocommit block, as 0007) | additive; downgrade refuses if those events exist |
| 0013 | T-003o | sign-off columns and enum | additive; drop |

`auth_sessions`: `id` uuid PK; `user_id` FK users RESTRICT; `device_id` uuid; `device_name`,
`platform` (check android/ios), `app_version` text; `created_at`, `last_used_at`,
`idle_expires_at`, `absolute_expires_at` timestamptz; `refresh_hash` char(64);
`previous_refresh_hash` char(64) null; `rotated_at` null; `generation` int default 1;
`revoked_at` null; `revoked_reason` text null check in (`signed_out`, `replaced`,
`deactivated`, `reuse_detected`); checks `(revoked_at IS NULL) = (revoked_reason IS NULL)`,
`idle_expires_at <= absolute_expires_at`; partial unique `(user_id, device_id) WHERE revoked_at
IS NULL`. The seed truncates it with users.

Report checklist identity: because a job has at most one report, a report checklist item's id
**equals** its job checklist item's id (1:1 extension row). The operative API, the manager API
and photo links all use that one id. A job item added later gets its report row on the next
draft write or at submit; a removed job item (`removed_at`) keeps its report row only if the
operative recorded something on it (shown as "Other photos and notes", not counted for submit).
The office has no UI to edit checklists in this epic; removal is exercised by fixtures (T-003f 10).

`report_photos` additions (0011): `checklist_item_id` FK report_checklist_items SET NULL;
`source` (`camera|gallery`, default camera for seeded), `taken_at_source` (default
`device_clock`), `registered_at`, `registered_by_id`, `device_sent_at`, `clock_offset_seconds`,
`received_at`, `latitude`/`longitude` double precision, `location_accuracy_m` real,
`location_source` (all-or-none check), `original_width/height`, `original_bytes` bigint,
`original_sha256`, `upload_bytes`, `sha256`, `stored_sha256` char(64), `thumb_storage_key`.
Seeded rows: `registered_at` null (placeholder). Check: `received_at IS NULL OR (storage_key IS
NOT NULL AND sha256 IS NOT NULL)`.

Job and report state transitions (server): first write → draft created, job `scheduled →
in_progress`; submit → report `submitted` + `awaiting_review`, job `completed`, `completed_on =
max(scheduled_start, London date of submitted_at)`. Draft saves do not change `version` (it
counts manager changes); late photo arrival does not either.

## 8. Authorisation, privacy of fields, evidence integrity

**Authorisation matrix additions** (ARCHITECTURE section 7): painter: `/operative/*` on own jobs
(other jobs 404), session endpoints; manager/admin: 403 on `/operative/*`, 403
`operatives_only` on `createDeviceSession`; painter keeps 403 on `/manager/*` and `/admin/*`.
Operative responses are built from dedicated schemas (`schemas/operative.py`) that do not have
`manager_notes`, money, customer email or billing address; a test walks every operative response
and fails on any of those keys. The operative sees `reviewed_by` (name) but no manager notes or
history.

**Evidence integrity rules** (T-003k; flagged, not tamper-proof):
1. Server times are authoritative: `registered_at`, `received_at`, `submitted_at`.
2. Device times are recorded as given: `taken_at` (camera: device clock; gallery: file date or
   `added_time`), `device_submitted_at`, and `device_sent_at` on each request.
3. Clock offset = server receive time minus `device_sent_at` **of that request** (set at send,
   not at queue time, so hours offline do not look like a wrong clock). Stored per photo
   (`clock_offset_seconds`) and per submission. |offset| > 300 s → "Phone clock was out by about
   N minutes/hours/days" on the photo and report (shared `evidence.ts`). Limitation: if the
   clock was wrong at capture and corrected before sending, it is not detected.
4. "Taken on a different day": London date of `taken_at` differs from the job's
   `scheduled_start`; information only.
5. Evidence fields are immutable after registration; files are never replaced; deletion only by
   the operative while a draft, without trace (ticket rule T-003k 11).
6. `report.submitted` and `report.photo_received` audit events give the manager a dated trail.

## 9. Testing strategy (no device or emulator in this workspace)

| Layer | Tool | Runs in the workspace | What it proves |
|---|---|---|---|
| Backend API | pytest + contract validation; moto (in-process) for S3 | yes | every rule in sections 4 to 8: rotation, reuse, revocation, scoping (404), drafts invisible to managers, idempotency, upload validation, submit rules, concurrency (two threads submit, two uploads) |
| Shared logic and hooks | Vitest (+ RTL as today) | yes | adapter refresh and AbortSignal fallback, submit rule twin (`submitCases.json` also read by pytest), validators, evidence flags, status labels |
| Mobile logic | Jest "logic" project, node environment | yes | sync decisions, classifier, retry schedule, rev/synced_rev bookkeeping, migrations, against **`node:sqlite`** through the `LocalDb` Adapter (same SQL as expo-sqlite) and an in-memory `PhotoFiles` |
| Mobile UI | Jest "ui" project, `jest-expo` preset + RNTL 14 | yes | screens and states (loading, empty, error, offline), wording (no "painter"), accessibility props (labels, roles, 48/56 dp) with native modules mocked |
| Headless sync integration | Jest against the **real backend** (`scripts/dev.sh up` + moto server) through a fault-injecting HTTP proxy (`mobile/test/support/faultProxy.ts`: pass, drop before forwarding, **drop the response after the server committed**, delay, 503) | yes | T-003i/j end to end without a phone: offline day, lost submit reply, double submit, kill and restart (new engine over the same DB file), reinstall (new DB), two devices, retry racing Sync now, token expiry mid-run |
| Bundle | `npx expo export --platform android` (with `EXPO_OFFLINE=1`) | yes | Metro resolves everything, one React copy, no Node-only imports in shared |
| Config | `npx expo config --type public` asserted by a test | yes | permissions allowlist, `allowBackup: false`, minSdk 29, no cleartext outside development |
| UI end to end | Maestro flows in `mobile/.maestro/` | **no** (needs a device or emulator) | sign-in, capture, offline submit; run by Paul or a tester on a phone, and optionally by a manual GitHub workflow with an emulator |
| Real device | manual scripts (T-003p 8, 9; T-003m TalkBack, Accessibility Scanner) | no | performance, battery, durability on power loss, camera, permissions |

Detox is not used: it needs native test builds and is heavier to keep green with Expo; Maestro
is black-box YAML and is what Expo's own CI docs use. Web e2e (Playwright) covers the manager
evidence display with seeded operative data.

## 10. Build and release

- **EAS Build** profiles in `mobile/eas.json`: `development` (dev client, APK, cleartext only
  here), `preview` (APK, internal distribution, dev AWS address), `screenshots` (as preview with
  the secure-screen flag off), `production` (AAB, `autoIncrement` versionCode with
  `appVersionSource: remote`). The API address per profile lives in **EAS environment
  variables**, not git (T-003a 6). `app.config.ts` copies it into `extra`.
- Versioning: semver `version` from `mobile/package.json` (shown in Settings, sent as
  `X-App-Version`), versionCode by EAS. **Minimum version**: backend env
  `MOBILE_MIN_VERSION_ANDROID` (default `0.0.0`); raising it retires a faulty build without
  losing work (the app keeps its queue and only stops syncing until updated, T-003p 10).
- Signing: Play App Signing; EAS manages the upload key on Expo's servers; nothing in git.
- Release: `eas submit --profile production` to the **internal testing track** with a Play
  service-account key stored in EAS (Paul creates it). Done by Paul from the EAS dashboard or CLI
  (the workspace has no Expo login); no Expo token is stored in GitHub. EAS Update (over-the-air
  JS) is not used in the pilot: every change ships through Play, which keeps the minimum-version
  rule simple.
- Release prerequisites: prod deployed (INFRA-6/7) and the custom domain (INFRA-8, T3-7).

## 11. CI additions (`.github/workflows/ci.yml`; owner infra engineer)

- `mobile` job: `npm ci`; `npm run lint -w @jobproof/mobile` (eslint + `tsc --noEmit`); `npm test
  -w @jobproof/mobile` (logic + ui projects); `npx expo-doctor`; `npx expo export --platform
  android`; config assertion test.
- `mobile-integration` job: Postgres service, `uv sync`, start moto server and uvicorn, seed,
  run `npm run test:integration -w @jobproof/mobile`.
- `backend` job unchanged (new tests run in it; moto is a dev dependency).
- Optional `mobile-e2e.yml` (manual `workflow_dispatch` only, about 30 runner minutes): Android
  emulator runner, prebuild, release APK, Maestro flows. Not on every push (GitHub free minutes).
- `dependency-check.yml` and Dependabot: add the `mobile` npm workspace; Expo packages are
  upgraded together with `npx expo install --fix`, never one by one (SDK alignment).

## 12. Security and privacy (UK GDPR)

- **What is processed**: photos of customers' homes (may show people, documents, belongings),
  operative's optional location at capture (employee location data), notes, customer contact
  name and phone (on site), operative sign-in details, device id/name and app version.
- **Lawful basis and DPIA**: contract/legitimate interests for the evidence; a short DPIA is
  recommended before the pilot with real customers (homes and employee location). The in-app
  notice (T-003l) and Play data-safety form say the same thing.
- **Minimisation**: location optional, "while using", per photo only, never background; no device
  model or EXIF stored beyond listed fields; customers' email and billing never reach the phone;
  exact coordinates only in manager API responses.
- **Retention**: T3-1. Phone: originals and caches deleted 7 days after review when all sent;
  never while unsent.
- **Permissions**: camera; location while in use (optional); network state; WorkManager's
  wake-lock and boot-completed. Blocked in `app.config.ts`: `RECORD_AUDIO`,
  `ACCESS_BACKGROUND_LOCATION`, `READ_MEDIA_*`, `READ/WRITE_EXTERNAL_STORAGE`,
  `ACCESS_MEDIA_LOCATION`, `SYSTEM_ALERT_WINDOW`, `POST_NOTIFICATIONS`. T-003p checks the built
  APK's merged permissions.
- **On the phone**: secure flag (`expo-screen-capture`) hides the app in recent apps and blocks
  screenshots (off in the `screenshots` profile only); `allowBackup: false`; no logs in release
  builds except a PII-free ring buffer; no photo, name, address or token in any log or crash.
- **On the server**: never log request bodies, coordinates or file names; photos bucket private,
  SSE-S3, TLS-only, versioned (noncurrent versions expire after 30 days, INFRA).

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | No device or emulator here: UI and native behaviour unproven until Paul's phone | Logic and integration tests carry the weight; a device demo at the end of each package; Maestro flows ready for any device |
| R2 | Android background limits (WorkManager >= 15 min, vendor killers) | Honest status, "Open the app to finish sending"; foreground uploads continue while the process lives |
| R3 | Photo durability on power loss (file rename + SQLite FULL) not provable without hardware | Startup recovery of orphan files; T-003p power-cut test on the reference phone |
| R4 | Two React versions in one npm workspace tree (web 19.3.1, Expo 19.3.0) give duplicate React in Metro | T-003a aligns the repo on Expo's React (after checking 19.3.1's changelog has no fix the web needs) or pins resolution in `metro.config.js`; `expo export` + a test that `require.resolve('react')` from shared and mobile match |
| R5 | `AbortSignal.any/timeout` may be missing in Hermes | Feature-detect fallback in the shared Adapter (T-003a) |
| R6 | 0010 makes `submitted_at`/`review_status` nullable: drafts could leak into manager views | One `submitted_reports()` helper; enumerated draft-invisibility test; downgrade guard |
| R7 | Backend carries photo bytes on a small task | concurrency limit with 503 + `Retry-After`; deferral to presigned PUT with a trigger |
| R8 | Pillow parses untrusted files | pixel limit, bomb warnings as errors, weekly dependency check, stay on the latest Pillow |
| R9 | **WAF managed common rule set** (`SizeRestrictions_BODY`, 8 KB) would block photo uploads when switched from count to block | INFRA delta: scope-down/exclude that rule for `PUT /api/v1/operative/jobs/*/photos/*/content` |
| R10 | Play release needs prod and a permanent address (INFRA-6/7/8) | Pilot on preview builds against dev with demo data only (no real customer data in dev, ever) until then |
| R11 | MinIO and LocalStack no longer usable offline; SeaweedFS tag unverified | moto for tests and dev.sh; SeaweedFS pinned by digest from the first CI run |
| R12 | Play account verification lead time (D-U-N-S) | Paul starts now (T3-3) |
| R13 | Clock evidence is advisory | Stated in the UI wording ("flagged, not prevented") |
| R14 | `npm run gen:check` fails from this contract commit until T-003a regenerates the client | Same as T-002 package 4; T-003a's first step is `npm run gen` |
| R15 | Expo SDK cadence and Play's yearly target-API rule | Upgrade SDK as a dedicated ticket each half-year; T-003p checks the target |

## 14. Out of scope (epic list, plus)

Web refresh tokens; office checklist editing UI; push notifications and foreground services;
byte-range resumable uploads; presigned PUT; antivirus scanning; automatic retention deletion;
renaming the `painter` role value; EAS Update; iOS build and store; Sentry or other crash vendor.
