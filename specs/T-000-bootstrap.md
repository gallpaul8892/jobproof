# Spec T-000: Bootstrap architecture and repo foundation

Ticket: [tickets/T-000-bootstrap.md](../tickets/T-000-bootstrap.md). Architecture memory:
[ARCHITECTURE.md](../ARCHITECTURE.md). First feature: [specs/T-001-manager-view.md](T-001-manager-view.md).

## Questions for the product owner (defaults assumed, none block the design)

1. Is the business VAT registered? **Assumed yes, 20% VAT on all work.**
2. Payment terms? **Assumed 14 days for homeowners, 30 days for landlords and businesses.**
3. Region for mock data? **Assumed Bristol and Bath (BS/BA postcodes).**
4. Do managers ever need a painter-style view? **Assumed no; roles are exclusive.**

## Summary

Defines the monorepo, the local stack (docker compose and a no-Docker dev script), the contract
workflow, cross-cutting conventions (auth, authorisation, errors, pagination, logging, config,
migrations, mock data, placeholder images), the IaC plan, and the ordered implementation tickets
for T-001. No application code is written by this ticket.

## Patterns

See ARCHITECTURE.md section 6. Introduced here: Strategy for `PhotoStore` (placeholder now, S3
later) and `TokenStore` (web sessionStorage, mobile SecureStore later); Adapter around the
generated API client. Authorisation is a plain role-check dependency (no pattern) because rules
are role-only in Phase 1.

## 1. Repo layout (scenario 2)

```
/
├── Makefile                  # developer entry points (section 3)
├── docker-compose.yml        # local stack (section 4.1)
├── .env.example              # every env var with dev-safe values; .env is gitignored
├── package.json              # npm workspaces: shared, web, e2e; scripts gen, gen:check, lint, test
├── package-lock.json
├── ARCHITECTURE.md  CLAUDE.md
├── api/
│   ├── openapi.yaml          # THE contract (OpenAPI 3.1, hand-written)
│   └── redocly.yaml          # lint rules
├── backend/
│   ├── pyproject.toml  uv.lock  alembic.ini  Dockerfile  .dockerignore
│   ├── app/
│   │   ├── main.py           # create_app(): middleware, routers, exception handlers
│   │   ├── config.py         # Settings (pydantic-settings), validated at startup
│   │   ├── clock.py          # now()/today_london(); honours FIXED_NOW outside production
│   │   ├── db.py             # engine, SessionLocal, get_session dependency
│   │   ├── logging.py        # JSON formatter, request-id contextvar
│   │   ├── errors.py         # Problem exceptions and handlers
│   │   ├── security.py       # argon2 hashing, JWT encode/decode
│   │   ├── deps.py           # current_user, require_roles(*roles)
│   │   ├── models/           # SQLAlchemy 2.0 declarative models
│   │   ├── schemas/          # Pydantic response/request models mirroring the contract
│   │   ├── routers/          # health.py auth.py manager.py photos.py
│   │   ├── services/         # dashboard.py reports.py invoices.py billing.py
│   │   ├── photos/           # store.py (PhotoStore), placeholder.py (SVG), signing.py
│   │   └── seed/             # __main__.py, dataset.py (pure), catalogue.py (names, streets, captions)
│   ├── migrations/           # env.py, script.py.mako, versions/
│   └── tests/                # pytest; contract.py helper
├── shared/                   # @jobproof/shared (consumed as TS source, no build step)
│   ├── package.json  openapi-ts.config.ts  tsconfig.json
│   └── src/
│       ├── generated/        # @hey-api/openapi-ts output, COMMITTED, never hand-edited
│       ├── api/              # client.ts (Adapter), errors.ts (ApiError), queryKeys.ts
│       ├── auth/             # tokenStore.ts (interface), useLogin/useMe/useLogout
│       ├── hooks/            # useDashboard, useReports, useReport, useInvoices, usePainters, useDemoAccounts
│       ├── format/           # money.ts, dates.ts, labels.ts (enum -> display label)
│       └── index.ts
├── web/                      # @jobproof/web
│   ├── package.json  vite.config.ts  tsconfig.json  index.html  Dockerfile  nginx/
│   ├── public/config.js      # dev default runtime config
│   └── src/  (main.tsx, app/, auth/, pages/, components/, styles/)
├── e2e/                      # @jobproof/e2e: playwright.config.ts, tests/
├── mobile/README.md          # placeholder: Expo app arrives in a later phase
├── infra/README.md           # Terraform module plan (section 8); no IaC code yet
├── scripts/dev.sh            # no-Docker dev path (section 4.2)
├── scripts/progress.py       # existing
├── specs/  tickets/  reports/
```

