# JobProof architecture

Owner: architect. This is the system's memory: read it first, edit sections in place, link to
files instead of copying code. Entries marked **(planned)** are specified but not yet built;
everything else describes the code as it stands.
Last updated: 2026-11-08 (Phase 1 built; Phase 2a T-002a to T-002l built and checked against the
code, T-002m still **(planned)**: decisions in section 16, build plan in
[specs/T-002-work-packages.md](specs/T-002-work-packages.md)).

## 1. System overview

Painters finish a job, photograph it and submit a completion report (mobile, Phase 2). Head-office
managers review reports and billing in a web app (Phase 1, built). Customers pay quotes/invoices
by a secure Stripe link (later). One FastAPI backend serves all clients through one versioned REST
API described by [api/openapi.yaml](api/openapi.yaml).

```
 Manager browser ──> Web SPA (S3+CloudFront | nginx locally) ──┐
 Painter phone   ──> Expo app (Phase 2) ───────────────────────┤ HTTPS JSON, Bearer JWT
 Customer        ──> payment link page (later) ────────────────┤
                                                               v
                                   FastAPI backend (ECS Fargate | container | uvicorn)
                                      │                 │
                                 PostgreSQL 16     Photo store (Phase 1: generated SVG;
                                 (RDS | container)   later: S3, MinIO locally)
```

Phase 1 (built): manager persona, read-only, deterministic mock data, runs offline.
Phase 2a (built except T-002m, T-002): Admin persona and company settings (name, colour scheme) with a
public branding endpoint; managers mark reports reviewed and edit notes/checklist with
optimistic concurrency and an append-only audit trail; dashboard review queue; neutral wording.
Still web only and mock data. One deployment per company (D1).

## 2. Components and responsibilities

| Path | Responsibility (as built) |
|---|---|
| `backend/app/` | FastAPI app factory `main.py`; settings `config.py`; clock `clock.py`; DB session `db.py`; dependencies (auth, roles, photo store) `deps.py`; problem+json `errors.py`; JSON logs `logging.py`; request id and access log `middleware.py`; argon2/JWT `security.py` |
| `backend/app/models/` | SQLAlchemy models: `people.py` (users, customers), `work.py` (jobs, quotes, job_reports, checklist items, photos), `billing.py` (invoices, payments), `enums.py` |
| `backend/app/routers/` | `health.py`, `auth.py`, `manager.py`, `photos.py`. Schemas in `backend/app/schemas/` |
| `backend/app/services/` | Query logic per screen (`dashboard.py`, `reports.py`, `invoices.py`, `painters.py`, `photos.py`, `auth.py`); `billing.py` pure status/balance functions and `billing_sql.py` their SQL twins for filtering (agreement tested over the seed) |
| `backend/app/photos/` | `store.py` PhotoStore Strategy and SVG renderer; `signing.py` HMAC-SHA256 signed URLs |
| `backend/app/seed/` | Deterministic dataset (`catalogue.py`, `dataset.py`), loader (`loader.py`), entry point `python -m app.seed` |
| `backend/migrations/` | Alembic; one revision `versions/0001_initial_schema.py` |
| `backend/tests/` | pytest: API (each response validated against the contract by `contract.py`), route parity, constraints, migrations round trip, seed, billing, security, config |
| `web/src/` | React SPA: `app/` (router, guards, shell, query client, error boundary, `useQueryParams`), `auth/` (session token store, `safeRedirect`), `pages/` (Login, Dashboard, Reports, ReportDetail, Billing, NotAuthorised, NotFound), `components/` (UI, QueryBoundary, PhotoGallery, `useThrottledRefetch`), `styles/app.css`, `config.ts` (reads runtime `config.js`) |
| `web/nginx/` | `default.conf` and `40-jobproof-config.sh` (writes `config.js` and the security-header include, incl. CSP, from `API_BASE_URL`) |
| `web/scripts/` | `check-dist.mjs` / `dist-origins.mjs`: build fails on any external URL not in the exact allowlist |
| `shared/src/` | `@jobproof/shared`: `generated/` (hey-api output, committed), `api/` (client Adapter, `ApiError`, query keys, `TokenStore`), `auth/hooks.ts`, `hooks/` (health, manager), `filters.ts`, `format/` (money, dates, labels, address) |
| `e2e/` | Playwright: auth, dashboard, reports, report detail, billing, states, layout, CSP, screenshots; helpers in `tests/support.ts` |
| `api/openapi.yaml` | The contract. Hand-written OpenAPI 3.1, v0.2.0: 17 operations, all built (some `x-ticket` markers remain as provenance). Backend conforms; clients generated from it |
| `mobile/`, `infra/` | README only (Phase 2 and the AWS phase) |
| `backend/app/branding/` | `defaults.py` (the only backend copy of the default name and theme), `contrast.py` (WCAG ratio) |
| `backend/app/routers/branding.py`, `admin.py`; `services/settings.py`; `models/settings.py`; `cli.py` | Branding (public), Admin router, the one settings accessor, settings model, `create-admin` command. `services/audit.py`, `review.py`, `report_edit.py`; `models/audit.py`: audit store, review and edit writes |
| `shared/src/branding/` | `defaults.ts` (only web/mobile copy of the default theme), `presets.ts`, `contrast.ts`, `companyName.ts`; hooks `useBranding`, `useAdmin`. `useReportWrites`; `history.ts`, `conflict.ts`, `reportEdit.ts` |
| `web/src/theme/` | `applyTheme.ts` (CSSOM `setProperty` only), `brandingCache.ts` (localStorage snapshot), `BrandingProvider.tsx`; `pages/Settings.tsx`, `pages/settings/*`. `pages/report/*`, `pages/dashboard/ReviewQueue.tsx` |
| `scripts/dev.sh` | No-Docker path: `up [--static] \| down \| status \| seed \| test \| e2e \| psql` |
| `docker-compose.yml`, `Makefile`, `.env.example` | Docker stack and developer commands (see section 11 for what is unverified) |

