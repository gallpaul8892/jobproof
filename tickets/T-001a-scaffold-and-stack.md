# T-001a: Scaffold, local stack and health endpoint

**Persona:** Developer (internal)
**Owners:** backend-engineer (backend, compose, dev script, Makefile), frontend-engineer (npm
workspaces, shared, web shell, e2e harness)
**Depends on:** T-000 (done)
**Specs:** [specs/T-000-bootstrap.md](../specs/T-000-bootstrap.md) sections 1-6;
[ARCHITECTURE.md](../ARCHITECTURE.md) section 3 for versions.

## Context
Create the monorepo skeleton and the two ways to run it (docker compose and `scripts/dev.sh`),
with a backend that exposes `/health` and a web app that loads its runtime config and calls it.
No database tables yet: `migrate` runs an empty Alembic history and `seed` is a no-op that logs
"nothing to seed". Verification in the orchestrator workspace uses the no-Docker path; compose is
verified with `docker compose config` and by review.

## Scenarios

### 1. Layout and tooling exist
Given a fresh clone
When a developer lists the repo
Then backend, web, shared, e2e, mobile (README only), infra (README with the Terraform module
plan), api, scripts, a root Makefile with up, down, logs, seed, lint, test, e2e, gen, dev and
dev-down targets, `docker-compose.yml`, `.env.example` and npm workspaces exist as in the T-000
spec, with versions pinned per ARCHITECTURE.md

### 2. No-Docker stack starts from clean
Given no `.pgdata` or `.dev` directory and the workspace running as root
When `scripts/dev.sh up` runs
Then local Postgres 16 starts on 127.0.0.1:5544 as the postgres user, databases `jobproof` and
`jobproof_test` exist, `alembic upgrade head` and `python -m app.seed` succeed, the backend
listens on 8000, the web app on 8080, and the script prints both URLs
And running `scripts/dev.sh up` again is a no-op that reports the stack is already running
And `scripts/dev.sh down` stops all three processes

### 3. Health endpoint
Given the stack is running
When `GET http://localhost:8000/health` is called
Then it returns 200 `{"status":"ok","database":"ok","version":"0.1.0"}` matching the contract
And with Postgres stopped it returns 503 with `"database":"unavailable"` within 3 seconds

### 4. Errors, request ids and logs follow the conventions
Given the backend is running
When `GET /api/v1/does-not-exist` is called with header `X-Request-ID: abc-123`
Then the response is 404 `application/problem+json` with `code` `not_found` and `request_id`
`abc-123`, and the response header `X-Request-ID` is `abc-123`
And the backend's stdout for that request is a single JSON line with ts, level, msg, request_id,
method, path, status and duration_ms
And `/openapi.json` and `/docs` return 404

### 5. Web loads runtime config and shows API status
Given the web app is served by `vite preview` (`scripts/dev.sh up --static`) or nginx
When a browser opens http://localhost:8080
Then `/config.js` sets `window.__JOBPROOF_CONFIG__.apiBaseUrl`, and the page shows "JobProof"
and "API: ok" fetched through the generated client from `@jobproof/shared`
And with the backend stopped it shows an error state with a "Try again" button, never a blank page
And the built bundle in `web/dist` references no external origin: a test greps `dist/` for
`https?://` and allows only XML/SVG namespace URIs (for example `http://www.w3.org/2000/svg`)

### 6. Contract tooling and drift checks
Given `api/openapi.yaml` from T-000
When `make gen` runs and then `make lint`
Then `shared/src/generated` is (re)generated and committed, `redocly lint` passes,
`npm run gen:check` passes, and changing the contract without regenerating makes
`npm run gen:check` fail
And a pytest helper `assert_contract(response, operation_id)` exists, is used by the health test,
and fails when a response body violates the schema
And a route-parity test passes with every not-yet-built operation listed in
`NOT_YET_IMPLEMENTED`

### 7. Lint, unit tests and e2e harness run
Given the stack is running via `scripts/dev.sh up --static`
When `make lint`, `make test` and `scripts/dev.sh e2e` run
Then all pass, including one Playwright smoke test that opens the web app and sees "API: ok",
using Chrome from `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when set

### 8. Compose design is valid and production-like
Given Docker Compose is available (`docker compose` CLI is installed even without a daemon)
When `docker compose config --quiet` runs
Then it succeeds, and the file defines db, migrate, seed, backend and web with the dependency
conditions, healthchecks, ports (5544, 8000, 8080) and named volume from the T-000 spec
And both Dockerfiles are multi-stage, run as a non-root user, use exec-form commands and define a
healthcheck; the web image writes `config.js` from `API_BASE_URL` at container start
And `make up` prints the web, API and health URLs (credentials line added in T-001b/c)

## Out of scope
Tables, seed data, auth, manager endpoints and pages (T-001b to T-001d). Running Docker images in
this workspace (no daemon).