`.gitignore` additions: `.dev/`, `.pgdata/` (exists), `e2e/.auth/`.

## 2. Versions

Recorded in ARCHITECTURE.md section 3 (verified 2026-11-07). Manifests use exact pins for
`@hey-api/openapi-ts` (0.x) and caret ranges elsewhere; lockfiles are committed. TypeScript is
held at 6.0.x (deferral recorded). Root `package.json` sets `"engines": {"node": ">=22.22"}`.

## 3. Makefile targets

| Target | Behaviour |
|---|---|
| `make up` | Create `.env` from `.env.example` if missing; `docker compose up -d --build --wait backend web`; print Web, API and health URLs plus demo credentials |
| `make down` | `docker compose down` (keeps the db volume); `make down V=1` adds `-v` |
| `make logs` | `docker compose logs -f --tail=200` |
| `make seed` | `docker compose run --rm seed` (truncate and reload, deterministic) |
| `make lint` | `ruff check` + `ruff format --check` + `mypy app` (backend, via uv); `npm run lint` (eslint + `tsc --noEmit` in shared, web, e2e); `redocly lint api/openapi.yaml --config api/redocly.yaml`; `npm run gen:check` |
| `make test` | backend `uv run pytest` against `TEST_DATABASE_URL`; `npm test` (vitest in shared and web) |
| `make e2e` | `npm run e2e` (Playwright) against `WEB_URL` (default http://localhost:8080); stack must be up |
| `make gen` | Regenerate `shared/src/generated` from the contract |
| `make dev` / `make dev-down` | `scripts/dev.sh up` / `scripts/dev.sh down` |

`make lint` and `make test` run on the host toolchain (uv, Node). `TEST_DATABASE_URL` defaults to
`postgresql+psycopg://jobproof:jobproof@127.0.0.1:5544/jobproof_test`, which works with both the
compose db (publishes 5544) and `scripts/dev.sh`. The test fixture creates the database if
it is missing.

## 4. Local environment (scenario 4)

### 4.1 docker compose (user's machine; the final deliverable)

| Service | Image / build | Command | Depends on | Healthcheck | Ports |
|---|---|---|---|---|---|
| `db` | `postgres:16-alpine` | default | | `pg_isready -U jobproof` every 2s | `5544:5432` |
| `migrate` | `backend/Dockerfile` (image `jobproof-backend`) | `alembic upgrade head` | db healthy | one-shot | |
| `seed` | `jobproof-backend` | `python -m app.seed` | migrate completed_successfully | one-shot | |
| `backend` | `jobproof-backend` | `uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --timeout-graceful-shutdown 20` | seed completed_successfully | python urllib GET `/health` every 5s | `8000:8000` |
| `web` | `web/Dockerfile`, build context repo root | nginx | backend healthy | `wget -qO- http://127.0.0.1:8080/` | `8080:8080` |

- `env_file: .env` for db/migrate/seed/backend; `web` gets `API_BASE_URL=http://localhost:8000`.
- Named volume `pgdata` for db. No other volumes. No service needs network beyond the compose
  network once images are built; the stack runs offline (ticket T-001 scenario 10).
- Backend image: multi-stage; builder uses the `uv` binary copied from `ghcr.io/astral-sh/uv`
  (pinned tag) to `uv sync --frozen --no-dev`; runtime `python:3.13-slim`, non-root uid 10001,
  exec-form CMD, `PYTHONUNBUFFERED=1`, no compilers. Contains `app/`, `migrations/`,
  `alembic.ini`. Healthcheck in Dockerfile too (ECS uses the ALB check, compose uses this).
- Web image: stage 1 `node:22-alpine`, `npm ci` at root, `npm run build -w @jobproof/web`;
  stage 2 `nginxinc/nginx-unprivileged:<stable>-alpine` (pinned), listens 8080, serves `dist/`
  with SPA fallback (`try_files $uri /index.html`), long cache for `/assets/*`, `no-cache` for
  `index.html` and `config.js`. An entrypoint script in `/docker-entrypoint.d/` writes
  `config.js` from `API_BASE_URL` (JSON-escaped). This is the same static build that goes to S3.

### 4.2 No-Docker dev path: `scripts/dev.sh` (orchestrator workspace and developers)

Bash, `set -euo pipefail`, idempotent. State in `.dev/` (pids, logs) and `.pgdata/` (cluster).

| Command | Behaviour |
|---|---|
| `up [--static]` | 1. Locate Postgres binaries (`PG_BIN`, default `/usr/lib/postgresql/16/bin`, else `pg_config --bindir`). 2. If `.pgdata/data` missing: `initdb --username=jobproof --auth=scram-sha-256 --pwfile=...` (password `jobproof`). 3. Start with `pg_ctl -D .pgdata/data -o "-p 5544 -k <abs>/.pgdata/run -c listen_addresses=127.0.0.1" -l .dev/postgres.log start -w`. 4. Create databases `jobproof` and `jobproof_test` if absent. 5. `uv sync --frozen` in backend; `npm ci` if `node_modules` missing. 6. Load `.env` (create from `.env.example` if missing); `alembic upgrade head`; `python -m app.seed`. 7. Start uvicorn on 127.0.0.1:8000 (`.dev/backend.pid`, `.dev/backend.log`). 8. Start web on 8080: default `vite --port 8080 --strictPort`; `--static` runs `vite build` then `vite preview --port 8080 --strictPort` (exercises the production build and `config.js`). 9. Poll `/health` and the web URL (timeout 60s, fail with log tail). 10. Print URLs and demo credentials. |
| `down` | Stop web and backend (pid files, SIGTERM then SIGKILL after 10s), `pg_ctl stop -m fast` |
| `status` | Show each process and `/health` |
| `seed` | Re-run `python -m app.seed` |
| `test` | Ensure Postgres is running, run `make test` |
| `e2e` | Ensure the stack is up (start it if not), run `make e2e` |
| `psql` | Open psql on the dev database |

Root handling: when `EUID == 0`, all Postgres commands run via `runuser -u postgres --` and the
script `chown -R postgres` `.pgdata`; uvicorn and Vite run as the invoking user. Port 5544 is
used to avoid clashing with a system Postgres on 5432, and matches the compose db port. If port
5544 is already in use by the compose db, `up` reuses it (skips steps 2-3).

Playwright browsers: the e2e config sets `launchOptions.executablePath` from
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` when set. `dev.sh e2e` sets it to `google-chrome` (Chrome for
Testing) when found on PATH, because the Playwright browser CDN is not reachable from the
orchestrator workspace. On a normal machine developers run `npx playwright install chromium` once.

### 4.3 Running a single service without Docker

- Backend: `cd backend && uv sync && uv run alembic upgrade head && uv run python -m app.seed && uv run uvicorn app.main:app --reload --port 8000` (needs `DATABASE_URL`).
- Web: `npm ci && npm run dev -w @jobproof/web` (port 8080; reads `web/public/config.js`).
- Postgres: any Postgres 16 reachable via `DATABASE_URL`.

## 5. API contract workflow (scenario 5)

1. A feature spec changes `api/openapi.yaml` first (architect). The PR that changes it also
   regenerates the client.
2. `npm run gen` (root) runs `openapi-ts` in `shared/` with
   `shared/openapi-ts.config.ts`: input `../api/openapi.yaml`, output `src/generated`, plugins
   `@hey-api/typescript`, `@hey-api/sdk`, `@hey-api/client-fetch` (bundled into the output, no
   runtime dependency). Output is committed so web and mobile builds do not need the generator
   and contract changes are visible in review. eslint ignores `src/generated`.
3. Web and mobile import only from `@jobproof/shared` (types, configured SDK, hooks, formatting).
   `shared/src/api/client.ts` configures the generated client: base URL from runtime config,
   `Authorization` from `TokenStore`, 15s timeout via `AbortSignal.timeout`, and converts
   `application/problem+json` into `ApiError {status, code, title, detail, requestId, fieldErrors}`.
   Shared code must not touch the DOM (mobile safety); platform specifics are injected.
4. Drift detection, all in `make lint` / `make test`:
   - **Client drift**: `npm run gen:check` regenerates into a temp dir and diffs against
     `shared/src/generated`; non-empty diff fails.
   - **Contract validity**: `redocly lint` with `api/redocly.yaml`.
   - **Server route parity** (pytest): the set of `(method, path)` in the FastAPI app equals the
     set of operations in `openapi.yaml` (minus any listed in `tests/contract.py:NOT_YET_IMPLEMENTED`,
     which must be empty when T-001c is done).
   - **Response conformance** (pytest): every API test asserts the response through
     `assert_contract(response, operation_id)` which checks the status code is declared for that
     operation and validates the JSON body with `jsonschema` (Draft 2020-12) against the declared
     schema, resolving `$ref` within the YAML.
   - FastAPI's generated `/openapi.json`, `/docs` and `/redoc` are disabled
     (`openapi_url=None`) so there is exactly one contract.
5. Breaking changes (removing fields, narrowing enums, changing types) require a version note
   in the spec. Mobile clients in the wild (later) make this mandatory: additive changes only
   within `/api/v1`.

## 6. Cross-cutting concerns (scenario 6)

### 6.1 Authentication (Phase 1)
- Seeded users with argon2id hashes (`argon2-cffi` defaults). Users without a password hash
  cannot sign in.
- `POST /api/v1/auth/login`: email trimmed and lowercased; on unknown email verify against a
  fixed dummy hash (uniform timing); any failure or inactive user returns 401
  `invalid_credentials` with the same message.
- JWT HS256, claims `sub` (user id), `role`, `iat`, `exp`, `iss=jobproof`, `aud=jobproof-api`;
  TTL `JWT_TTL_SECONDS` (default 1800). Decode requires all claims and checks iss/aud/exp with
  30s leeway. No refresh token; expiry returns the user to the login page.
- `current_user` dependency: parse bearer, decode, load the user, reject if missing or inactive
  (401 `unauthenticated`, header `WWW-Authenticate: Bearer`). The role used for authorisation is
  the DB role, not the claim.
- Demo credentials endpoint enabled by `DEMO_ACCOUNTS_ENABLED`; `Settings` refuses to start if it
  is true while `APP_ENV=production`.

### 6.2 Authorisation model (three personas)
- `Role` enum: `manager`, `painter` (users table). Customers are not users; they will act via
  capability tokens in payment links (later, `payment_links` table).
- Each router declares its dependency: `manager` router uses `Depends(require_roles(Role.manager))`
  at router level, so no manager endpoint can be added without it. Wrong role: 403 `forbidden`.
- Later, painter endpoints add object-level checks (own jobs only); at that point introduce a
  per-persona Policy (Strategy) in `app/policies/`. Recorded in ARCHITECTURE.md.
- Permission matrix: ARCHITECTURE.md section 7.

### 6.3 Error format
RFC 9457 `application/problem+json`: `type` (`https://jobproof.dev/problems/{code}`), `title`,
`status`, `detail`, `instance` (request path), plus `code` (stable enum in the contract) and
`request_id`; validation errors add `errors: [{loc, message}]`. Handlers in `app/errors.py` for
`ProblemError` (app-raised), `HTTPException`, `RequestValidationError` (422), unknown routes (404)
and unhandled exceptions (500 `internal_error`, details logged, never returned).

### 6.4 Pagination, filtering and sorting
`page` (1-based, default 1), `page_size` (default 20, max 100). Response
`{items, total, page, page_size}`; a page past the end returns empty `items` with the real
`total`. One query parameter per filter, single value, AND-combined. `q` is a trimmed
case-insensitive substring search (`ILIKE '%' || q || '%'` with `%`, `_` and `\` escaped). Date
ranges are `date_from`/`date_to`, inclusive, Europe/London calendar dates; `date_to < date_from`
is 422. Sorting is fixed per endpoint (documented in the contract) with a unique tiebreaker so
pages are stable. Unknown query parameters are ignored.

### 6.5 Alembic workflow
- `migrations/env.py` uses `app.models.Base.metadata` and `DATABASE_URL` from Settings. MetaData
  has a naming convention (`ix_`, `uq_`, `ck_`, `fk_`, `pk_`) so constraint names are stable.
- One linear history, revisions named `NNNN_<slug>` (e.g. `0001_initial_schema`). Autogenerate,
  then hand-review; Postgres enums are created and dropped explicitly. Every migration has a
  working `downgrade`.
- CI/test: a pytest runs `upgrade head`, `downgrade base`, `upgrade head` on a scratch database,
  then checks `alembic check` reports no model/migration drift.
- Deploy: migrations run as a separate one-shot step before the app (compose `migrate`; ECS
  one-off task). The app never migrates on startup. Migrations must be backward compatible with
  the previous app version (expand, then contract).

### 6.6 Config and secrets
All config is environment variables read by `app/config.py` (pydantic-settings, fail fast).
`.env.example` documents every variable; `.env` is gitignored. In AWS, secrets come from Secrets
Manager injected as ECS task env (`secrets:`), non-secrets from task definition env.

| Variable | Example (local) | Notes |
|---|---|---|
| `APP_ENV` | `local` | `local`, `test`, `staging`, `production` |
| `DATABASE_URL` | `postgresql+psycopg://jobproof:jobproof@db:5432/jobproof` | dev.sh overrides host/port to 127.0.0.1:5544; secret in AWS |
| `JWT_SECRET` | dev-only 48-char string | secret; min 32 chars enforced |
| `JWT_TTL_SECONDS` | `1800` | |
| `PHOTO_URL_SECRET` | dev-only 48-char string | secret; min 32 chars |
| `PHOTO_URL_TTL_SECONDS` | `900` | |
| `PUBLIC_API_BASE_URL` | `http://localhost:8000` | used to build absolute photo URLs |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8080` | comma separated; no wildcard |
| `DEMO_ACCOUNTS_ENABLED` | `true` | must be false in production |
| `LOG_LEVEL` | `INFO` | |
| `FIXED_NOW` | unset | ISO datetime; tests only; rejected in production |
| `SEED_ANCHOR_DATE` | unset (= today, London) | seed's "today" |
| `API_BASE_URL` | `http://localhost:8000` | web container only, written to `config.js` |

Web runtime config: `index.html` loads `/config.js` (non-module, before the app) which sets
`window.__JOBPROOF_CONFIG__ = {"apiBaseUrl": "..."}`. Nothing environment-specific is compiled
into the bundle.

### 6.7 Logging
One JSON object per line on stdout via a stdlib `logging.Formatter` subclass: `ts` (UTC ISO),
`level`, `logger`, `msg`, `request_id`, and for access logs `method`, `path`, `status`,
`duration_ms`, `user_id`. A middleware assigns `request_id` (incoming `X-Request-ID` if it
matches `^[A-Za-z0-9-]{1,64}$`, else uuid4), stores it in a contextvar and returns it as
`X-Request-ID`. uvicorn's access log is disabled in favour of this. Never logged: `Authorization`,
passwords, tokens, the photo `sig` parameter (log the path only). Migrate and seed log the same way.

### 6.8 Mock data and placeholder images
- `app/seed/dataset.py` is a pure function `build_dataset(anchor: date) -> Dataset` using
  `random.Random(20261107)` and static catalogues; IDs are `uuid5(NAMESPACE, "<kind>:<natural key>")`
  so they are stable across reseeds. Dates are relative to `anchor` (default today in
  Europe/London; `SEED_ANCHOR_DATE` overrides) so "this month" always has data.
- `python -m app.seed` truncates all tables and inserts the dataset in one transaction
  (idempotent). Volumes and distribution: T-001 spec "Mock data".
- Photos: rows in `report_photos` with `storage_key = NULL` mean "generated placeholder". The
  `PlaceholderPhotoStore` renders an SVG on request from the row (stage colour scheme, job
  reference, stage label, caption, timestamp, a simple room/wall illustration), all text
  XML-escaped. No image library, no files, no network. Thumb 400x300, full 1600x1200 viewBox.
- Photo URLs are HMAC-signed (`PHOTO_URL_SECRET`) and expire; the expiry is bucketed (rounded
  up to the next 10 minutes, plus TTL) so URLs stay stable for caching. Later `S3PhotoStore`
  returns S3 presigned URLs and the contract is unchanged. Local S3 substitute when needed: MinIO.

### 6.9 Time
`app/clock.py` is the only source of "now". Business dates ("this month", overdue) use
Europe/London (`zoneinfo`, `tzdata` dependency); API datetimes are UTC with `Z`.

### 6.10 Security headers and CORS
CORS allowlist from `CORS_ALLOWED_ORIGINS`, methods GET/POST, headers `Authorization`,
`Content-Type`, `X-Request-ID`, exposes `X-Request-ID`, no credentials (bearer tokens, not
cookies). nginx sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a CSP
(`default-src 'self'; img-src 'self' <api origin>; connect-src 'self' <api origin>`) built by
the entrypoint from `API_BASE_URL`.

## 7. Testing strategy
- Backend: pytest with a real Postgres (`TEST_DATABASE_URL`). Session fixture migrates and seeds
  once with `SEED_ANCHOR_DATE=2026-10-15`, `FIXED_NOW=2026-10-15T10:00:00Z`. Phase 1 endpoints
  are read-only, so tests share the seeded data. Expected figures are computed from
  `build_dataset()` in Python, independently of the SQL services.
- Shared and web: vitest (+ Testing Library, jsdom) for formatting, hooks and components.
- E2E: Playwright (Chromium) against the running stack at `WEB_URL`; checks UI against the live
  API; uses route interception for slow/empty/error states.

## 8. Infrastructure as code (scenario 3)

Decision: **Terraform** (>= 1.15, AWS provider ~> 6.72). Reasons and trade-offs in ARCHITECTURE.md
section 11. Writing IaC is out of scope for Phase 1; `infra/README.md` lists this plan. Layout
`infra/terraform/modules/*` and `infra/terraform/envs/{staging,prod}`; remote state in S3 with
native lock file, one state per environment.

| Module | Contents |
|---|---|
| `network` | VPC, 2 AZs, public/private-app/private-db subnets, NAT gateway, VPC endpoints (ECR, logs, Secrets Manager, S3) |
| `ecr` | Backend repository, scan on push, lifecycle policy |
| `rds` | Postgres 16, private DB subnets, SG from ECS only, encryption, automated backups, Multi-AZ in prod, credentials in Secrets Manager |
| `secrets` | `DATABASE_URL`, `JWT_SECRET`, `PHOTO_URL_SECRET` (Secrets Manager), KMS key |
| `alb` | Public ALB, ACM cert, HTTPS listener, HTTP redirect, target group health check `/health` |
| `ecs_service` | Cluster, task definition (env + secrets), service with rolling deploy and circuit breaker, autoscaling, CloudWatch log group, task and execution roles, migration task definition |
| `web_static` | Private S3 bucket, CloudFront with OAC, SPA error mapping to `/index.html`, response headers policy |
| `photos_bucket` | Private S3 bucket for photos (later phase), CORS for presigned PUT/GET |
| `ci_roles` | GitHub OIDC provider and roles: terraform plan (read-only), terraform apply, backend deploy (ECR push, ECS run-task/update-service), web deploy (S3 sync, CloudFront invalidation) |
| `dns` (optional) | Route 53 records for web and API |

## 9. Implementation tickets (scenario 7)

Ordered; each is independently verifiable with the no-Docker dev path and must not break the
previous one's checks.

1. [T-001a](../tickets/T-001a-scaffold-and-stack.md) Scaffold, local stack and health endpoint.
2. [T-001b](../tickets/T-001b-data-model-and-seed.md) Data model, migrations and deterministic seed data.
3. [T-001c](../tickets/T-001c-auth-and-manager-api.md) Authentication and manager read API to the contract.
4. [T-001d](../tickets/T-001d-manager-web-ui.md) Manager web UI and end-to-end tests.

Scenario coverage of T-001: T-001 spec "Test notes".

## Out of scope
Application code, IaC code, mobile app, Stripe, Play Store listing, CI pipeline files.