Web routes: `/login`, `/not-authorised`, and under the manager guard `/`, `/reports`,
`/reports/:reportId`, `/billing`; `*` is NotFound. The guard is
`RequireRole role="manager"`, plus `/settings` under `RequireRole role="admin"`; after sign-in
each role lands on its home (`web/src/app/roles.ts`).

## 3. Stack versions (verified 2026-11-07 against PyPI / npm; installed versions match)

Exact versions are locked in `backend/uv.lock` and the root `package-lock.json`. Transitive
security overrides (js-yaml, minimatch): section 13.1.

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
| Web | react / react-dom | 19.3.1 | |
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
| DB | PostgreSQL | 16 | `postgres:16-alpine`; RDS 16.x |
| Web serve | nginx | `nginxinc/nginx-unprivileged:stable-alpine` | **tag not verified** (Docker Hub blocked); backlog B6 |
| IaC | Terraform / AWS provider | 1.15.x / ~> 6.72 | not written yet |

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
| `job_types` | Job types as data (code, label); `jobs.job_type` becomes text FK; enum dropped | planned, 0007 (T-002m, optional) |
| `invoice_line_items` | Itemised invoice lines | later |
| `payment_links` | Customer Stripe checkout links (capability token) | later |

Migration: `backend/migrations/versions/0001_initial_schema.py` (revision `0001`), tested up,
down, up and against the models (`backend/tests/test_migrations.py`).

**Migration plan (T-002; 0002 to 0006 built, 0007 planned), one linear chain, one revision per ticket, built in package
order so no Alembic branches arise:**

