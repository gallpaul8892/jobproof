# T-003 work packages (build plan for the engineers)

Epic: [tickets/T-003-operative-app.md](../tickets/T-003-operative-app.md). Design:
[T-003-design.md](T-003-design.md) (read sections 3 to 7 before any ticket). Contract:
[api/openapi.yaml](../api/openapi.yaml) v0.6.0, staged.

Six packages, built **in order**; inside a package, tickets in the order listed. Each ticket is
done (tests green, review APPROVE) before the next starts, except where "parallel" is stated.
Owners: **backend** = backend engineer, **web** = frontend engineer (web and `shared/`),
**mobile** = mobile engineer (`mobile/`, and `shared/src/operative/` when listed).

| # | Package | Tickets, in order | Kind | Alembic |
|---|---|---|---|---|
| A | Foundation | T-003a, T-003b | backend + shared + mobile | 0009 auth_sessions |
| B | Read the day | T-003c, T-003d | backend (+seed) then mobile | 0010 work model |
| C | Capture and draft | T-003e, T-003f | T-003e **mobile only**; T-003f backend then mobile (sync engine skeleton) | none |
| D | Upload, submit, evidence | T-003g, T-003h, T-003k | backend + local infra, then mobile, then **web** | 0011 photo evidence, 0012 submission |
| E | Hardening | T-003i, T-003j, T-003n, T-003l, T-003m | T-003i, T-003l, T-003m **mobile only**; T-003j backend tests + mobile; T-003n small backend + mobile | none |
| F | Optional and release | T-003o (cut first if late), T-003p | T-003o backend + mobile + web; T-003p mobile + Paul | 0013 sign-off |

Deviation from the epic's order, on purpose: the sync engine is built in T-003f (draft fields)
and extended in T-003g/h, so T-003i is hardening of an engine that already exists, not its first
appearance (the epic calls T-003i the biggest risk; this removes most of it). T-003i may start
as soon as T-003g is merged, in parallel with T-003h and T-003k (different files: `sync/` hardening
vs `features/submit`). Package E tickets may run in parallel with each other.

Within a ticket that has a backend part, the backend part lands first (contract green, ticket
id still in `PENDING_TICKETS` until the client side is done), then mobile/web. The ticket removes
its id from `PENDING_TICKETS` when its backend part is merged.

## Contract staging

`backend/tests/contract.py` `PENDING_TICKETS` was set by the architect (2026-11-09) to
`{"T-003a","T-003b","T-003c","T-003d","T-003f","T-003g","T-003h","T-003k","T-003o"}`; backend
tests stay green with it. Each of those tickets removes its own id. Rules as in T-002: only
operations, parameters and properties carry `x-ticket`, never component schemas.

**Generated client:** `npm run gen:check` (in `make lint`) fails from the contract commit until
**T-003a's first step runs `npm run gen`** and commits `shared/src/generated/`. That client then
contains every T-003 type and SDK function. `shared/src/history.ts` has a `default` branch, so the
two new `AuditAction` values do not break the type-check; their sentences are added in T-003h.

## Files touched per package

### Package A (T-003a, T-003b)

Backend: new `app/routers/app_status.py`, `app/versioning.py` (semver, used fully in T-003n),
`app/routers/sessions.py`, `app/services/sessions.py`, `app/schemas/sessions.py`,
`app/models/sessions.py`, `migrations/versions/0009_auth_sessions.py`; edit `config.py`
(device-session and min-version settings), `deps.py` (`sid` handling, `account_inactive`),
`security.py` (`sid` claim), `cli.py` (`deactivate-user`), `main.py`, `models/__init__.py`,
`seed/loader.py` (truncate `auth_sessions`), `.env.example`. Tests new
`test_app_status_api.py`, `test_device_sessions_api.py`, `test_session_revocation.py`,
`test_cli_deactivate_user.py`; edit `contract.py`, `test_migrations.py`, `conftest.py`
(`operative_device_session` fixture).

Shared: `src/generated/*` (regenerated), `src/api/client.ts` (refresh, AbortSignal fallback),
`src/api/client.test.ts`, `src/operative/semver.ts`, `src/index.ts`. `package.json` peer range
for React if R4 requires it.

Mobile: new workspace `mobile/` (section 3.1 of the design), root `package.json` workspaces and
scripts, `.gitignore` (`mobile/.expo`, `android/`, `ios/`, `*.keystore`, `.env.local`).

### Package B (T-003c, T-003d)

