# JobProof architecture

Owner: architect. This is the system's memory: read it first, edit sections in place, link to
files instead of copying code. Entries marked **(planned)** are specified but not yet built;
everything else describes the code as it stands.
Last updated: 2026-11-22 (Phase 1 built; Phase 2a T-002a to T-002l, T-002n, T-002o and T-002p
built; only the optional T-002m is unbuilt: decisions in section 16, build plan in
[specs/T-002-work-packages.md](specs/T-002-work-packages.md)). AWS: INFRA-1 to INFRA-5 written
(INFRA-1 to 3 passed round 2 review; INFRA-4/5 round 1 CHANGES REQUESTED, fixes in the code, no
round 2 yet; nothing deployed to AWS), INFRA-6 to INFRA-8 **(planned)**:
[specs/INFRA-aws-pipeline.md](specs/INFRA-aws-pipeline.md), section 10.
Phase 2b, the Operative app: **T-003a to T-003f built** (checked against the code 2026-11-22;
Package C round 1 review CHANGES REQUESTED, fixes in progress), T-003g to T-003p **(planned)**:
[specs/T-003-design.md](specs/T-003-design.md), section 15. GitHub Pages demo built (section 11.1).
Phase 3, T-004 company hierarchy and tiered invoicing: ticketed, **not started, not designed**
(section 17).

## 1. System overview

Painters finish a job, photograph it and submit a completion report (mobile, Phase 2). Head-office
managers review reports and billing in a web app (Phase 1, built). Customers pay quotes/invoices
by a secure Stripe link (later). One FastAPI backend serves all clients through one versioned REST
API described by [api/openapi.yaml](api/openapi.yaml).

```
 Manager browser ──> Web SPA (S3+CloudFront | nginx locally) ──┐
 Operative phone ──> Expo app (T-003, partly built) ───────────┤ HTTPS JSON, Bearer JWT
 Customer        ──> payment link page (later) ────────────────┤
                                                               v
                                   FastAPI backend (ECS Fargate | container | uvicorn)
                                      │                 │
                                 PostgreSQL 16     Photo store: generated SVG for seeded photos;
                                 (RDS | container)   uploads (planned, T-003g) in private S3 |
                                                     SeaweedFS (compose) | moto (dev.sh, tests)
```

Phase 1 (built): manager persona, read-only, deterministic mock data, runs offline.
Phase 2a (built except the optional T-002m): Admin persona and company settings (name, colour
scheme, "UK customers only" switch, T-002p) with a public branding endpoint; managers mark reports
reviewed and edit notes/checklist with optimistic concurrency and an append-only audit trail;
dashboard review queue; neutral wording. Package 4: managers correct customer contact details
(T-002n) and can re-apply their edits on top of a newer version after a conflict (T-002o).
Still web only and mock data. One deployment per company (D1).
Phase 2b (T-003): Android app for operatives (Expo SDK 58). Built (T-003a to f): app shell and
build, device sessions and sign-out, today's jobs, job detail and checklist, offline photo
capture into app-private storage, checklist progress and notes saved locally and synced as a
draft. **(planned)** photo upload (g), submit (h), offline queue and background sync (i),
idempotent resubmission (j), evidence integrity and the manager display (k), then l to p.
Phase 3 (T-004, not started): company tree, split jobs, progress roll-up, tiered invoicing.

## 2. Components and responsibilities