| Rev | Ticket | Change | Risk and downgrade |
|---|---|---|---|
| 0002 | T-002a | create `company_settings`, insert default row (`DEFAULT_COMPANY_NAME` env, else "Arbour Services"; hex codes frozen in the file) | none; drop table |
| 0003 | T-002b | `ALTER TYPE user_role ADD VALUE 'admin'` | downgrade refuses if admins exist, else recreates the enum |
| 0004 | T-002g | report `version` default 1, `last_changed_*` | additive; drop columns |
| 0005 | T-002f | `audit_events`, enums, append-only triggers | downgrade drops the history: only ever run on non-production data |
| 0006 | T-002i | `manager_notes` | additive |
| 0007 | T-002m | `job_types` table, `jobs.job_type` enum to text FK | type change on `jobs`; downgrade refuses non-painting codes |

The seed never touches `company_settings` (excluded from its truncate; no FK into it, so CASCADE
cannot reach it) and sets `jobproof.allow_audit_truncate` for its own transaction only.

Derived invoice status: pure function in `backend/app/services/billing.py`, SQL twin in
`billing_sql.py`: `void` > `draft` > `paid` (balance 0) > `overdue` (due date before today,
Europe/London) > `part_paid` > `sent`.

Known gap: `invoices.customer_id` and `invoices.job_id` are separate FKs; that the invoice's
customer equals the job's customer is guaranteed only by the seed and application (backlog B2).

## 5. API conventions

- Base path `/api/v1`; health at `/health` (unversioned; 200, or 503 when the DB is unreachable).
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
- **Contract staging (T-002a):** `x-ticket: T-002x` marks contract items not yet built;
  `backend/tests/contract.py` `PENDING_TICKETS` hides them from parity and schema checks until
  the ticket lands. The generated client is regenerated once per epic.
- Contract parity: backend tests validate every response against the schema and check that
  routes and operations match (`test_route_parity.py`); `npm run gen:check` fails on stale
  generated client. Workflow: [specs/T-000-bootstrap.md](specs/T-000-bootstrap.md) section 5.

## 6. Patterns in use

| Pattern | Where | Why / status |
|---|---|---|
| Strategy | `backend/app/photos/store.py`: `PhotoStore` Protocol (`url_for`, `render`), `PlaceholderPhotoStore`; chosen in `backend/app/deps.py` `get_photo_store` | Implemented as described. Only the placeholder exists; `S3PhotoStore` (later) plugs in at `get_photo_store` |
| Strategy | `shared/src/api/tokenStore.ts`: `TokenStore` interface (sync or async `get/set/clear`); web implementation `web/src/auth/sessionTokenStore.ts` (sessionStorage) | Same auth hooks, platform-specific persistence. Async signatures already allow SecureStore |
| Adapter | `shared/src/api/client.ts` `configureApiClient` / `callApi` over the generated client | Runtime base URL, bearer header, 15 s timeout with abort, Problem errors to `ApiError`, 401 handler. No DOM access |
| (none) | Authorisation: `require_roles(...)` in `backend/app/deps.py` | Role-only rules. Revisit as a per-persona Policy when painter ownership rules arrive |
| (none) | Invoice status: pure functions plus SQL twins | No transitions in Phase 1, so no State |
| (none) | Settings accessor `services/settings.py`; single-row table with `CHECK (id = 1)` | D1: name and theme read in one place; no in-process cache (multiple ECS tasks) |
| (none) | Concurrency: `SELECT ... FOR UPDATE` + version compare in `services/review.py`, `report_edit.py` | Needs old values for audit and 409 bodies; simpler than conditional UPDATE |
| (none) | Audit: explicit `record_event` calls in each write service, same transaction; DB triggers make the table append-only | Explicit beats ORM listeners for "who/what/old/new"; failed writes leave no trace automatically |
| (none) | Theming: `applyTheme` sets CSS custom properties through the CSSOM | CSP-safe (no `<style>`, no inline style attributes); see section 9 |
| Data record | **(planned, T-002m)** `SeedProfile` registry in `backend/app/seed/profiles/` | Profiles differ in content only, not behaviour |

## 7. Personas and permissions (as implemented)