Backend: new `migrations/versions/0010_operative_work_model.py`, `app/models/` additions
(`JobChecklistItem`, `ReportState`, columns), `app/services/operative_jobs.py`
(`get_own_job`, list and detail builders), `app/schemas/operative.py`, `app/routers/operative.py`,
`app/seed/operative_day.py`; edit `services/reports.py`, `dashboard.py`, `invoices.py`,
`customers.py`, `audit.py` (`submitted_reports()` everywhere), `seed/dataset.py` /
`loader.py` (call the operative-day builder, checklist items for all jobs), `tests/expected.py`.
Tests new `test_operative_jobs_api.py`, `test_operative_scope.py`, `test_drafts_invisible.py`,
`test_operative_seed.py`; edit `test_migrations.py`, seed/dataset tests.

Shared: `src/operative/status.ts`, `src/hooks/useOperative.ts`, `src/api/queryKeys.ts`.

Mobile: `app/(app)/index.tsx`, `app/(app)/jobs/[jobId]/index.tsx`, `src/features/jobs/*`,
`src/features/job/*`, query persister setup.

### Package C (T-003e, T-003f)

Mobile (T-003e): `src/db/*` (LocalDb Adapter, migrations v1), `src/files/*`, `src/capture/*`,
`app/(app)/jobs/[jobId]/camera.tsx`, `photos/[photoId].tsx`, photo groups in the job screen.

Backend (T-003f): new `app/services/drafts.py`; edit `routers/operative.py`,
`schemas/operative.py`, `services/report_edit.py` (manager `done=true` clears `cannot_do`).
Tests new `test_operative_draft_api.py`; edit `test_report_edit_api.py`.

Shared (T-003f): `src/operative/validation.ts` and tests.

Mobile (T-003f): `src/sync/*` (engine, classifier, retry, monitors), `src/api/session*`,
`app/(app)/jobs/[jobId]/items/[itemId].tsx`, checklist UI, header status line.

### Package D (T-003g, T-003h, T-003k)

Backend: new `migrations/versions/0011_photo_evidence.py`, `0012_report_submission.py`;
`app/photos/object_store.py` (S3ObjectStore), `app/photos/validate.py`,
`app/photos/metadata.py`, `app/services/photo_upload.py`, `app/services/submission.py`; edit
`photos/store.py` (presigned branch), `deps.py`, `config.py` (photo store settings, guards),
`models/work.py`, `models/enums.py`, `routers/operative.py`, `schemas/operative.py`,
`schemas/manager.py`, `services/reports.py` (evidence fields), `services/audit.py`,
`pyproject.toml` (boto3, pillow; dev moto[s3,server]), `.env.example`. Local:
`docker-compose.yml` (`photos` SeaweedFS + `photos-init`), `scripts/dev.sh` (moto server),
`Makefile` if needed. Tests new `test_photo_register_api.py`, `test_photo_upload_api.py`,
`test_photo_metadata_strip.py`, `test_submit_api.py`, `test_submit_concurrency.py`,
`test_manager_evidence_api.py`; fixtures `tests/fixtures/photos/*` (tiny JPEG/PNG with and
without EXIF GPS).

Web: `web/src/components/PhotoGallery.tsx` (evidence lines), `web/src/pages/ReportDetail.tsx`
and `pages/report/*` (submitted by, pending photos, cannot-do, item photos, other photos and
notes), `web/nginx/40-jobproof-config.sh` (`PHOTO_ORIGIN` in `img-src`), `csp-parity.test.ts`,
`config-script.test.ts`, `web/src/styles/app.css` (append `/* evidence */`), e2e
`evidence.spec.ts`. Shared: `src/operative/evidence.ts`, `submitRules.ts` +
`submitCases.json`, `src/history.ts` (two sentences).

Infra (infra engineer, with T-003g): `infra/terraform/modules/web_static/csp.txt` becomes a
template with the photos origin; `photos_bucket` grants to the app task role; ECS env vars;
WAF exclusion (design R9) and rate rule on `POST /api/v1/auth/sessions`.

Mobile: `src/sync/*` (photos and submit), `src/capture/uploadCopy.ts`,
`app/(app)/jobs/[jobId]/submit.tsx`, `app/(app)/sync.tsx`, location capture (T-003k).

### Package E (T-003i, T-003j, T-003n, T-003l, T-003m)

Mobile only except: T-003j backend tests (`test_idempotency_matrix.py`) and T-003n backend
(`app/versioning.py` 426 dependency on operative and session routers, `MOBILE_MIN_VERSION_ANDROID`).
Mobile: `mobile/test/integration/*`, `mobile/test/support/faultProxy.ts`,
`src/sync/background.ts`, `app/(app)/settings/*`, `src/privacy/notice.ts`,
`modules/volume-shutter/`, accessibility props across `src/ui` and features.

### Package F (T-003o, T-003p)

T-003o: `migrations/versions/0013_sign_off.py`, schemas, drafts/submission services, web report
panel, mobile `sign-off.tsx`. T-003p: `mobile/eas.json`, store listing text in
`mobile/store/`, `docs` runbook section in `mobile/README.md`, manual test records in
`reports/`.