| Path | Responsibility (as built) |
|---|---|
| `backend/app/` | FastAPI app factory `main.py`; settings `config.py`; clock `clock.py`; DB session `db.py`; dependencies (auth, roles, photo store) `deps.py`; problem+json `errors.py`; JSON logs `logging.py`; request id and access log `middleware.py`; argon2/JWT `security.py` |
| `backend/app/models/` | SQLAlchemy models: `people.py` (users, customers), `work.py` (jobs, job checklist items, quotes, job_reports, report checklist items, photos), `billing.py` (invoices, payments), `sessions.py` (auth_sessions), `enums.py` |
| `backend/app/routers/` | `health.py`, `auth.py`, `manager.py`, `photos.py`; T-003: `sessions.py` (device sessions), `app_status.py` (`GET /app/status`), `operative.py` (jobs list, job, draft PATCH). Schemas in `backend/app/schemas/` (`sessions.py`, `operative.py` for T-003) |
| `backend/app/services/` | Query logic per screen (`dashboard.py`, `reports.py`, `invoices.py`, `painters.py`, `photos.py`, `auth.py`); `billing.py` pure status/balance functions and `billing_sql.py` their SQL twins for filtering (agreement tested over the seed). T-003: `sessions.py` (create, rotate, revoke), `operative_jobs.py` (`get_own_job`, lists, `build_job`), `drafts.py` (`lock_own_job`, `ensure_draft`, draft save) |
| `backend/app/versioning.py`, `backend/app/seed/operative_day.py` | SemVer parsing for `X-App-Version` / `MOBILE_MIN_VERSION_ANDROID`; the operatives' "today" in the seed. CLI `deactivate-user` in `cli.py` |
| `backend/app/photos/` | `store.py` PhotoStore Strategy and SVG renderer; `signing.py` HMAC-SHA256 signed URLs |
| `backend/app/seed/` | Deterministic dataset (`catalogue.py`, `dataset.py`), loader (`loader.py`), entry point `python -m app.seed` |
| `backend/migrations/` | Alembic; linear chain `versions/0001_initial_schema.py` to `versions/0010_operative_work_model.py` (section 4) |
| `backend/tests/` | pytest: API (each response validated against the contract by `contract.py`), route parity, constraints, migrations round trip, seed, billing, security, config |
| `web/src/` | React SPA: `app/` (router, guards, shell, query client, error boundary, `useQueryParams`), `auth/` (session token store, `safeRedirect`), `pages/` (Login, Dashboard, Reports, ReportDetail, Billing, NotAuthorised, NotFound), `components/` (UI, QueryBoundary, PhotoGallery, `useThrottledRefetch`), `styles/app.css`, `config.ts` (reads runtime `config.js`) |
| `web/nginx/` | `default.conf` and `40-jobproof-config.sh` (writes `config.js` and the security-header include, incl. CSP, from `API_BASE_URL`) |
| `web/scripts/` | `check-dist.mjs` / `dist-origins.mjs`: build fails on any external URL not in the exact allowlist, and (without `--pages`) on any mock-API code; `pages-postbuild.mjs` for the Pages build |
| `web/src/mock/` | Pages demo only: in-browser mock API (`handler.ts`, `backend.ts`), `mockData.json` (exported from the seed by `scripts/export-mock-data.py`), demo banner. Loaded only under `vite build --mode pages` (section 11.1) |
| `shared/src/` | `@jobproof/shared`: `generated/` (hey-api output, committed), `api/` (client Adapter with optional single-flight `refresh` and `abort.ts` fallback, `ApiError`, query keys, `TokenStore`), `auth/hooks.ts`, `hooks/` (health, manager, `useAppStatus`, `useOperative` read hooks), `operative/` (`status.ts`, `validation.ts` twin of the draft rules, `semver.ts` with `semverCases.json` shared with pytest), `filters.ts`, `format/` (money, dates, labels, address) |
| `e2e/` | Playwright: auth, dashboard, reports, report detail, billing, states, layout, CSP, screenshots; helpers in `tests/support.ts` |
| `api/openapi.yaml` | The contract. Hand-written OpenAPI 3.1, v0.6.0: 28 operations built; 4 staged (T-003g photo register, delete, content; T-003h submit). `PENDING_TICKETS` in `backend/tests/contract.py` = T-003g, h, k, o (k and o mark properties only); each ticket removes its id. `x-ticket` markers remain as provenance. Backend conforms; the client was regenerated by T-003a |
| `mobile/` | Expo app workspace `@jobproof/mobile` (T-003a to f). `app/` Expo Router routes: `_layout.tsx`, `sign-in.tsx`, `(app)/` (`index` = today's jobs, `settings`, `jobs/[jobId]/` `index`, `camera`, `items/[itemId]`, `photos/[photoId]`). `src/`: `api/` (`sessionManager.ts`, `secureTokenStore.ts`, `userCache.ts`, query client and persister), `db/`, `files/`, `capture/`, `sync/` (table below), `features/` (`shell`, `session`, `jobs`, `job`, `capture`, `checklist`), `theme/`, `ui/`. `config/` and `test/` hold config, dependency and single-React tests. `demo/` is the Pages demo only (section 11.1). `app.config.ts`, `eas.json`, `metro.config.js`. Design layout: [specs/T-003-design.md](specs/T-003-design.md) section 3.1 |
| **(planned, T-003g/h)** backend | `services/photo_upload.py`, `submission.py`; `photos/object_store.py` (S3), `validate.py`, `metadata.py` |
| `backend/app/dbroles.py`, `backend/app/cli.py` | `ensure_roles` (migrator and app roles), `apply_grants`, `migrate` (alembic head, then grants). CLI commands `create-admin`, `create-user --role admin\|manager`, `db-roles`, `migrate` (INFRA-3, section 10) |
| `backend/app/seed/demo.py` | Dev-AWS-only demo seed `python -m app.seed.demo [--reset]` with its guards (section 9) |
| `backend/certs/` | `rds-global-bundle.pem`: **placeholder** until the INFRA-6 entry gate (section 12); `README.md` |
| `infra/bootstrap/` | `bootstrap.cfn.yaml` (CloudFormation, one stack per account: OIDC provider, state bucket, plan and terraform roles; parameter `SubjectMode`) and its README; runbook `infra/README.md` |
| `infra/scripts/` | `upload-web.sh` (asset-first upload order, `config.js`), `smoke-test.sh`, `local-edge.mjs` (local CloudFront test double for the smoke test; never deployed). INFRA-5 helpers: `export-outputs.sh`, `load-config.sh`, `run-task.sh`, `find-task-definition.sh`, `deploy-service.sh`, `push-image.sh`, `promote-image.sh` |
| `infra/terraform/` | INFRA-4 (written, never applied): `modules/` (`account_baseline`, `network`, `rds`, `secrets`, `ecr`, `ecs_service`, `alb`, `web_static` incl. `csp.txt` with parity test `web/nginx/csp-parity.test.ts`, `waf` with `check-scope.sh`, `photos_bucket`, `monitoring`, `ci_roles`), `envs/dev` and `envs/prod`, `check-env-parity.sh`, `README.md`. Decisions: section 10 |
| `.github/` | `workflows/ci.yml` (jobs `backend`, `web`, `mobile` (lint, Jest, expo-doctor, `expo export` then `checkDemoBundle.mjs --normal`), `e2e`, `workflows` = actionlint, `infra` = cfn-lint, `terraform` = fmt, validate, tflint), `workflows/dependency-check.yml` (weekly Monday), `dependabot.yml` (actions, npm, uv, docker, docker-compose), `workflows/pages.yml` (GitHub Pages demo, section 11.1). INFRA-5 (written, never run): `workflows/pipeline.yml`, `deploy-prod.yml`, `rollback.yml`, `create-user.yml`, `dev-demo-data.yml`, `dev-power.yml`; `actions/setup-terraform` and `actions/deploy-release` (composite). Owner: infra engineer |
| `backend/app/branding/` | `defaults.py` (the only backend copy of the default name and theme), `contrast.py` (WCAG ratio) |
| `backend/app/routers/branding.py`, `admin.py`; `services/settings.py`; `models/settings.py`; `cli.py` | Branding (public), Admin router, the one settings accessor, settings model, `create-admin` command. `services/audit.py`, `review.py`, `report_edit.py`; `models/audit.py`: audit store, review and edit writes |
| `backend/app/schemas/text.py`, `schemas/customer_write.py`; `services/customers.py` | Free-text rule shared by company name and customer fields; customer validators and `CustomerUpdate`; customer read (with impact), diff, `validate_contact_fields` (phone/postcode by the UK-only setting) and `update_customer` (T-002n, T-002p) |
| `shared/src/branding/` | `defaults.ts` (only web/mobile copy of the default theme), `presets.ts`, `contrast.ts`, `companyName.ts`; hooks `useBranding`, `useAdmin`. `useReportWrites`; `history.ts`, `conflict.ts`, `reportEdit.ts` |
| `shared/src/customer/`, `shared/src/text/forbidden.ts`, `shared/src/merge.ts`, `shared/src/hooks/useCustomer.ts` | Customer validator twin and case table `validationCases.json`, `customerEdit.ts` (`buildCustomerUpdate`, `impactSentence`, `customerMergeAdapterFor(ukOnly)`); forbidden set twin; three-way merge `mergeOnTop`/`resolve` (T-002o; report adapter in `reportEdit.ts`); customer hooks |
| `web/src/theme/` | `applyTheme.ts` (CSSOM `setProperty` only), `brandingCache.ts` (localStorage snapshot), `BrandingProvider.tsx`; `pages/Settings.tsx`, `pages/settings/*`. `pages/report/*`, `pages/dashboard/ReviewQueue.tsx`, `pages/Customer.tsx`, `pages/customer/*` |
| `scripts/dev.sh` | No-Docker path: `up [--static] \| down \| status \| seed \| test \| e2e \| psql` |
| `docker-compose.yml`, `Makefile`, `.env.example` | Docker stack and developer commands (see section 11 for what is unverified) |

Web routes: `/login`, `/not-authorised`, and under the manager guard `/`, `/reports`,
`/reports/:reportId`, `/customers/:customerId`, `/billing`; `*` is NotFound. The guard is
`RequireRole role="manager"`, plus `/settings` under `RequireRole role="admin"`; after sign-in
each role lands on its home (`web/src/app/roles.ts`).

## 3. Stack versions (verified 2026-11-07 against PyPI / npm; installed versions match)

Exact versions are locked in `backend/uv.lock` and the root `package-lock.json`. Root
`overrides` (section 13.1): js-yaml, minimatch, glob (security) and react/react-dom 19.3.0 (one
React copy). Mobile rows were checked against `mobile/package.json` and the lockfile on
2026-11-22.

| Area | Package | Version | Notes |
|---|---|---|---|
| Runtime | Python | 3.13 | `python:3.13-slim` image; local 3.13.18 |
| Runtime | Node | 22 LTS (>=22.22) | `node:22-alpine` build image; react-router 8 needs >=22.22 |
| Tooling | uv | 0.11.32 | image copies `ghcr.io/astral-sh/uv:0.11.32` |
| Backend | fastapi / uvicorn | 0.162.1 / 0.54.0 | plain `uvicorn` |
| Backend | sqlalchemy / alembic | 2.1.8 / 1.20.1 | sync engine, 2.0-style ORM |
| Backend | pydantic / pydantic-settings | 2.14.3 / 2.16.2 | |
| Backend | psycopg[binary] | 3.3.8 | URL `postgresql+psycopg://` |
| Backend | pyjwt / argon2-cffi | 2.15.1 / 25.1.0 | HS256; argon2id |
| Backend | tzdata | 2026.6 | Europe/London in slim images |
| Backend dev | pytest 9.2.0, httpx 0.28.1, ruff 0.17.4, mypy 2.4.1, jsonschema 4.26.0, pyyaml 6.0.3 | | |
| Web, mobile | react / react-dom | 19.3.0 (exact, root `overrides`) | Pinned repo-wide by T-003a (design R4): RN 0.88.1's renderer embeds and enforces exactly 19.3.0; the React changelog has no 19.3.1 entry, so the web lost nothing. `mobile/test/singleReact.test.ts` fails on a second copy. Revisit when an Expo SDK bundles 19.3.1 or later |
| Web | react-router | 8.5.1 | data mode: `createBrowserRouter` from `react-router`, `RouterProvider` from `react-router/dom` |
| Web | @tanstack/react-query | 5.107.1 | used in shared hooks |
| Web | vite / @vitejs/plugin-react | 8.3.6 / 6.2.1 | |
| Web | typescript | 6.0.3 | TS 7 deferred, section 13.2 |
| Web dev | vitest 5.1.0, jsdom 31.0.0, @testing-library/react 16.3.3, user-event 14.6.8 | | |
| Web dev | eslint 10.14.0, typescript-eslint 8.72.1, eslint-plugin-react-hooks 7.1.1 | | |
| Contract | @hey-api/openapi-ts | 0.99.0 (exact) | 0.x churns: pin exactly |
| Contract | @redocly/cli | 2.76.0 | config [api/redocly.yaml](api/redocly.yaml) |
| E2E | @playwright/test | 1.65.0 | uses installed Chrome via `PLAYWRIGHT_CHROMIUM_EXECUTABLE` |
| E2E | @axe-core/playwright | 4.14.0 | colour-contrast checks (T-002d, built); verified on npm 2026-11-07; e2e only, never in the bundle |
| DB | PostgreSQL | 16 | `postgres:16-alpine`; RDS 16.x (16.15 latest, standard support to 2029-02-28; 18 deferred, section 13.2) |
| Web serve | nginx | `nginxinc/nginx-unprivileged:stable-alpine` | **tag not verified** (Docker Hub blocked); backlog B6 |
| IaC | Terraform / AWS provider | 1.17.1 / 6.72.0 (`~> 6.72`) | verified 2026-11-08; written in INFRA-4, never applied. No `.terraform.lock.hcl` committed yet (review-infra-45 minor: commit from the first CI run, before INFRA-6) |
| IaC | CloudFormation bootstrap; cfn-lint | 1.60.0 | clean in review 2026-11-09 |
| Mobile | expo / react-native | 58.0.23 (`~58.0.23`) / 0.88.1 (exact) | SDK 58; minSdk 29 (ours), compileSdk 37 / targetSdk 36 (`mobile/app.config.ts`) |
| Mobile | expo-router 58.0.30, expo-sqlite 58.0.15, expo-secure-store 58.0.2, expo-camera 58.0.14, expo-image-picker 58.0.10, expo-image-manipulator 58.0.16, expo-file-system 58.0.13, expo-constants, expo-linking, expo-splash-screen, expo-status-bar, expo-build-properties (`~58.0.x`); react-native-screens ~4.30.1, react-native-safe-area-context ~5.11.1; @tanstack/react-query-persist-client 5.107.1 | installed versions | expo-file-system 58.0.14 is out: bump in the next mobile ticket. Not yet added: `expo-background-task`, `expo-network` (T-003i). `expo-media-library` is banned (section 6) |
| Mobile dev | jest 30, jest-expo 58.0.14, @react-native/jest-preset ~0.88.1, @testing-library/react-native 14.1.0, `test-renderer` 1.3.0 (exact), expo-doctor 1.21.6, typescript ~6.0.3; Maestro CLI 2.x outside the workspace | | `test-renderer` (the renderer RNTL 14 uses, not `react-test-renderer`) stays at 1.3.0 while jest-expo 58.0.14 pins it exactly; 1.3.1 would install a second copy. Move when jest-expo moves. `eas.json` `cli.version` ">= 18.0.0" (eas-cli version not verified) |
| Pages demo (build only, mobile devDependencies) | react-native-web 0.21.4, @expo/metro-runtime 58.0.17 (exact) | | **Approved 2026-11-22** for the `expo export --platform web` demo build only; never in `dependencies` (tested by `mobile/demo/isolation.test.ts`), never in the Android bundle (section 11.1) |
| Backend **(planned, T-003g)** | boto3 1.43.126, pillow 13.0.0; dev moto[s3,server] 5.2.5 | | python-multipart deliberately not used (raw-body upload) |
| Local S3 **(planned, T-003g)** | SeaweedFS `chrislusf/seaweedfs` (compose), moto server (dev.sh) | **tag not verified** | MinIO community images discontinued Oct 2025, LocalStack needs an account since Mar 2026 |
| CI (in use) | `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `astral-sh/setup-uv` v10.3.3 (no major tags), `actions/upload-artifact` v7.0.2; actionlint v1.7.12; Pages (`pages.yml`): `actions/configure-pages` v6.0.0, `actions/upload-pages-artifact` v5.0.0, `actions/deploy-pages` v5.0.1 (SHAs not re-checked against tags here) | | each pinned by full commit SHA with the tag in a comment (SHAs matched their tags in review 2026-11-09); Dependabot bumps them. Source of truth: `.github/workflows/*.yml` |
| CI (INFRA-5, written 2026-11-09, never run) | `aws-actions/configure-aws-credentials` v6.3.0, `actions/download-artifact` v8.0.2 (SHAs checked with `git ls-remote` 2026-11-09); Terraform 1.17.1 downloaded and checksum-verified by `.github/actions/setup-terraform`; tflint v0.66.0 via `go install` | | no `setup-terraform`, `build-push-action` or `amazon-ecr-login` action is used (plain CLI steps). See spec INFRA "Versions" and section 4.7 |

## 4. Data model summary

Full columns: [specs/T-001-manager-view.md](specs/T-001-manager-view.md) section "Data".
All PKs are UUID. Money is integer pence plus `currency` CHAR(3) = 'GBP'. Timestamps are
`timestamptz` (UTC); calendar dates are `date`. Enums are Postgres native enums. Check
constraints encode state consistency (e.g. completed jobs have `completed_on`, draft invoices
have no issue/due date, a payment is a deposit against a quote xor a payment against an invoice).

| Table | Purpose | Status |
|---|---|---|
| `users` | Login accounts; `role` manager or painter | built, migration 0001 |
| `customers` | Homeowners, landlords, businesses; no login | built, migration 0001 |
| `jobs` | Work at a site address for a customer, assigned painter | built, migration 0001 |
| `quotes` | Price and optional deposit for a job | built, migration 0001 |
| `job_reports` | Painter's completion report, one per job, manager review status | built, migration 0001 |
| `report_checklist_items` | Work checklist lines on a report | built, migration 0001 |
| `report_photos` | Before/during/after metadata; `storage_key` null = generated placeholder | built, migration 0001 |
| `invoices` | Bill for a job; stored state draft/sent/paid/void, display status derived | built, migration 0001 |
| `payments` | Deposit (against quote) or invoice payment | built, migration 0001 |
| `company_settings` | The one settings row (`id = 1`): company name, five theme colours, `updated_at/by` (id + name snapshot, no FK) | built, 0002 (T-002a) |
| `users.role` | enum gains `admin` | built, 0003 (T-002b) |
| `job_reports` | + `version` (>= 1), `last_changed_at`, `last_changed_by_id` | built, 0004 (T-002g) |
| `audit_events` | Append-only events: actor id + name snapshot, action, report or settings, `changes` jsonb, `seq` order | built, 0005 (T-002f) |
| `job_reports.manager_notes` | Internal manager note | built, 0006 (T-002i) |
| `customers` | + `version` (>= 1), `last_changed_at`, `last_changed_by_id` | built, 0007 (T-002n) |
| `audit_events` | + `customer_id` (FK, set iff `entity_type = 'customer'`), index `(customer_id, seq DESC)`; enums gain `customer.edited`, `customer` | built, 0007 (T-002n) |
| `company_settings.uk_only_contact_details` | boolean not null, default true: phone/postcode must be UK ones | built, 0008 (T-002p) |
| `auth_sessions` | Device sessions: user, device id/name, platform, app version, `refresh_hash` and `previous_refresh_hash` (SHA-256, CHAR(64)), `rotated_at`, `generation`, idle/absolute expiry, `revoked_at`/`revoked_reason`; partial unique `(user_id, device_id)` where not revoked | built, 0009 (T-003b) |
| `job_checklist_items`; `job_reports.state` (draft/submitted), `submitted_by_id`, nullable `submitted_at`/`review_status`; `report_checklist_items.cannot_do` | The job's planned checklist (report items share its ids, FK); draft reports. Checks: submitted fields set iff `state = 'submitted'`; a draft is never reviewed; not `done AND cannot_do` | built, 0010 (T-003c; written to by T-003f) |
| `report_photos` evidence columns | source, taken/received times, clock offset, optional location, fingerprints, item link, storage keys | planned, 0011 (T-003g) |
| `job_reports` submission fields; audit `report.submitted`, `report.photo_received` | idempotent submit | planned, 0012 (T-003h) |
| `job_reports` sign-off columns | customer sign-off | planned, 0013 (T-003o, optional) |
| `job_types` | Job types as data (code, label); `jobs.job_type` becomes text FK; enum dropped | planned, next free number (0014 after T-003) (T-002m, optional) |
| `invoice_line_items` | Itemised invoice lines | later |
| `payment_links` | Customer Stripe checkout links (capability token) | later |

Migrations: `backend/migrations/versions/`, head `0010`; the chain is tested up, down, up and
against the models (`backend/tests/test_migrations.py`).

**Convention (from 0010):** a migration that takes ACCESS EXCLUSIVE locks on busy tables starts
with `SET LOCAL lock_timeout = '5s'` (fail fast rather than queue behind a long query and block
every request) and states its expected run time in the docstring or a comment.

**Migration chain (0002 to 0010 built, 0011 onwards planned), one linear chain, one revision per
ticket, so no Alembic branches arise:**

| Rev | Ticket | Change | Risk and downgrade |
|---|---|---|---|
| 0002 | T-002a | create `company_settings`, insert default row (`DEFAULT_COMPANY_NAME` env, else "Arbour Services"; hex codes frozen in the file) | none; drop table |
| 0003 | T-002b | `ALTER TYPE user_role ADD VALUE 'admin'` | downgrade refuses if admins exist, else recreates the enum |
| 0004 | T-002g | report `version` default 1, `last_changed_*` | additive; drop columns |
| 0005 | T-002f | `audit_events`, enums, append-only triggers | downgrade drops the history: only ever run on non-production data |
| 0006 | T-002i | `manager_notes` | additive |
| 0007 | T-002n | customers `version` default 1 + `last_changed_*` (as 0004); audit enum values added in an autocommit block (a value cannot be used in the transaction that adds it); `audit_events.customer_id` + check + index | additive; `ADD COLUMN`/`ADD CONSTRAINT` do not fire the append-only row triggers; downgrade refuses if any `customer.edited` event exists |
| 0008 | T-002p | `company_settings.uk_only_contact_details boolean not null default true` (existing row becomes true; customers untouched) | additive; drop column |
| 0009 | T-003b | create `auth_sessions`; app role gets DML without TRUNCATE; the seed truncates it | additive; downgrade drops the table (ends every device session) |
| 0010 | T-003c | create and backfill `job_checklist_items` (same ids as existing report items), FK from report items, `cannot_do`, `report_state` enum, existing reports become `submitted`, `submitted_by_id = painter_id`, checks above. `lock_timeout` 5 s; expected well under a second on pilot data | the risky one: nullable report columns, so every manager query filters `state = 'submitted'` (tested). **Downgrade is lossy and guarded:** it refuses while any draft report, any `cannot_do` item, or any job checklist item with no matching report item or with `removed_at` set exists (refusal tested); otherwise it still drops `submitted_by_id` and the job items' own timestamps. Never run on production data |
| 0011 to 0013 | T-003g, h, o **(planned)** | see the table above; details in [specs/T-003-design.md](specs/T-003-design.md) section 7 | 0011 refuses uploaded photos; 0012 refuses its audit events |
| next free (0014) | T-002m **(planned, optional)** | `job_types` table, `jobs.job_type` enum to text FK (renumbered again 2026-11-09: T-003 takes 0009 to 0013) | type change on `jobs`; downgrade refuses non-painting codes |

The seed never touches `company_settings` (excluded from its truncate; no FK into it, so CASCADE
cannot reach it) and sets `jobproof.allow_audit_truncate` for its own transaction only.

Derived invoice status: pure function in `backend/app/services/billing.py`, SQL twin in
`billing_sql.py`: `void` > `draft` > `paid` (balance 0) > `overdue` (due date before today,
Europe/London) > `part_paid` > `sent`.

Known gap: `invoices.customer_id` and `invoices.job_id` are separate FKs; that the invoice's
customer equals the job's customer is guaranteed only by the seed and application (backlog B2).

## 5. API conventions

- Base path `/api/v1`; health at `/health` (unversioned; 200, or 503 when the DB is unreachable)
  and `/health/live` (unversioned liveness for the ALB: 200 `{"status":"ok"}`, no DB check).
- JSON, snake_case fields. UUIDs as strings. Datetimes ISO 8601 UTC with `Z`. Dates `YYYY-MM-DD`.
- Money: `*_pence` integers plus `currency: "GBP"`.
- Auth: `Authorization: Bearer <jwt>`. Photo images use short-lived signed URLs (no header).
- Errors: RFC 9457 `application/problem+json` with `code` and `request_id`; validation (422)
  adds `errors[]`. Codes are stable strings (`invalid_credentials`, `unauthenticated`,
  `forbidden`, `not_found`...). HTTP 405 maps to `not_found` (the contract has no 405 code).
- Strings that reach Postgres reject NUL (`\x00`) with 422: login fields and the `q` search.
- Pagination: `page` (1-based, **no upper bound yet**, backlog B1), `page_size` (default 20, max
  100); response `{items, total, page, page_size}`. Offset based.
- Filters: one query param per field; `q` is a case-insensitive contains search (1 to 100
  chars); `date_from`/`date_to` inclusive London calendar days. Fixed server-side sort.
- Every response carries `X-Request-ID` (echoed if the client sent one).
- **Writes (T-002):** partial updates are `PATCH` with `extra="forbid"` (unknown or
  read-only keys are 422 naming the key); actions are `POST .../{verb}` (`/review`). Report
  writes carry `version` (optimistic concurrency): mismatch is 409 `version_conflict` with
  problem extensions `current_version`, `last_changed_at`, `last_changed_by`, review fields and,
  for PATCH, `current` values of the attempted fields. A no-op write returns 200 unchanged and
  records nothing. A write and its audit events commit in one transaction under a row lock.
  New codes: `contrast_too_low` (422, `errors[]` with `measured_ratio`/`required_ratio`),
  `version_conflict`, `already_reviewed` (409). `ProblemError` carries `errors` and `extensions`.
- **Customer writes (T-002n)** follow the same rules: `PATCH /manager/customers/{id}`
  with `customers.version`, row lock, 409 `version_conflict` with `current_version`,
  `last_changed_*` and `current` (no review fields). Customer and report versions are
  independent: a customer edit never bumps a report version or reopens a report (D9).
- **Free-text rule for single-line fields (T-002n):** trim only U+0020, then in this order
  (first failure wins): blank (required: the field's "Enter ..." message; optional: null),
  length in code points, then the company-name forbidden set (controls, zero-width/bidi, BOM,
  lone surrogates: "Remove control characters."), then any field format. Same order as the
  company name. One forbidden set per side: `backend/app/schemas/text.py` (`clean_text`) and
  `shared/src/text/forbidden.ts` (`cleanText` in `shared/src/customer/validation.ts`); customer
  validators share one case table (`shared/src/customer/validationCases.json`) read by pytest
  and Vitest. Multi-line notes keep the T-002i rule (only NUL and lone surrogates rejected).
- **Two-stage customer validation (T-002p):** phone and postcode depend on the company setting
  `uk_only_contact_details`, which a Pydantic field validator cannot see. Stage 1: Pydantic body
  validation of every other field (422). Stage 2: `services/customers.validate_contact_fields`
  reads the setting and validates phone and postcode (same 422 shape and `loc`), before the
  customer lookup, so 422 still precedes 404 and 409. A body with a stage-1 error therefore
  reports phone/postcode problems only on the next attempt. Clients read the setting from
  `GET /branding` and pass `ukOnly` to the shared twins (missing = true).
- **Contract staging (T-002a):** `x-ticket: T-002x` marks contract items not yet built;
  `backend/tests/contract.py` `PENDING_TICKETS` hides them from parity and schema checks until
  the ticket lands (currently T-003g, h, k, o, section 2). Mark only
  operations, parameters and properties, never component schemas (a hidden schema referenced
  from a visible node breaks `$ref`). Enum value additions cannot be hidden and need not be: a
  response never contains them before the ticket is built. The generated client is regenerated
  once per package, by its first ticket.
- **Operative API (T-003; design section 6).** Built: `GET /operative/jobs`, `GET
  /operative/jobs/{id}`, `PATCH /operative/jobs/{id}/report` (draft save, T-003f). Role
  `painter` only (role read from the database), own jobs only: every query starts from
  `jobs.painter_id = user` and another operative's or an unknown job is 404, never 403.
  Operative schemas never carry `manager_notes`, money, customer email or billing. Manager
  endpoints only ever see `state = 'submitted'` reports (tested).
  - The list returns `today`, `jobs_today` and `earlier_unfinished`; the earlier list is
    **bounded: at most 30 days back and 50 rows, oldest first** (`EARLIER_DAYS`/`EARLIER_LIMIT`
    in `services/operative_jobs.py`), filtered in SQL.
  - **A draft belongs to the operative who started it** (`job_reports.painter_id`). If the job
    is later assigned to someone else, the new assignee gets **409 `draft_owned_by_other`** on
    GET and PATCH of that job, and the job is left out of both lists, until the office resolves
    it (backlog B15); the original author gets 404 once the job is not theirs.
  - Draft PATCH: the job row is locked (`lock_own_job`, `FOR UPDATE` filtered on the owner); check
    order 422 body, 404, 409 `draft_owned_by_other`, `job_cancelled`/`job_closed`,
    `report_submitted`, then 422 for unknown item ids. `ensure_draft` creates the report once
    (moving the job to in progress); no audit event, `version` unchanged. Limits shared with
    `shared/src/operative/validation.ts`: notes 500 and 2,000 code points, at most 200 checklist
    entries, NUL and lone surrogates refused, blank becomes null.
  - **(planned, T-003g/h)** photos use client-generated UUIDs (PUT metadata, then PUT raw file);
    submit carries a client `submission_id`. Device times (`device_sent_at`) are recorded beside
    server times; the app sends `X-App-Version`, below the minimum → 426 (T-003n).
- Contract parity: backend tests validate every response against the schema and check that
  routes and operations match (`test_route_parity.py`); `npm run gen:check` fails on stale
  generated client. Workflow: [specs/T-000-bootstrap.md](specs/T-000-bootstrap.md) section 5.

## 6. Patterns in use

| Pattern | Where | Why / status |
|---|---|---|
| Strategy | `backend/app/photos/store.py`: `PhotoStore` Protocol (`url_for`, `render`), `PlaceholderPhotoStore`; chosen in `backend/app/deps.py` `get_photo_store` | Implemented as described. Only the placeholder exists; `S3PhotoStore` (later) plugs in at `get_photo_store` |
| Strategy | `shared/src/api/tokenStore.ts`: `TokenStore` interface (sync or async `get/set/clear`); web implementation `web/src/auth/sessionTokenStore.ts` (sessionStorage) | Same auth hooks, platform-specific persistence. Async signatures already allow SecureStore |
| Adapter | `shared/src/api/client.ts` `configureApiClient` / `callApi` over the generated client | Runtime base URL, bearer header, 15 s timeout with abort, Problem errors to `ApiError`, 401 handler. No DOM access |
| (none) | Authorisation: `require_roles(...)` in `backend/app/deps.py` | Role-only rules. Operative ownership is one rule (`jobs.painter_id = user`) in `_own_jobs`/`get_own_job` (`services/operative_jobs.py`) and `lock_own_job` (`services/drafts.py`), plus the draft-owner check (409 `draft_owned_by_other`); a Policy class is still not warranted |
| Strategy + Adapter **(planned, T-003g)** | `PhotoStore` picks placeholder (seeded) or presigned GET (uploaded) per photo; `ObjectStore` protocol with `S3ObjectStore` (boto3; moto, SeaweedFS locally) | One code path for AWS and local; tests substitute the network boundary |
| Adapter | `mobile/src/db/localDb.ts` `LocalDb` / `SqlDb`: `ExpoSqliteDb` (expo-sqlite) in the app, `NodeSqliteDb` (`node:sqlite`, `mobile/test/support/nodeSqliteDb.ts`) in Jest; `mobile/src/files/photoFiles.ts` `PhotoFiles` with `ExpoPhotoFiles`; `mobile/src/capture/imageTools.ts` and `gallery.ts` (`ImageTools`, `GalleryPicker`) with Expo implementations | The repositories, capture service and sync engine run the same SQL and file logic in Node without a device; kill-and-reopen tests reopen the same file |
| (none) | Mobile sync (`mobile/src/sync/`): state-based reconciliation with `rev`/`synced_rev` dirty flags; `engine.ts` single flight with a re-run flag, `classify.ts` (server answer to retry / needs-attention / paused verdict), `retry.ts` backoff; Observer status via `useSyncExternalStore` (`SyncProvider.tsx`, `SyncStatusLine.tsx`). Photo transition table joins in T-003g | Chosen over an operation log: edits coalesce, repeats are idempotent, no ordering bugs |
| (none) | Single-flight refresh in the shared Adapter (`callApi` `refresh` option, `{ refresh: false }` for session operations) plus the mobile `SessionManager` lock (section 8) | Mobile only passes it; web unchanged |
| (none) | Invoice status: pure functions plus SQL twins | No transitions in Phase 1, so no State |
| (none) | Settings accessor `services/settings.py`; single-row table with `CHECK (id = 1)` | D1: name and theme read in one place; no in-process cache (multiple ECS tasks) |
| (none) | Concurrency: `SELECT ... FOR UPDATE` + version compare in `services/review.py`, `report_edit.py`, `customers.py` | Needs old values for audit and 409 bodies; simpler than conditional UPDATE |
| (none) | Audit: explicit `record_event` calls in each write service, same transaction; DB triggers make the table append-only | Explicit beats ORM listeners for "who/what/old/new"; failed writes leave no trace automatically |
| (none) | Theming: `applyTheme` sets CSS custom properties through the CSSOM | CSP-safe (no `<style>`, no inline style attributes); see section 9 |
| Data record | **(planned, T-002m)** `SeedProfile` registry in `backend/app/seed/profiles/` | Profiles differ in content only, not behaviour |
| (none) | Three-way merge `mergeOnTop(adapter, base, mine, theirs)` and `resolve` in `shared/src/merge.ts` (T-002o); adapters `reportMergeAdapter` (`shared/src/reportEdit.ts`) and `customerMergeAdapterFor(ukOnly)` (`shared/src/customer/customerEdit.ts`) | Pure function plus two plain adapter objects; no Strategy hierarchy for two entities |
| (none) | Customer events linked once by `audit_events.customer_id` (T-002n); report history = `report_id = r OR customer_id = report's customer` (`services/audit.py`) | One row per change, no fan-out copies; every report of the customer (also later ones) shows it |
| (none) | Setting-dependent validation: plain functions `validate_phone/validate_postcode(raw, uk_only=)` called from the service (T-002p) | A validation context or dependency was rejected: FastAPI passes no context to body models |
| (none) | Lint bans as architecture rules (root `eslint.config.js`, mobile `app/` and `src/`): `no-restricted-imports` bans `expo-media-library` (photos never reach the phone's gallery, P6; also `mobile/config/dependencies.test.ts`) and deep imports into shared (`@jobproof/shared` entry only); `no-restricted-syntax` bans credential-named identifiers in `console` calls | Cheaper and earlier than review; each ban names its reason in the message |

## 7. Personas and permissions (as implemented)

| Capability | Manager | Admin | Painter | Customer | Anonymous |
|---|---|---|---|---|---|
| `GET /health`, `GET /health/live`, `POST /auth/login` | yes | yes | yes | n/a | yes |
| `GET /branding` | yes | yes | yes | n/a | yes |
| `GET /auth/demo-accounts` | yes when `DEMO_ACCOUNTS_ENABLED`, else 404 | same | same | n/a | same |
| `GET /auth/me` | yes | yes | yes | n/a | 401 |
| `GET /manager/*` (dashboard, painters, reports, reports/{id}, invoices) | yes | 403 | 403 `forbidden` | n/a | 401 `unauthenticated` |
| `POST /manager/reports/{id}/review`, `PATCH /manager/reports/{id}`, `GET .../history` | yes | 403 | 403 | n/a | 401 |
| `GET/PATCH /manager/customers/{id}`, `GET .../history`, `?customer_id=` on reports | yes | 403 | 403 | n/a | 401 |
| `GET/PATCH /admin/settings`, `GET /admin/settings/history` | 403 | yes | 403 | n/a | 401 |
| `GET /photos/{id}/image` | by valid signature only; no bearer token involved | | | | |
| `GET /operative/jobs`, `GET /operative/jobs/{id}`, `PATCH /operative/jobs/{id}/report` (T-003c, d, f) | 403 `forbidden` | 403 `forbidden` | own jobs only (others 404); 409 `draft_owned_by_other` on a draft another operative started | n/a | 401 |
| `POST /auth/sessions` (device sign-in, T-003b) | 403 `operatives_only` (after the password check) | 403 `operatives_only` | yes | n/a | public (password) |
| `POST /auth/sessions/refresh`, `GET /app/status` (T-003a, b) | public (refresh needs a valid refresh token) | | | | |
| `DELETE /auth/sessions/current` (sign-out, T-003b) | 204 (no-op for web tokens) | 204 | yes | n/a | 401 |
| **(planned, T-003g/h)** photo register, content, delete; submit | 403 | 403 | own jobs only | n/a | 401 |
| Customer payment link | | | | token in link (later) | |

401 means no, invalid or expired token, or an inactive/missing user (with `WWW-Authenticate:
Bearer`); 403 means a valid user whose database role is not allowed. Wrong email or password is
a uniform 401 `invalid_credentials`. Demo accounts (one manager, one painter, from
`backend/app/seed/catalogue.py`) are listed on the login page when the endpoint is enabled;
`.env.example` enables it locally and the config refuses it in production.

Web: nothing under the manager guard (`web/src/app/guards.tsx`) mounts until `/auth/me` returns;
a non-manager is sent to `/not-authorised` (the same per role for `/settings`). A 401 on an authenticated call clears the token and
goes to `/login?expired=1&from=...` (a failed sign-in is not treated as a lost session).

## 8. Authentication (Phase 1)

Seeded users with argon2id hashes. `POST /api/v1/auth/login` returns an HS256 JWT (`sub`,
`role`, `iat`, `exp`, `iss=jobproof`, `aud=jobproof-api`), TTL `JWT_TTL_SECONDS` (default 1800),
no refresh token. The backend reloads the user on each request (honours `is_active`, role from
DB). Web stores the token in sessionStorage. The web keeps this unchanged.

**Device sessions for the app (built, T-003b; `backend/app/services/sessions.py`):** `POST
/auth/sessions` (operatives only; same device replaces its old session) returns a 900 s JWT with a
`sid` claim plus an opaque refresh token (`<session_id>.<secret>`, 256-bit secret, only its
SHA-256 stored in `auth_sessions`), rotated on every refresh, 30 days idle / 90 days absolute.
**Reuse rule (as built, accepted in review-t003-pkgB):** refresh first proves possession: only the
current hash or the **immediately previous** hash counts. Any other secret (guessed, mangled, or
two or more generations old) → 401 `session_ended` and **nothing changes**, so a session id alone
(it is in the `sid` claim and in log lines) cannot sign a phone out. The previous token presented
**after** the 60 s grace window (measured from the original rotation, never stretched) revokes the
session (`reuse_detected`); within the window it gets a fresh pair (lost response). Only then is an
inactive account reported (`account_inactive`), then revoked/expired. Bounds:
`REFRESH_REUSE_GRACE_SECONDS` 0 to 300, `DEVICE_ACCESS_TTL_SECONDS` 60 to 3600. Every request with
a `sid` checks the session by primary key (revoked → 401 `session_ended`; inactive user → 401
`account_inactive`), so deactivation (`app.cli deactivate-user`) ends a device at once. Logs carry
the session id and outcome only. Design section 4.

**Phone side (`mobile/src/api/sessionManager.ts`, spec T-003b "Decisions"):** refresh token and
device id in `expo-secure-store`; access token in memory only. **Refresh lock scope:**
`SessionManager.refresh()` returns one shared promise under a lock that also serialises sign-in
and sign-out, and the new refresh token is stored before it resolves. The foreground app and any
future headless task must call the one module singleton (`mobile/src/api/session.ts`); nothing
else calls the refresh operation. The lock is **per JS context**: a background task in a separate
context would not share it, so T-003i must run it in the app's context or accept that the 60 s
grace covers one lost rotation, not two racing contexts. Session operations use `callApi(...,
{ refresh: false })`; `onUnauthorized` runs once per failed refresh. No signal, 429, 5xx or 426
on refresh keeps the session (retry every 30 s); only 401/422 end it. An involuntary end
(`session_ended`, `account_inactive`) wipes credentials and the persisted job cache (customer
phone numbers, addresses, notes) but keeps unsent drafts and photos in app-private storage.

## 9. Security decisions (made in Phase 1 review)

- **APP_ENV** is required, no default, exactly `local`, `test`, `staging` or `production`
  (`backend/app/config.py`). docker compose supplies `${APP_ENV:-local}` so a fresh clone runs.
- **Secret guard** when APP_ENV is not local/test: `JWT_SECRET` and `PHOTO_URL_SECRET` must be
  set explicitly, at least 32 chars, no surrounding whitespace, not a dev default and not
  `dev-only-` prefixed (both case-insensitive), and must differ from each other
  (case-insensitive). `DEMO_ACCOUNTS_ENABLED=true` is refused unless APP_ENV is local or test (the list includes the admin password); production also refuses `FIXED_NOW`.
  CORS origins may not contain `*`. Tests: `backend/tests/test_config.py`.
- **Seed guard**: `python -m app.seed` truncates and reloads, so it refuses unless APP_ENV is
  local or test (`backend/app/seed/__main__.py`) and stays so. The AWS dev environment
  (`APP_ENV=staging`) gets demo data only from the separate `python -m app.seed.demo`
  (`backend/app/seed/demo.py`, INFRA-3), guarded by `APP_ENV=staging`, `DEMO_SEED_ALLOWED=true`
  (dev task definition only) and a secret `DEMO_PASSWORD` (>= 16 chars) that must differ from
  every repository password; load-if-empty by default, `--reset` as the migrator role. Spec INFRA
  section 4.5.
- **Database TLS (INFRA-3):** `backend/app/config.py` accepts `DB_HOST/PORT/NAME/USER/PASSWORD`
  as an alternative to `DATABASE_URL` (password URL-encoded). With `APP_ENV` staging or
  production, `DB_SSLMODE` must be `verify-full` and `DB_SSLROOTCERT` (default
  `backend/certs/rds-global-bundle.pem`) must contain a valid PEM certificate, or the backend
  refuses to start. Known gap (review minor, backend): a `DATABASE_URL` bypasses the
  verify-full check in staging/production.
- **NUL input** rejected with 422 before it reaches Postgres (section 5).
- **Open redirect**: `safeRedirect` in `web/src/auth/redirect.ts` accepts only a same-origin
  path, refusing control characters, backslashes, `//` and `/login` targets; unit tested.
- **CSP and headers** are generated at container start by `web/nginx/40-jobproof-config.sh`:
  `default-src 'self'`, `img-src`/`connect-src` add only the API origin, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'`. `API_BASE_URL` must be a bare http(s) origin:
  no control characters, valid host labels (1 to 63 chars, no edge hyphens), host up to 253
  chars, all-numeric hosts must be valid dotted-quad IPv4, port 1 to 65535 without a leading
  zero. Tests: `web/nginx/config-script.test.ts` (hostile inputs) and `e2e/tests/csp.spec.ts`
  (the app loads and works under the exact generated policy).
- **Bundle origin check**: exact-string allowlist, section 12.
- **Photo URLs**: HMAC-SHA256 over `photo_id:variant:exp`, constant-time compare, TTL
  `PHOTO_URL_TTL_SECONDS`; the web refetches the report once (throttled) when images expire.
  **(planned, T-003g)** Uploaded photos use presigned S3 GET URLs with the same TTL; uploads are
  validated (10 MiB, JPEG/PNG magic bytes, SHA-256, Pillow decode with a pixel limit), stripped
  of EXIF/XMP/IPTC without re-encoding, never replaced once stored. Location lives only in DB
  columns and manager responses.
- **Container entrypoint shells must be POSIX and busybox-safe** (lesson from the first Docker
  run, B4): the nginx image is Alpine, whose `sh`, `tr`, `grep`, `sed` are busybox. Use only
  POSIX `sh` (no bash arrays, `[[ ]]`, `local`, `pipefail`), `case` patterns and `grep -E`;
  no `tr` character classes like `[:print:]`, no GNU-only flags (`sed -r`, `grep -P`). Any
  change to `web/nginx/*.sh` runs the busybox regression test (`BUSYBOX=... vitest`).

### 9.1 Admin persona security model (T-002b to T-002f)

- **Separation (D2, confirmed by Paul 2026-11-08):** Admin and Manager stay separate roles
  because an Admin may be technical staff, not a manager; Admin never sees or changes reports,
  customers or billing. One role per user. Admin endpoints live on one router guarded by
  `require_roles(admin)`; manager endpoints by `require_roles(manager)`. Admin gets 403 on every
  manager operation and vice versa; tests enumerate operations from the contract. The role is
  reloaded from the database on every request, so a role change or deactivation applies at once.
  **This is the built state. T-004 (Phase 3, not started) replaces D2 in part** (Paul's PD3,
  2026-11-22): Admin becomes a permission held in one company, with read-only progress for its
  subtree and invoices own plus direct children's; Settings stay with the root company's Admin;
  still no photos, report text or customer contacts unless also a manager (section 17).
- **What Admin can do:** read and change company name, the two brand colours and the
  `uk_only_contact_details` switch (strict boolean: null, strings and 0/1 are 422), and read
  settings history. Nothing else: no reports, billing, users or audit of reports.
- **Account creation:** no user-management UI. Local/test: seeded `admin@jobproof.test`. Other
  environments: `python -m app.cli create-user --role admin|manager --email ... --full-name ...`
  (INFRA-3; `create-admin` is kept as the admin form; password from `ADMIN_INITIAL_PASSWORD` or
  a prompt, >= 12 chars, never logged; refuses existing emails).
- **Input handling:** company name: only the ordinary space is trimmed, 1 to 60 code points, no control characters (U+0000-001F, U+007F-009F) and no zero-width or bidi formatting characters (U+200B-200F, U+202A-202E, U+2066-2069, U+FEFF), identical on server and web; rendered
  only as text (JSX, `document.title`). Colours must match `#RRGGBB` before contrast is checked,
  are stored upper case under a DB check, and are validated again on the client before
  `setProperty`, so no CSS or markup can be injected through settings. Contrast below 4.5:1 against white or the
  surface colour is rejected server-side whatever the client does, so the app can never become unreadable.
- **Public exposure:** `GET /branding` returns only name, colours and `uk_only_contact_details`
  (no ids, users, times); the flag is public so client forms validate as the server does.
  `GET /admin/settings` returns the same flag.
- **Audit:** every real settings change writes `settings.changed` (old/new; booleans for
  `uk_only_contact_details`) in the same
  transaction; only Admin can read it. Bearer tokens in headers (no cookies), so no CSRF surface.
- **Audit integrity:** `audit_events` rejects UPDATE, DELETE and TRUNCATE by trigger for every
  role (TRUNCATE allowed only when the seed sets `jobproof.allow_audit_truncate` in its own
  local/test transaction). Events are kept indefinitely. In AWS the app additionally connects as a
  role with only SELECT and INSERT on `audit_events` (section 10).

### 9.2 Theming under the CSP (T-002d)

The CSP has no `style-src` override, so `default-src 'self'` blocks inline `<style>` and
`style="..."` markup. Themes are applied **only** by `web/src/theme/applyTheme.ts` calling
`document.documentElement.style.setProperty("--jp-primary", value)` (CSSOM, not governed by
CSP); the stylesheet only references `var(--jp-*)`, and derived shades use `color-mix()`. React
`style` props (swatches, preview) are CSSOM too. No `'unsafe-inline'`, hashes or nonces are added.
Branding caching: server `Cache-Control: no-cache`; client TanStack Query `["branding"]` with
5 min `staleTime` and refetch on focus; a validated localStorage snapshot
(`jobproof.branding.v1`, per origin = per deployment) paints the first frame and is revalidated
immediately; with no snapshot the brand area stays empty until `/branding` answers; on failure the
default theme and the neutral "Sign in" heading are used. CloudFront must forward the API's
`Cache-Control` unchanged if it ever fronts the API.

## 10. AWS deployment and pipeline

Full plan, decisions P1 to P11 for Paul, costs and tickets INFRA-1 to INFRA-8:
[specs/INFRA-aws-pipeline.md](specs/INFRA-aws-pipeline.md). No AWS resource exists yet.

**Built (INFRA-1 to INFRA-3; commits 5fe6834, d676c4c, 322808d, fixes d3a9b97, a437c8d; round 2
in `reports/progress/review-infra-45.json`: every round 1 finding fixed except the RDS CA bundle,
the agreed INFRA-6 entry gate):**
- INFRA-1: `infra/bootstrap/bootstrap.cfn.yaml` and runbook `infra/README.md`. OIDC trust
  requires `aud` `sts.amazonaws.com`; terraform role = exact `sub` match on one workflow file on
  `main` per account; state bucket private, versioned, encrypted, TLS-only, retained; cfn-lint
  clean. Plan role denies RDS log download, `lambda:GetFunction`, DynamoDB item reads,
  `ec2:GetConsoleOutput`, `cloudformation:GetTemplate`.
- **Repository-ID trust (decision):** the repository's OIDC subject template adds
  `repository_owner_id` and `repository_id`, so every trust condition (bootstrap roles and the
  Terraform deploy role in `modules/ci_roles`) matches `...:repository_owner_id:<id>:repository_id:<id>`
  as well as owner/repo, branch and workflow file. A renamed or re-created repository with the
  same name gets no access. The IDs are digits-only variables (`github_owner_id`,
  `github_repo_id`, placeholders in both `terraform.tfvars` until set); `check-env-parity.sh`
  checks the Terraform subject matches the bootstrap template.
- INFRA-2: `ci.yml`, `dependency-check.yml`, `dependabot.yml`; minimal permissions,
  `persist-credentials: false`, no `pull_request_target`, no secrets, actions SHA-pinned. Not
  yet run on GitHub (backlog B3 to B6).
- INFRA-3: contract v0.5.0 with `GET /health/live`; `DB_*` settings with `verify-full`
  (section 9); `app/dbroles.py` and CLI `db-roles`/`migrate`; `create-user --role`;
  `app.seed.demo`; `csp.txt` plus parity test; `infra/scripts/`. The CA bundle is still a
  placeholder (INFRA-6 entry gate, section 12).

**Written, never run (INFRA-4 Terraform 721e058, INFRA-5 workflows 20f3bb7):** round 1 review
(`review-infra-45.json`) CHANGES REQUESTED, 4 blockers. The code now carries fixes for the
blockers (deploy-role subject with repository IDs; no SSM by-path read, `image_tag` required;
`ADMIN_INITIAL_PASSWORD` by partial Secrets Manager ARN; `ecr:DescribeImages` for promotion) and
for the WAF bypass (`STARTS_WITH /api/v1/auth/` with URL_DECODE and LOWERCASE, covering login,
sessions and refresh); no round 2 review is recorded yet. Decisions:
- **`image_tag` is required** (40 lowercase hex characters, or `unreleased` for the first plan
  only) and every workflow passes `-var image_tag=<sha>`. Terraform never reads SSM parameters by
  path: the plan role may not read parameter values, and a by-path read would copy any future
  SecureString into state.
- **No secret value in Terraform state** (met in review): `ephemeral "random_password"` feeds
  `secret_string_wo` with `secret_string_wo_version` (raise to rotate); RDS manages its own
  master password (`manage_master_user_password`); outputs hold names and ARNs only.
- **Accepted risk: the deploy role is in effect database admin plus app secrets** (decided
  2026-11-22, recorded in spec INFRA 5.1). `ecs:RunTask` on every `jobproof` task definition plus
  reading the task log groups lets it run `db-roles`/`migrate` with a command override that prints
  the RDS master password, `JWT_SECRET` and other secrets. Controls: trust only for named workflow
  files on `main` with repository IDs, code review of `.github/`, validated dispatch inputs.
  Revisit (a separate db-admin role for `pipeline.yml`/`deploy-prod.yml`, RunTask per family)
  before real customer data.
- Other round 1 items, not re-checked in this update (infra/tests): stub-aws tests for the INFRA-5 scripts, lock files,
  pinned Terraform checksum, `deploy-prod` branch/digest check, pipeline concurrency scope, ops
  task revision after rollback, Cost Explorer monitor; terraform-prod applies main's
  `infra/terraform` with the promoted image (architect to accept or change in spec 4.7).

**Planned (INFRA-6 to INFRA-8), and the design INFRA-4/5 implement:**

- **Accounts:** AWS Organizations with a management account and two member accounts, `jobproof-dev`
  (`APP_ENV=staging`) and `jobproof-prod` (`APP_ENV=production`), in eu-west-2. Humans sign in
  through IAM Identity Center. The bootstrap stack above runs once per account. No long-lived
  keys anywhere.
- **Terraform** in `infra/terraform/` (written): the same `modules/` for `envs/dev` and
  `envs/prod` (spec section 3); state per account in S3 with native locking. **Hard requirement:
  no secret value in Terraform state** (write-only arguments and ephemeral values only), because
  the plan role that every pull request uses can read the state bucket. Code review checks it on
  every Terraform change.
- **Same origin:** one CloudFront distribution serves the SPA from S3 (OAC) and routes `/api/*`
  and `/health` to an **internal** ALB through a CloudFront VPC origin. This gives HTTPS on the
  AWS-provided address without a domain, and `connect-src 'self'`. SPA routing uses a
  CloudFront Function, not custom error pages, so API 403/404 responses stay `problem+json`.
  The CSP lives in `infra/terraform/modules/web_static/csp.txt` (built), with a parity test
  against `web/nginx/40-jobproof-config.sh`. A custom domain comes later (INFRA-8).
- **Runtime:** ECS Fargate (dev: tasks in public subnets with no NAT and inbound only from the
  ALB; prod: private subnets and one NAT), RDS Postgres 16 in private DB subnets with TLS
  `verify-full`. The backend reads `DB_*` parts plus a `DB_PASSWORD` secret; `GET /health/live`
  serves the ALB.
- **DB roles (B11, built in INFRA-3):** RDS-managed master used only by `app.cli db-roles`.
  **The RDS master is not a superuser** (it has CREATEROLE and CREATEDB, owns the database), so
  `db-roles` must work as such a role on first and later runs. `jobproof_migrator` owns the
  schema and runs `app.cli migrate` (alembic plus grants). `jobproof_app` has DML, only SELECT
  and INSERT on `audit_events`, and no TRUNCATE anywhere. Local and compose keep one superuser.
- **Pipeline (GitHub Actions):** `ci.yml` (Postgres service container, compose e2e on the
  runner); `pipeline.yml` on push to `main`: build once, then deploy dev (image to ECR,
  `terraform apply`, `db-roles`, `migrate`, dev-only `seed-demo --if-empty`, service update,
  web upload, smoke test); `deploy-prod.yml` is the manual approval (Run workflow) and promotes
  the same image digest and web build. Also `rollback.yml`, `create-user.yml`,
  `dev-demo-data.yml`, `dev-power.yml`. Migrations must be backward compatible with the deployed
  code (expand/contract); prod is never downgraded. The first deploy applies the whole chain,
  0001 to the head (0010 today; 0013 once T-003 is built), on an empty database.
- **T-003 deltas to INFRA-4:** done in code: the WAF sign-in rate rule covers `POST
  /api/v1/auth/sessions` (T-003b), and a photo-upload-only copy of the common rule set has
  `SizeRestrictions_BODY` count-only (design R9), both checked by `modules/waf/check-scope.sh`.
  **(planned, T-003g/n)**: app task role gets `s3:PutObject/GetObject/DeleteObject` on the
  photos bucket's `reports/*`; env `PHOTO_BUCKET`, `AWS_REGION`, `MOBILE_MIN_VERSION_ANDROID`;
  `csp.txt` becomes a template adding the photos bucket's regional origin to `img-src`
  (presigned GET).
- **One stack per company (D1)** still holds: its own accounts or environment, database, domain
  and `DEFAULT_COMPANY_NAME` on the migrate task.

## 11. Local run

**Verified path (no Docker).** `scripts/dev.sh up [--static]` starts Postgres 16 on
127.0.0.1:5544 (data in `.pgdata/`, run as `postgres` when invoked as root), migrates, seeds,
runs uvicorn on 8000 and Vite (or, with `--static`, the production build) on 8080.
`down | status | seed | test | e2e | psql`. All four Phase 1 tickets were built and verified
this way: lint, pytest, Vitest and Playwright pass.

**Docker path: KNOWN UNVERIFIED.** `make up` runs `docker compose up -d --build --wait backend
web` (db, migrate and seed come in through `depends_on`); `make down [V=1]`, `make logs`,
`make seed` (`docker compose run --rm seed`). The compose file and both Dockerfiles were written
and checked with `docker compose config` only. **No image has been built and the stack has never
run under Docker**, because the build workspace has no Docker daemon. The CI `e2e` job
(`.github/workflows/ci.yml`) runs exactly `make up` and `make e2e`; its first GitHub run will be
the first real Docker run (B4). If `make up` fails, check in this order:
1. Docker Compose v2.24+ (needed for `env_file` with `required: false` and `--wait`) and
   BuildKit (needed for `COPY --chmod` in `web/Dockerfile`).
2. Registry access for the first build: `postgres:16-alpine`, `python:3.13-slim`,
   `ghcr.io/astral-sh/uv:0.11.32`, `node:22-alpine`, `nginxinc/nginx-unprivileged:stable-alpine`.
3. Port clashes: 5544, 8000, 8080 (stop `scripts/dev.sh` first; it uses the same ports).
4. `.env` exists and its `DATABASE_URL` uses host `db` (Makefile copies `.env.example`).
5. `docker compose logs migrate seed`: both must exit 0 before the backend starts; seed refuses
   unless APP_ENV is local/test.
6. Web container: `40-jobproof-config.sh` exits non-zero on a malformed `API_BASE_URL`; it
   writes `/usr/share/nginx/html/config.js` and `/tmp/jobproof-headers.conf` as uid 101.
7. Then run `make e2e` against it (same URLs as the dev path).

URLs in both paths: web http://localhost:8080, API http://localhost:8000 (no Swagger UI; the
contract file is the docs). **(planned, T-003g)** photo storage on http://localhost:8333:
SeaweedFS (`photos` + one-shot `photos-init`) in compose, an in-memory moto server in
`scripts/dev.sh`. The app runs as an Expo development build against either path
(`mobile/README.md`; `mobile/.env.example`); `npm test -w @jobproof/mobile` runs Jest with no
device.

Demo accounts add `manager2@jobproof.test` / `Manager123!` (Priya Nair) and
`admin@jobproof.test` / `Admin123!` (Tom Ashworth). `DEFAULT_COMPANY_NAME` (optional) is read
once by migration 0002 on an empty database. Reseeding keeps the company settings; e2e global
setup restores the default name and theme through the API. Real Admin accounts:
`python -m app.cli create-admin --email EMAIL --full-name NAME`. `SEED_PROFILE=tree_surgery`
selects the tree-surgery dataset (T-002m, optional). First `docker compose build` / `npm ci` / `uv sync` needs network;
running afterwards needs none. Details: [specs/T-000-bootstrap.md](specs/T-000-bootstrap.md) §4.

### 11.1 GitHub Pages demo (built)

A backend-free, mocked demo of both apps, published by `.github/workflows/pages.yml` (push to
`main` touching web, mobile, shared, api, pages or the build script; no AWS, no secrets).
`npm run build:pages` (`scripts/build-pages.mjs`) writes `pages-dist/`; `npm run preview:pages`
serves it. Site layout under the base (default `/jobproof/`): `/` landing page
(`pages/landing/`, theme from the demo settings, operative logins listed), `/web/` the Manager web
app, `/mobile/` the Operative app in a browser phone frame, and `404.html` that loads the right
app's `index.html` for deep links. All data is committed and fake.

- **Web demo:** `vite build --mode pages`; `web/src/main.tsx` dynamically imports
  `web/src/mock` only when `MODE === "pages"`, so the mock API and `mockData.json` (exported from
  the seed by `scripts/export-mock-data.py`) are tree-shaken out of normal builds. No `config.js`
  in the demo.
- **Mobile demo:** `JOBPROOF_DEMO=1 expo export --platform web`. `mobile/metro.config.js`
  redirects modules to stand-ins in `mobile/demo/` (in-memory DB and files, kv-store,
  SecureStore and camera shims, demo sign-in list, modal and Linking shims, an in-browser mock of
  the operative API with `mobile/demo/mock/operativeData.json` from
  `scripts/export-operative-mock-data.py`) **only when `JOBPROOF_DEMO=1` and the platform is
  `web`**; every other build resolves exactly the modules it always did. `app.config.ts` uses the
  placeholder server `https://demo.invalid` in demo mode only.
- **Checks that keep demo code out of real builds:** `web/scripts/check-dist.mjs` fails a normal
  web build containing mock code (and a pages build without it; both check external origins);
  `mobile/demo/checkDemoBundle.mjs --normal` runs on the Android `expo export` in the CI `mobile`
  job and fails on any demo marker, and `--demo` checks the demo bundle has the demo and no
  external origin; `mobile/demo/isolation.test.ts` asserts nothing in `mobile/app` or
  `mobile/src` imports `demo/` or reads `JOBPROOF_DEMO`, the native entry is unchanged and
  `react-native-web` is not a runtime dependency; `mobile/demo/metroConfig.test.ts` covers the
  redirects.
- **Build-only devDependencies (approved 2026-11-22):** `react-native-web` 0.21.4 and
  `@expo/metro-runtime` 58.0.17, exact, in `mobile` devDependencies (section 3).

## 12. Key decisions and Phase 1 deviations

| Decision | Reason |
|---|---|
| Terraform over CDK | Reviewable `plan` diffs, no synth step, mature AWS provider, S3 native state locking |
| Contract-first, hand-written OpenAPI 3.1 | One source of truth for web and mobile; backend tested against it |
| @hey-api/openapi-ts, bundled fetch client | Types and SDK in one tool, no runtime dependency |
| Sync SQLAlchemy + psycopg 3 | Read-only, low traffic; simpler to test |
| Generated SVG placeholder photos via signed URLs | No image dependencies, deterministic, offline; same shape as S3 presigned URLs |
| Stdlib `logging` JSON formatter | Avoids structlog for a small surface |
| TanStack Query in shared hooks | Loading/error/retry semantics once, reused by mobile |
| CORS explicit allowlist locally (web 8080, API 8000) | **(written in INFRA-4/5, not yet deployed)** AWS serves web and API from one CloudFront origin (HTTPS without a domain, internal ALB); CORS stays configured with that origin. Local stays cross-origin, so both modes remain tested (e2e locally, smoke test in dev) |
| CloudFormation for the per-account bootstrap only (built, INFRA-1) | Solves the chicken-and-egg problem (state bucket and OIDC role must exist before Terraform runs) with one console upload instead of a laptop; everything else is Terraform |
| No secret value in Terraform state (2026-11-09, hard INFRA-4 requirement) | The plan role, assumable by any pull-request run, reads the state bucket. Secrets come only from write-only arguments and ephemeral values; if a provider cannot do that, the secret is created outside Terraform (never a state fallback). A code-review check on every Terraform change |
| Real RDS CA bundle is the INFRA-6 entry gate, not an INFRA-3 merge condition (2026-11-09) | The placeholder fails closed (staging/production refuse to start), so merging is safe; INFRA-6 cannot start until `backend/certs/rds-global-bundle.pem` is the AWS global bundle and `test_rds_bundle.py` passes instead of XFAIL. Owner: backend engineer, with Paul fetching the file if the workspace cannot. The weekly comparison against AWS's copy already runs in `dependency-check.yml` |
| `.github/` and `infra/bootstrap/` fixes are owned by the infra engineer (2026-11-09) | One owner for CI and bootstrap security (OIDC trust, plan-role denies, workflow permissions); backend fixes stay with the backend engineer |
| Overdue/part-paid derived, not stored | Always consistent with payments and today |
| Built-bundle URL check is an exact-string allowlist | Seven inert strings; any new URL fails the build. List: [specs/T-000-bootstrap.md](specs/T-000-bootstrap.md) §7.1 |
| Injectable clock (`FIXED_NOW`, refused in production) | Deterministic "this month" figures in tests |
| GitHub Pages demo answers the API in the browser from committed seed exports (section 11.1) | Shows both apps with no AWS and no secrets; demo code is switched in only at build time and checked out of every real build |
| Repo-wide React 19.3.0 (T-003a) | React Native's renderer refuses any other React; one hoisted copy for web, shared and mobile |

Deviations from the original plan:

| Planned | Built | Reason / decision |
|---|---|---|
| react-router `useSearchParams` for filter state | Custom `useQueryParams` in `web/src/app/useQueryParams.ts` (same shape, over `useLocation`/`useNavigate`) | react-router's bundled warning text contains `https://github.com/ungap/url-search-params.`, which the exact-string allowlist rejects. Keep the small tested hook. If `useSearchParams` is wanted, add that exact string to spec T-000 §7.1, ticket T-001a scenario 5 and `web/scripts/dist-origins.mjs` |
| CSS modules | One global stylesheet `web/src/styles/app.css` | Small app; plain CSS, system fonts, no UI kit still hold |
| `shared/src/auth/tokenStore.ts` | `shared/src/api/tokenStore.ts`; web impl `web/src/auth/sessionTokenStore.ts`; auth hooks in `shared/src/auth/hooks.ts` | Interface sits with the client Adapter that consumes it |
| One billing function | Pure functions plus SQL twins (`billing_sql.py`) | Filters and dashboard totals run in SQL; a test checks they agree with the pure functions over the seed |
| `dev.sh up\|down\|status\|test\|e2e` | Adds `--static`, `seed`, `psql`, `SKIP_WEB`, `WEB_PORT`, `BACKEND_PORT` | e2e must run against the production build |
| APP_ENV default | Required, no default (compose defaults it to `local`) | Security review, section 9 |

## 13. Dependency overrides and deliberate deferrals

### 13.1 Security overrides (root `package.json`, decided 2026-11-07, T-001a review)

`"overrides": { "glob": "^14.0.2", "js-yaml": "^4.3.2", "minimatch": "^11.0.1", "react":
"19.3.0", "react-dom": "19.3.0" }` (installed: glob 14.0.4, js-yaml 4.3.2, minimatch 11.0.5;
`npm audit` 0 vulnerabilities in review-t003-pkgC, 2026-11-22). The security overrides are dev
tooling only; nothing reaches the web bundle or the Android app. The react pins are not a
security override (section 3).

| Override | Pulled in by | Advisories fixed | Compatibility |
|---|---|---|---|
| `js-yaml` ^4.3.2 | `@hey-api/openapi-ts` 0.99.0 > `@hey-api/json-schema-ref-parser` 1.4.4 pins `4.2.0` exactly | GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh (high, quadratic CPU) | Same major and API; not 5.x |
| `minimatch` ^11.0.1 | eslint 10.14.0, `@eslint/config-array` 0.23.5, `@typescript-eslint/typescript-estree` 8.72.1 (all `^10`) | GHSA-g3hv-75wg-m249 (moderate, globparts DoS) | Deliberate major override; 11.x keeps CJS+ESM exports and engines |
| `glob` ^14.0.2 (T-003a review) | Expo and Jest tooling: `@expo/cli`, `@expo/fingerprint`, `@jest/reporters` (13.0.7), `test-exclude`, `jest-expo` (10.5.0) | GHSA-3g3m-2fjr-6pw4 (moderate, fixed in 14.0.2) | Build and test time only; mobile lint and Jest pass with it (review-t003-pkgC); `expo export` with it is not verified here. Remove when those packages accept >= 14.0.2 |

Verified: `npm run gen` byte-identical, `gen:check`, `redocly lint`, `npm run lint` (still
flags a seeded error), `npm test`, `npm run build`. `npm install` does not move locked versions;
use `npm update js-yaml minimatch`. `@redocly/cli` is a self-contained bundle that npm audit
cannot see; recheck its THIRD_PARTY_NOTICES when upgrading it.

**Remove** the js-yaml override when hey-api's ref parser allows >=4.3.2, and the minimatch
override when eslint, config-array and typescript-estree all accept >=11.0.1: delete the entry,
`npm install`, confirm `npm audit` clean and lint/test/build pass. Check at each weekly
dependency ticket, at the latest 2027-02-01. Residual risk: an eslint behaviour change from the
minimatch major, caught by `npm run lint` failing.

**Backend audit:** `pip-audit` 2.10.1 runs weekly (and on demand) in
`.github/workflows/dependency-check.yml` with `npm audit`; findings open or update one GitHub
issue (B7, B8 done). Its first run on GitHub is still pending, so no clean result is recorded yet.

### 13.2 Deferrals

| Package | Held at | Reason | Revisit |
|---|---|---|---|
| typescript 7.x | 6.0.3 | typescript-eslint 8.72.1 peers `<6.1.0`; TS 7 has no compiler API yet (typescript-eslint #12518). Still holds | 2027-02-01 or when typescript-eslint supports TS 7 |
| @types/node 26 | 22.x | Match Node 22 runtime | with Node runtime upgrade |
| PostgreSQL 18 | 16 (local, CI, RDS) | Moving local, CI, the workspace's PG16 binaries (`scripts/dev.sh`) and RDS together is a ticket of its own; RDS 16 standard support runs to 2029-02-28 (verified 2026-11-08) | 2027-09-01, before real customer data grows |
| structlog, UI kits, axios | not used | Lean Phase 1 | when a need appears |
| Presigned PUT uploads to S3 | upload through the API (T-003g) | Synchronous validation, thumbnails and one-copy guarantee without a worker; pilot volume is small | more than ~50 operatives uploading daily, or upload p95 > 5 s |
| python-multipart | not used | Raw-body upload avoids it and its 2026 DoS advisories | if a multipart form is ever needed |
| HEIC on the server | not accepted | The app converts to JPEG; avoids a native HEIF decoder | if a non-app client must upload |
| EAS Update (OTA), Android foreground service, Sentry, Detox | not used (T-003) | Simpler release and min-version rule; fewer permissions and data processors; Maestro is lighter | after the pilot (design section 3.5, 9, 10, T3-6) |
| deepmerge (vulnerability, deferred with mitigation) | 4.3.1 (latest; via `jest-config` 30) | GHSA-gcqx-w48m-w2h4 (low), reported in review-t003-pkgA; no fixed release exists, so no override is possible. Mitigation: Jest configuration only, merges our own committed config, never in the web bundle or the Android app | each weekly dependency ticket; override as soon as a fixed release exists |
| `test-renderer` 1.3.1 | 1.3.0 (exact) | `jest-expo` 58.0.14 pins 1.3.0 exactly; 1.3.1 would install a second copy beside the one RNTL uses | when jest-expo moves |
| `expo-network`, reconnect sync trigger | not used (T-003f) | The engine's reconnect trigger has no listener; recovery after an outage uses backoff timers (worst case 15 min ± 20%), foreground and Sync now. Spec T-003f records it | T-003i adds `expo-network` |
| expo-file-system 58.0.14 | 58.0.13 | Found in review-t003-pkgC; patch release | next mobile ticket |

## 14. Follow-up backlog

| # | Item | Owner | Suggested ticket |
|---|---|---|---|
| B1 | `page` has no upper bound and the contract has no `maximum`. Architect adds `maximum` (e.g. 10000) to the `Page` parameter in `api/openapi.yaml`, regenerates the client (`npm run gen`); backend adds `le=` in `backend/app/routers/manager.py`; add a 422 test | architect, then backend | T-005 hardening (relabelled 2026-11-09 from T-003 and 2026-11-22 from T-004: T-003 is the Operative app, T-004 the company hierarchy epic) |
| B2 | Invoice customer must equal the job's customer: enforced by seed and app only. Option: unique `(id, customer_id)` on jobs and a composite FK `(job_id, customer_id)` from invoices (new Alembic revision, next free number after the head). Revisit together with T-004l, which changes invoices | architect, then backend | T-005 hardening |
| B3 | **Open.** Pin Docker base image digests. Search `TODO(pin)` (compose, `backend/Dockerfile`, `ci.yml` service container); also `web/Dockerfile` (`node:22-alpine`, nginx). The CI `e2e` job prints the digests it pulled; pin from the first GitHub run | backend, web (`ci.yml`: infra) | after the first GitHub run |
| B4 | **Open.** First real `make up` and `make e2e` under Docker (section 11). Earlier run found the busybox `tr` issue (fixed; rule in section 9). Now wired as the CI `e2e` job; first GitHub run pending | orchestrator | first GitHub run of `ci.yml` |
| B5 | **Open.** Blackhole connect-timeout test (`backend/tests/test_health.py`) skips in the sandbox; the CI `backend` job runs it (`pytest -rs`); first GitHub run pending | backend | first GitHub run of `ci.yml` |
| B6 | **Open.** nginx image tag `stable-alpine` not verified; digest reported by the CI `e2e` job | web | first GitHub run, with B3 |
| B7 | **Done (INFRA-2).** `pip-audit` automated weekly in `dependency-check.yml` (section 13.1) | dependency-checker | - |
| B8 | **Done (INFRA-2).** Weekly `dependency-check.yml` (Monday 05:17 UTC) and `dependabot.yml` | - | - |
| B9 | Naming debt, **narrowed by T-003 (2026-11-09)**: the new app surface is named "operative" (`/operative/*`, `Operative*` schemas, `notes`); the role value `painter` and the existing manager fields (`painter`, `painter_id`, `painter_notes`, `/manager/painters`) stay, because renaming them touches the JWT, the DB enum and the web guard for no user benefit | architect | a deliberate v1.0 contract clean-up |
| B14 | Retention: automatic deletion of photo files and location 6 years after job completion (T3-1 default), and purge of ended `auth_sessions` after 90 days. No scheduler exists yet | architect, backend | before the first expiry (2032) for photos; sessions any time |
| B10 | A non-painting production deployment needs its own job types; the T-002m migration (planned, next free number) only inserts painting types and there is no management screen (T-002m) | architect, product owner | before the first Arbour production deployment |
| B12 | Invoices have no billing-address/name snapshot, so a customer edit (T-002n) changes what issued invoices show. Snapshot name and billing address onto the invoice at issue before invoice documents or Stripe links exist. **Blocking for T-004** (issued invoices between companies) | architect | T-004o, or the Stripe/invoice-document ticket if earlier |
| B11 | **Done (INFRA-3, re-checked in round 2, review-infra-45).** Separate migrator and app DB roles (`backend/app/dbroles.py`, spec INFRA section 5.4): the app role owns nothing, has only SELECT and INSERT on `audit_events` and no TRUNCATE; `db-roles` works as the non-superuser RDS master (tested twice as a NOSUPERUSER CREATEROLE CREATEDB owner) and sends SCRAM verifiers, never clear passwords | - | - |
| B13 | No password change and no user management: users come only from the seed and `app.cli create-user --role admin\|manager` (`create-admin` remains, INFRA-3). Needed before real users. **Blocking for T-004** (add a company, add people: T-004c, T-004d) | architect | before prod go-live (spec INFRA section 5.7), or T-004c/d |
| B15 | Reassignment with an existing draft: the draft belongs to the operative who started it; after the job moves to someone else the new assignee gets 409 `draft_owned_by_other` (GET and PATCH) and the job is left out of their lists; the original author gets 404 (section 5). No reassignment UI or office action to resolve it exists yet (hand over, discard or move the draft) | architect, product owner | with the first reassignment feature (T-004g at the latest) |

## 15. Phase 2b: the Operative app (T-003)

Design: [specs/T-003-design.md](specs/T-003-design.md) (decisions T3-1 to T3-8 for Paul at its
top); build order: [specs/T-003-work-packages.md](specs/T-003-work-packages.md) (packages A to
F); specs `specs/T-003a.md` to `T-003p.md`. Contract v0.6.0 in `api/openapi.yaml` (g, h, k, o
items still staged).

**Status (2026-11-22):** Package A (T-003a, b), B (c, d) and C (e, f) built. Review rounds:
A and B round 1 CHANGES REQUESTED; the fixes this document records are in the code (no separate
round 2 file). C round 1 CHANGES REQUESTED
(`reports/progress/review-t003-pkgC.json`: transient refresh failure shown as "sign in again",
display after sync; open architect questions on the display rule, the "Needs attention" count
and the rename-durability check). T-003g onwards **(planned)**.

**Mobile structure as built (T-003e, f):**

| Path | What it holds |
|---|---|
| `mobile/src/db/` | `localDb.ts` (Adapter, above), `expoSqliteDb.ts`, `migrations.ts` (pragmas WAL, `synchronous=FULL`, `foreign_keys`; each step commits with its `user_version`; a newer schema is refused, never downgraded), `draftRepo.ts`, `photoRepo.ts`, `unsentSource.ts` (sign-out count), `localStore.tsx` (the store, its Observer and hooks), `openStore.ts` |
| Local schema v1 | `drafts` (notes and sign-off with `rev`/`synced_rev`, `local_state`, `submission_id`), `checklist_states` (per item, `rev`/`synced_rev`), `photos` (design 3.3 columns **plus `recovered`** (orphan file found at start) **and `thumb_path`** (cached preview, rebuildable); no orientation column), `sync_meta` (key/value). Every work row has `owner_user_id` and every query filters on it |
| `sync_meta` keys | `last_stage:<userId>` (last capture stage chosen; default `before`), `capture_job:<userId>` (the job the camera was last opened for, so orphan recovery can attach a file whose row was never written), and, added with the Package C fixes, `gallery_import:<userId>` (photo id of the gallery copy in progress, so a recovered orphan is known to be a gallery import). Keys are per user |
| `mobile/src/files/` | `PhotoFiles` and `ExpoPhotoFiles`; `paths.ts` (`photos/<userId>/<photoId>.<ext>`, `thumbs/`, `upload/`; segments validated; `.part` then rename); `orphans.ts` (start-up cleanup and recovery; never deletes an original) |
| `mobile/src/capture/` | `captureService.ts` (save a shot or gallery import: file, then row, in one transaction with the draft row), `gallery.ts` / `expoGalleryPicker.ts` (system photo picker), `imageTools.ts` / `expoImageTools.ts`, `uploadCopy.ts`, `exif.ts` (taken-at date only), zoom helpers |
| `mobile/src/sync/` | `engine.ts`, `classify.ts`, `retry.ts`, `SyncProvider.tsx` (triggers: start, foreground, edits, timers, Sync now; reconnect deferred to T-003i), `SyncStatusLine.tsx`. Today it sends dirty drafts only (PATCH, batched at 200 items); photos and submit join in T-003g/h |
| `mobile/src/features/checklist/` | `ChecklistSection.tsx`, `ItemScreen.tsx`, `ItemPicker.tsx`, `useAutosave.ts`, `localView.ts` (local value while `rev > synced_rev`, else server value) |
| `mobile/src/features/capture/` | Camera, gallery import, photo section, thumbnails and viewer screens |

| Topic | Decision (reason in the design) |
|---|---|
| App | Expo SDK 58, Expo Router, Android 10+ (minSdk 29); development builds, not Expo Go |
| Shared code | Generated client, Adapter (gains optional single-flight `refresh` and an AbortSignal fallback for Hermes), `ApiError`, branding, text rules, dates; new `shared/src/operative/` (status words, submit-rule twin with `submitCases.json`, validators, evidence flags, semver) and read hooks. Writes go through the mobile sync engine, not shared hooks |
| Local data | SQLite (WAL, `synchronous=FULL`) for drafts, checklist states, photo records; files in app-private storage; refresh token in `expo-secure-store`; TanStack Query cache persisted to `expo-sqlite/kv-store`; every row keyed by user |
| Sync | State-based reconciliation (dirty flags), max 2 uploads, backoff 5 s/15 s/1 min/5 min/15 min, single flight; foreground plus `expo-background-task` (WorkManager, >= 15 min); no foreground service |
| Sessions | Section 8 (device sessions) |
| Photos | Upload through the API (metadata PUT, raw-file PUT), presigned S3 GET for viewing; validation and EXIF removal on the server (section 9) |
| Reports | One per job; `state` draft/submitted; drafts invisible to managers; submit idempotent by `submission_id`; job completed at submit |
| Evidence | Server times authoritative; device times recorded with per-request `device_sent_at`; offset > 300 s flagged; gallery and location flagged; files never replaced |
| Testing | pytest (moto), Vitest, Jest (`node:sqlite` logic, jest-expo + RNTL 14 UI), headless sync integration against the real backend through a fault proxy, `expo export`; Maestro and device scripts outside the workspace |
| Release | EAS Build (AAB), Play App Signing, internal testing track, `MOBILE_MIN_VERSION_ANDROID` gate (426); needs prod (INFRA-6/7) and the custom domain (INFRA-8) first |

## 16. Phase 2a decisions (T-002)

Product decisions D1 to D7 are in [the epic](tickets/T-002-admin-branding-review-workflow.md);
these are the technical choices that implement them (D8 to D11 and the D10 amendment come from Paul's 2026-11-08 decisions). Specs: `specs/T-002a.md` to `T-002p.md`;
build order and file ownership: [specs/T-002-work-packages.md](specs/T-002-work-packages.md).
Open questions were answered with the epic's defaults (Paul has not replied); each spec lists
them as assumptions.

| # | Decision | How (technical) |
|---|---|---|
| D1 | One deployment per company; multi-tenancy later | `company_settings` single row (`CHECK (id = 1)`), read only via `services/settings.py`; defaults only in `backend/app/branding/defaults.py` and `shared/src/branding/defaults.ts` (a test keeps them equal and scans for strays). No "JobProof" or company name in the UI bundle. Multi-tenancy later = `tenant_id` on settings and tables, resolve tenant from host |
| D2 | Admin is a separate role that sees Settings only (Admin may be tech staff, confirmed 2026-11-08). **Replaced in part by T-004 PD3 (Paul, 2026-11-22; not built):** Admin becomes a per-company permission (section 17) | `user_role` + `admin`; admin router guard; web `RequireRole`; per-role home. Section 9.1 |
| D3 | Explicit review; editing a reviewed report reopens it | `POST /review` with version; PATCH reopens in the same transaction and records `report.reopened` with the previous reviewer |
| D4 | Editable: painter notes, checklist done/note, new manager notes; **amended 2026-11-08:** customer contact details (T-002n) | `ReportUpdate` / `CustomerUpdate` with `extra="forbid"` at every level; everything else 422 |
| D5 | Optimistic concurrency | `job_reports.version`, row lock + compare, 409 with current state |
| D6 | Default theme dark green, white page; AA enforced (reject) | Five tokens, two editable; WCAG 2.2 ratio >= 4.5 (unrounded) against both white and the surface colour #F4F7F2, because accent text sits on both on server and client; CSSOM theming (section 9.2); presets Forest, Navy, Charcoal, Burgundy |
| D7 | Neutral wording; optional tree-surgery data | "Operative" in the label module only (API names unchanged, B9); job types become data (`job_types`) only if T-002m is built |
| D8 | (T-002n) Customer is shared by its jobs; a change is audited once and shown on the customer page and in every affected report's history; impact shown before saving | One `customer.edited` event with `customer_id`; report history query ORs in the report's customer; `CustomerRecord.impact` counts jobs, reports (reviewed), issued invoices on read |
| D9 | (T-002n) A customer edit does not reopen reviewed reports | Report rows untouched (no version bump); "reviewed" approves the painter's evidence, not the contact record; history shows the change |
| D10 | (T-002n) Tolerant UK validation. **Amended 2026-11-08 (T-002p):** "UK only" is an Admin setting `uk_only_contact_details`, default true | UK only (default): postcode any case/spacing, stored `OUTWARD INWARD` upper case, "Enter a UK postcode such as BS6 5QA."; phone UK only (`0` + 9-10 digits, or `+44`/`+44 (0)` + 9-10 digits), "Enter a UK phone number such as 07700 900123.". Off: postcode 2-12 ASCII letters/digits/spaces/hyphens, starting and ending alphanumeric, upper-cased with space runs collapsed (UK postcodes still get the UK form), "Enter a postcode."; phone also `+` international 8-15 digits, D10 message. `0044...` refused in both modes. Phone stored trimmed with space runs collapsed; email `local@domain.tld` shape, stored as entered; lengths name/contact 120, lines 100, town/county 60, email 254, phone 30; free-text rule and two-stage validation in section 5. Changing the setting never revalidates stored customers; only sent keys are validated |
| D11 | (T-002o) "Apply my changes on top" next to "Reload latest" | Client-only three-way merge (base = loaded version snapshot, mine = form, theirs = fresh GET); per-field Keep mine / Keep theirs for clashes; never auto-saves; the save is a normal versioned PATCH |

Other defaults applied: Admin cannot see manager data; text name only, no logo; queue above
"Recent reports"; tab title "Page | Company"; audit kept indefinitely; no Admin history screen.

## 17. Phase 3: company hierarchy and tiered invoicing (T-004, not started)

Epic: [tickets/T-004-company-hierarchy-and-tiered-invoicing.md](tickets/T-004-company-hierarchy-and-tiered-invoicing.md)
(tickets T-004a to T-004p). **Ticketed, not designed, nothing built.** It starts only after the
T-003 prerequisites listed in the epic are demoable on a device (PD4). The architect designs
tables, endpoints and the roll-up approach when it starts; nothing below is a design yet.

Constraints the design must meet (from the epic and Paul's decisions PD1 to PD4, 2026-11-22):
- **D1 kept:** one deployment holds one company tree whose root is the contractor that owns it;
  subcontractors are companies inside the tree, not tenants.
- **D2 replaced in part (PD3):** Admin is a permission held in one company, not a global role.
  The root company's Admin keeps Settings (name, colours; one brand per deployment). Any company's
  Admin manages its own people and companies and reads progress and invoices as below; never
  photos, report text or customer contacts unless also a manager; never approves or issues.
- **Two visibility rules, deliberately different:** **progress** (units done against allocated,
  no prices) is visible **down the whole subtree**; **money** (rates, invoices) only between a
  company and its **direct children** (own invoices, invoices received from direct children, the
  rates agreed with them, and the company's own rate from its parent). Nobody sees across
  branches or upwards; nobody sees a grandchild's rate or invoice amount. Epic risk 2: one
  missing filter leaks by depth, so subtree-scoped authorisation (T-004b) lands first with a test
  that enumerates every endpoint as every role at every level.
- Invoices gain a level (existing invoices become level 0); issued invoices are immutable
  (credit note plus new invoice). B12 (snapshot) and B13 (user management) become blocking.
- The ticket number T-004 now means this epic: the old "T-004 hardening" backlog (B1, B2) is
  T-005.