| Capability | Manager | Admin | Painter | Customer | Anonymous |
|---|---|---|---|---|---|
| `GET /health`, `POST /auth/login` | yes | yes | yes | n/a | yes |
| `GET /branding` | yes | yes | yes | n/a | yes |
| `GET /auth/demo-accounts` | yes when `DEMO_ACCOUNTS_ENABLED`, else 404 | same | same | n/a | same |
| `GET /auth/me` | yes | yes | yes | n/a | 401 |
| `GET /manager/*` (dashboard, painters, reports, reports/{id}, invoices) | yes | 403 | 403 `forbidden` | n/a | 401 `unauthenticated` |
| `POST /manager/reports/{id}/review`, `PATCH /manager/reports/{id}`, `GET .../history` | yes | 403 | 403 | n/a | 401 |
| `GET/PATCH /admin/settings`, `GET /admin/settings/history` | 403 | yes | 403 | n/a | 401 |
| `GET /photos/{id}/image` | by valid signature only; no bearer token involved | | | | |
| Painter capture endpoints | later | | own jobs (Phase 2) | | |
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
DB). Web stores the token in sessionStorage. Later: refresh tokens and possibly Cognito; the
bearer contract stays the same.

## 9. Security decisions (made in Phase 1 review)

- **APP_ENV** is required, no default, exactly `local`, `test`, `staging` or `production`
  (`backend/app/config.py`). docker compose supplies `${APP_ENV:-local}` so a fresh clone runs.
- **Secret guard** when APP_ENV is not local/test: `JWT_SECRET` and `PHOTO_URL_SECRET` must be
  set explicitly, at least 32 chars, no surrounding whitespace, not a dev default and not
  `dev-only-` prefixed (both case-insensitive), and must differ from each other
  (case-insensitive). `DEMO_ACCOUNTS_ENABLED=true` is refused unless APP_ENV is local or test (the list includes the admin password); production also refuses `FIXED_NOW`.
  CORS origins may not contain `*`. Tests: `backend/tests/test_config.py`.
- **Seed guard**: `python -m app.seed` truncates and reloads, so it refuses unless APP_ENV is
  local or test (`backend/app/seed/__main__.py`). Staging gets no demo data; a staging demo
  dataset needs an explicit decision (and note that demo accounts could be enabled on staging
  while their users do not exist).
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
- **Container entrypoint shells must be POSIX and busybox-safe** (lesson from the first Docker
  run, B4): the nginx image is Alpine, whose `sh`, `tr`, `grep`, `sed` are busybox. Use only
  POSIX `sh` (no bash arrays, `[[ ]]`, `local`, `pipefail`), `case` patterns and `grep -E`;
  no `tr` character classes like `[:print:]`, no GNU-only flags (`sed -r`, `grep -P`). Any
  change to `web/nginx/*.sh` runs the busybox regression test (`BUSYBOX=... vitest`).

### 9.1 Admin persona security model (T-002b to T-002f)

- **Separation (D2):** one role per user. Admin endpoints live on one router guarded by
  `require_roles(admin)`; manager endpoints by `require_roles(manager)`. Admin gets 403 on every
  manager operation and vice versa; tests enumerate operations from the contract. The role is
  reloaded from the database on every request, so a role change or deactivation applies at once.
- **What Admin can do:** read and change company name and the two brand colours, and read
  settings history. Nothing else: no reports, billing, users or audit of reports.
- **Account creation:** no user-management UI. Local/test: seeded `admin@jobproof.test`. Other
  environments: `python -m app.cli create-admin --email ... --full-name ...` (password from
  `ADMIN_INITIAL_PASSWORD` or a prompt, >= 12 chars, never logged; refuses existing emails).
- **Input handling:** company name: only the ordinary space is trimmed, 1 to 60 code points, no control characters (U+0000-001F, U+007F-009F) and no zero-width or bidi formatting characters (U+200B-200F, U+202A-202E, U+2066-2069, U+FEFF), identical on server and web; rendered
  only as text (JSX, `document.title`). Colours must match `#RRGGBB` before contrast is checked,
  are stored upper case under a DB check, and are validated again on the client before
  `setProperty`, so no CSS or markup can be injected through settings. Contrast below 4.5:1 against white or the
  surface colour is rejected server-side whatever the client does, so the app can never become unreadable.
- **Public exposure:** `GET /branding` returns only name and colours (no ids, users, times).
- **Audit:** every real settings change writes `settings.changed` (old/new) in the same
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

## 10. AWS deployment layout (planned, later phase)

Terraform in `infra/terraform/`: `modules/{network, ecr, rds, secrets, alb, ecs_service,
web_static, photos_bucket, ci_roles}` and `envs/{staging,prod}`; state in S3 with native lockfile.

- VPC across 2 AZs: public subnets (ALB, NAT), private app subnets (Fargate), private DB subnets
  (RDS Postgres 16, Multi-AZ in prod).
- ECS Fargate backend behind an ALB (HTTPS, ACM, health check `/health`). Secrets Manager:
  `DATABASE_URL`, `JWT_SECRET`, `PHOTO_URL_SECRET`. Set `APP_ENV` explicitly per environment.
- One stack per company (D1): its own RDS database, domain and
  `DEFAULT_COMPANY_NAME` on the migration task. Two DB roles: a migrator (owns the schema, used by
  the migration task) and an app role (DML on business tables, only SELECT and INSERT on
  `audit_events`). First Admin via a one-off `python -m app.cli create-admin` task with
  `ADMIN_INITIAL_PASSWORD` from a short-lived secret.
- Deploy: CI builds and pushes to ECR, runs a one-off ECS task `alembic upgrade head`, then a
  rolling service update. The seed is never run outside local/test.
- Web: `vite build` to a private S3 bucket behind CloudFront (OAC); SPA fallback; per-environment
  `config.js` with `Cache-Control: no-cache`. The nginx CSP must be reproduced as a CloudFront
  response-headers policy.
- Photos (later): private S3 bucket, presigned URLs via `S3PhotoStore`.
- CI/CD: GitHub OIDC roles for plan, apply, backend deploy, web deploy.

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
run under Docker**, because the build workspace has no Docker daemon. If `make up` fails, check
in this order:
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
contract file is the docs).

Demo accounts add `manager2@jobproof.test` / `Manager123!` (Priya Nair) and
`admin@jobproof.test` / `Admin123!` (Tom Ashworth). `DEFAULT_COMPANY_NAME` (optional) is read
once by migration 0002 on an empty database. Reseeding keeps the company settings; e2e global
setup restores the default name and theme through the API. Real Admin accounts:
`python -m app.cli create-admin --email EMAIL --full-name NAME`. `SEED_PROFILE=tree_surgery`
selects the tree-surgery dataset (T-002m, optional). First `docker compose build` / `npm ci` / `uv sync` needs network;
running afterwards needs none. Details: [specs/T-000-bootstrap.md](specs/T-000-bootstrap.md) §4.

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
| CORS explicit allowlist, no same-origin proxy | Mirrors production (CloudFront to ALB) |
| Overdue/part-paid derived, not stored | Always consistent with payments and today |
| Built-bundle URL check is an exact-string allowlist | Seven inert strings; any new URL fails the build. List: [specs/T-000-bootstrap.md](specs/T-000-bootstrap.md) §7.1 |
| Injectable clock (`FIXED_NOW`, refused in production) | Deterministic "this month" figures in tests |

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

`"overrides": { "js-yaml": "^4.3.2", "minimatch": "^11.0.1" }` (installed: js-yaml 4.3.2,
minimatch 11.0.5; `npm audit` 0 vulnerabilities). Dev tooling only; nothing reaches the bundle.

| Override | Pulled in by | Advisories fixed | Compatibility |
|---|---|---|---|
| `js-yaml` ^4.3.2 | `@hey-api/openapi-ts` 0.99.0 > `@hey-api/json-schema-ref-parser` 1.4.4 pins `4.2.0` exactly | GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh (high, quadratic CPU) | Same major and API; not 5.x |
| `minimatch` ^11.0.1 | eslint 10.14.0, `@eslint/config-array` 0.23.5, `@typescript-eslint/typescript-estree` 8.72.1 (all `^10`) | GHSA-g3hv-75wg-m249 (moderate, globparts DoS) | Deliberate major override; 11.x keeps CJS+ESM exports and engines |

Verified: `npm run gen` byte-identical, `gen:check`, `redocly lint`, `npm run lint` (still
flags a seeded error), `npm test`, `npm run build`. `npm install` does not move locked versions;
use `npm update js-yaml minimatch`. `@redocly/cli` is a self-contained bundle that npm audit
cannot see; recheck its THIRD_PARTY_NOTICES when upgrading it.

**Remove** the js-yaml override when hey-api's ref parser allows >=4.3.2, and the minimatch
override when eslint, config-array and typescript-estree all accept >=11.0.1: delete the entry,
`npm install`, confirm `npm audit` clean and lint/test/build pass. Check at each weekly
dependency ticket, at the latest 2027-02-01. Residual risk: an eslint behaviour change from the
minimatch major, caught by `npm run lint` failing.

**Backend audit gap:** `pip-audit` has never run (needs network). Run it on a networked machine
before any deployment (backlog B7).

### 13.2 Deferrals

| Package | Held at | Reason | Revisit |
|---|---|---|---|
| typescript 7.x | 6.0.3 | typescript-eslint 8.72.1 peers `<6.1.0`; TS 7 has no compiler API yet (typescript-eslint #12518). Still holds | 2027-02-01 or when typescript-eslint supports TS 7 |
| @types/node 26 | 22.x | Match Node 22 runtime | with Node runtime upgrade |
| structlog, UI kits, axios | not used | Lean Phase 1 | when a need appears |

## 14. Follow-up backlog

| # | Item | Owner | Suggested ticket |
|---|---|---|---|
| B1 | `page` has no upper bound and the contract has no `maximum`. Architect adds `maximum` (e.g. 10000) to the `Page` parameter in `api/openapi.yaml`, regenerates the client (`npm run gen`); backend adds `le=` in `backend/app/routers/manager.py`; add a 422 test | architect, then backend | T-003 hardening |
| B2 | Invoice customer must equal the job's customer: enforced by seed and app only. Option: unique `(id, customer_id)` on jobs and a composite FK `(job_id, customer_id)` from invoices (new Alembic revision, after 0007) | architect, then backend | T-003 hardening |
| B3 | Pin Docker base image tags and digests. Search `TODO(pin)` (compose, `backend/Dockerfile`); also `web/Dockerfile` (`node:22-alpine`, nginx), which has no `TODO(pin)` marker | backend, web | First Docker run ticket |
| B4 | First real `make up` and `make e2e` under Docker (section 11). First run found the entrypoint used a `tr` class busybox lacks (fixed; rule in section 9). Remaining web-image steps (nginx start, healthcheck) still unverified | orchestrator on a Docker host | First Docker run ticket |
| B5 | Blackhole connect-timeout test (`backend/tests/test_health.py`) skips in the sandbox; needs CI or a local accept-but-never-reply socket | backend | CI ticket |
| B6 | nginx image tag `stable-alpine` not verified | web | First Docker run ticket |
| B7 | Run `pip-audit` (never run) | dependency-checker | Weekly dependency ticket |
| B8 | Weekly dependency-check schedule once the repo is on GitHub | orchestrator | CI ticket |
| B9 | Naming debt: API/DB say `painter` (`painter_id`, role `painter`, `/manager/painters`) while the UI says "Operative" (T-002l). Rename with a contract version bump when the field-worker app is specified | architect | Phase 2 painter-app spec |
| B10 | A non-painting production deployment needs its own job types; 0007 only inserts painting types and there is no management screen (T-002m) | architect, product owner | before the first Arbour production deployment |
| B11 | Separate migrator and app DB roles (audit append-only defence in depth, section 9.1). The AWS app role must not own `audit_events` and must lack TRUNCATE on `audit_events`, `users` and `job_reports` (the tables that cascade into it); otherwise the `jobproof.allow_audit_truncate` setting (settable by any role) and the trigger owner could be misused (T-002 review, finding 9) | infra | AWS phase |

## 15. Phase 2 starting points (painter mobile app, Expo)

Not a spec; the Phase 2 spec will define screens and contract changes.

- **Reuse from `shared/` unchanged:** generated client and types, the Adapter
  (`configureApiClient` with the API origin from Expo config instead of `config.js`), `ApiError`,
  query keys, auth hooks (`useLogin`, `useMe`, `useLogout`), `shouldRetry`, formatters (money,
  dates, labels, address). The shared package has no DOM access.
- **Platform-specific:** a `TokenStore` over `expo-secure-store` (the interface already accepts
  async methods), navigation, camera/photo capture, offline queue if in scope.
- **Endpoints needed (high level):** painter's assigned jobs (list, detail) scoped to the
  caller; create/update a draft completion report with checklist; photo upload (presigned S3
  upload in AWS, MinIO locally, via an `S3PhotoStore`); submit report. `GET /auth/me` already
  returns the role.
- **Design changes that follow:** ownership rules (painter sees only own jobs) make the
  per-persona Policy worth introducing; first write endpoints need idempotency and validation
  conventions; the painter role currently gets 403 on all manager endpoints and that stays.
- **(from T-002)** Write conventions now exist (section 5): reuse `version`/409 for report
  drafts. `manager_notes` is internal: painter endpoints must never return it. Mobile reuses
  `useBranding` (AsyncStorage snapshot), `DEFAULT_THEME`, `contrast.ts`, `buildReportUpdate`.

## 16. Phase 2a decisions (T-002)

Product decisions D1 to D7 are in [the epic](tickets/T-002-admin-branding-review-workflow.md);
these are the technical choices that implement them. Specs: `specs/T-002a.md` to `T-002m.md`;
build order and file ownership: [specs/T-002-work-packages.md](specs/T-002-work-packages.md).
Open questions were answered with the epic's defaults (Paul has not replied); each spec lists
them as assumptions.

| # | Decision | How (technical) |
|---|---|---|
| D1 | One deployment per company; multi-tenancy later | `company_settings` single row (`CHECK (id = 1)`), read only via `services/settings.py`; defaults only in `backend/app/branding/defaults.py` and `shared/src/branding/defaults.ts` (a test keeps them equal and scans for strays). No "JobProof" or company name in the UI bundle. Multi-tenancy later = `tenant_id` on settings and tables, resolve tenant from host |
| D2 | Admin is a separate role that sees Settings only | `user_role` + `admin`; admin router guard; web `RequireRole`; per-role home. Section 9.1 |
| D3 | Explicit review; editing a reviewed report reopens it | `POST /review` with version; PATCH reopens in the same transaction and records `report.reopened` with the previous reviewer |
| D4 | Editable: painter notes, checklist done/note, new manager notes | `ReportUpdate` with `extra="forbid"` at every level; everything else 422 |
| D5 | Optimistic concurrency | `job_reports.version`, row lock + compare, 409 with current state |
| D6 | Default theme dark green, white page; AA enforced (reject) | Five tokens, two editable; WCAG 2.2 ratio >= 4.5 (unrounded) against both white and the surface colour #F4F7F2, because accent text sits on both on server and client; CSSOM theming (section 9.2); presets Forest, Navy, Charcoal, Burgundy |
| D7 | Neutral wording; optional tree-surgery data | "Operative" in the label module only (API names unchanged, B9); job types become data (`job_types`) only if T-002m is built |

Other defaults applied: Admin cannot see manager data; text name only, no logo; queue above
"Recent reports"; tab title "Page | Company"; audit kept indefinitely; no Admin history screen.
