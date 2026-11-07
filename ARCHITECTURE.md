# JobProof architecture

Owner: architect. This is the system's memory: read it first, edit sections in place, link to
files instead of copying code. Entries marked **(planned)** are specified but not yet built.
Last updated: 2026-11-07 (T-000 bootstrap).

## 1. System overview

Painters finish a job, photograph it and submit a completion report (mobile, later). Head-office
managers review reports and billing in a web app (Phase 1). Customers pay quotes/invoices by a
secure Stripe link (later). One FastAPI backend serves all clients through one versioned REST API
described by [api/openapi.yaml](api/openapi.yaml).

```
 Manager browser ──> Web SPA (S3+CloudFront | nginx locally) ──┐
 Painter phone   ──> Expo app (later) ─────────────────────────┤ HTTPS JSON, Bearer JWT
 Customer        ──> payment link page (later) ────────────────┤
                                                               v
                                   FastAPI backend (ECS Fargate | container | uvicorn)
                                      │                 │
                                 PostgreSQL 16     Photo store (Phase 1: generated SVG;
                                 (RDS | container)   later: S3, MinIO locally)
```

Phase 1 scope: manager persona, read-only, deterministic mock data, runs offline.

## 2. Components and responsibilities (planned)

| Path | Responsibility |
|---|---|
| `backend/` | FastAPI app, SQLAlchemy models, Alembic migrations, seed, auth, placeholder photo renderer. Python 3.13, managed by uv. |
| `web/` | React SPA for managers. Vite build is static; served by nginx (local) or S3/CloudFront (AWS). Reads runtime `config.js`. |
| `shared/` | npm workspace `@jobproof/shared`: generated API client and types, TanStack Query hooks, formatting, token storage interface. Consumed by web now and mobile later. |
| `mobile/` | Expo app (later phase). Placeholder README only in Phase 1. |
| `e2e/` | Playwright tests against a running stack (compose or dev script). |
| `api/openapi.yaml` | The contract. Hand-written, OpenAPI 3.1. Backend conforms; clients are generated from it. |
| `infra/` | Terraform (later phase). Phase 1 holds only `infra/README.md` with the module plan. |
| `scripts/dev.sh` | No-Docker dev path: local Postgres, migrate, seed, backend, web. |
| `docker-compose.yml`, `Makefile` | One-command local stack and developer commands. |

Full layout: [specs/T-000-bootstrap.md](specs/T-000-bootstrap.md) section "Repo layout".

## 3. Stack versions (verified 2026-11-07 against PyPI / npm registry)

Pin exact versions in lockfiles (`backend/uv.lock`, root `package-lock.json`). Ranges below are
what manifests should declare.

| Area | Package | Version | Notes |
|---|---|---|---|
| Runtime | Python | 3.13 | `python:3.13-slim` image; local 3.13.18 |
| Runtime | Node | 22 LTS (>=22.22) | `node:22-alpine` build image; local 22.23.4. react-router 8 needs >=22.22, hey-api >=22.18 |
| Tooling | uv | 0.11.x | local 0.11.32 |
| Backend | fastapi | 0.162.1 | |
| Backend | uvicorn | 0.54.0 | `uvicorn[standard]` not needed; plain `uvicorn` |
| Backend | sqlalchemy | 2.1.8 | sync engine and ORM 2.0-style |
| Backend | alembic | 1.20.1 | |
| Backend | pydantic / pydantic-settings | 2.14.3 / 2.16.2 | |
| Backend | psycopg[binary] | 3.3.8 | driver URL `postgresql+psycopg://` |
| Backend | pyjwt | 2.15.1 | HS256 |
| Backend | argon2-cffi | 25.1.0 | argon2id password hashes |
| Backend | tzdata | 2026.6 | zoneinfo data for Europe/London in slim images |
| Backend dev | pytest 9.2.0, httpx 0.28.1, ruff 0.17.4, mypy 2.4.1, jsonschema 4.26.0, pyyaml 6.0.3 | | |
| Web | react / react-dom | 19.3.1 | |
| Web | react-router | 8.5.1 | data mode (`createBrowserRouter`), import from `react-router` and `react-router/dom` |
| Web | @tanstack/react-query | 5.107.1 | shared hooks |
| Web | vite / @vitejs/plugin-react | 8.3.6 / 6.2.1 | |
| Web | typescript | 6.0.3 | TS 7 deferred, see section 11 |
| Web dev | vitest 5.1.0, jsdom 31.0.0, @testing-library/react 16.3.3, @testing-library/user-event 14.6.8 | | |
| Web dev | eslint 10.14.0, @eslint/js 10.0.1, typescript-eslint 8.72.1, eslint-plugin-react-hooks 7.1.1, globals 17.14.0 | | |
| Contract | @hey-api/openapi-ts | 0.99.0 (exact) | 0.x churns: pin exactly; fetch client is bundled |
| Contract | @redocly/cli | 2.76.0 | `redocly lint` with [api/redocly.yaml](api/redocly.yaml) |
| E2E | @playwright/test | 1.65.0 | |
| DB | PostgreSQL | 16 | `postgres:16-alpine` image, RDS engine 16.x; local server /usr/lib/postgresql/16 |
| Web serve | nginx | `nginxinc/nginx-unprivileged:stable-alpine` | tag not verifiable from this workspace (Docker Hub blocked); implementer pins the current stable tag |
| IaC | Terraform / AWS provider | 1.15.x / ~> 6.72 | provider 6.72.0 released 2026-11-04 |

## 4. Data model summary

Full columns: [specs/T-001-manager-view.md](specs/T-001-manager-view.md) section "Data".
All PKs are UUID. Money is integer pence plus `currency` CHAR(3) = 'GBP'. Timestamps are
`timestamptz` (UTC); calendar dates are `date`. Enums are Postgres native enums created by Alembic.

| Table | Purpose | Phase |
|---|---|---|
| `users` | Login accounts; `role` manager or painter | 1 (planned) |
| `customers` | Homeowners, landlords, businesses; no login | 1 (planned) |
| `jobs` | A piece of work at a site address for a customer, assigned painter | 1 (planned) |
| `quotes` | Price and optional deposit for a job | 1 (planned) |
| `job_reports` | Painter's completion report, one per job, manager review status | 1 (planned) |
| `report_checklist_items` | Work checklist lines on a report | 1 (planned) |
| `report_photos` | Before/during/after photo metadata; `storage_key` null = generated placeholder | 1 (planned) |
| `invoices` | Bill for a job; stored status draft/sent/paid/void, display status derived | 1 (planned) |
| `payments` | Deposit (against quote) or invoice payment | 1 (planned) |
| `invoice_line_items` | Itemised invoice lines | sketch, later |
| `payment_links` | Customer Stripe checkout links (capability token) | sketch, later |

Derived invoice status (one pure function, `backend/app/services/billing.py`, planned):
`void` > `draft` > `paid` (balance 0) > `overdue` (due date before today, Europe/London) >
`part_paid` > `sent`.

## 5. API conventions

- Base path `/api/v1`; health at `/health` (unversioned, for ALB and compose).
- JSON, snake_case fields. UUIDs as strings. Datetimes ISO 8601 UTC with `Z`. Dates `YYYY-MM-DD`.
- Money: `*_pence` integers plus `currency: "GBP"`.
- Auth: `Authorization: Bearer <jwt>`. Photo images use short-lived signed URLs (no header).
- Errors: RFC 9457 `application/problem+json` with extra `code` and `request_id`; validation
  adds `errors[]`. Codes are stable machine strings (`invalid_credentials`, `forbidden`...).
- Pagination: `page` (1-based), `page_size` (default 20, max 100); response
  `{items, total, page, page_size}`. Offset based (data volumes are small).
- Filters: one query param per field, single value; `q` is a case-insensitive contains search;
  date ranges `date_from`/`date_to` inclusive London calendar days. Fixed server-side sort.
- Every response carries `X-Request-ID` (echoed if the client sent one).
- Contract workflow and drift detection: [specs/T-000-bootstrap.md](specs/T-000-bootstrap.md) section 5.

## 6. Patterns in use (planned)

| Pattern | Where | Why |
|---|---|---|
| Strategy | `backend/app/photos/store.py`: `PhotoStore` protocol, `PlaceholderPhotoStore` (Phase 1), `S3PhotoStore` (later) | Photo bytes and URLs come from different backends per phase/environment; callers only ask for `url_for(photo, variant)` |
| Strategy | `shared/src/auth/tokenStore.ts`: `TokenStore` interface; `web/src/auth/sessionTokenStore.ts` (web), SecureStore impl in mobile (later) | Same auth hooks, platform-specific persistence |
| Adapter | `shared/src/api/client.ts` wraps the generated client: base URL from runtime config, bearer header, Problem errors to `ApiError` | Keeps generated code untouched and UI code independent of generator output |
| (none) | Authorisation | Router-level `require_roles(...)` dependency is enough while rules are role-only. Revisit as a per-persona Policy (Strategy) when painter ownership rules arrive |
| (none) | Invoice status | A pure function, not State: no transitions in Phase 1 |

## 7. Personas and permissions

| Capability | Manager | Painter | Customer | Anonymous |
|---|---|---|---|---|
| `GET /health`, `POST /auth/login`, `GET /auth/demo-accounts` (when enabled) | yes | yes | n/a | yes |
| `GET /auth/me` | yes | yes | n/a | 401 |
| `GET /manager/*` (dashboard, reports, invoices, painters) | yes | 403 | n/a | 401 |
| `GET /photos/{id}/image` with valid signature | yes (via URL) | later | later | signed URL only |
| Painter capture endpoints | later | own jobs | | |
| Customer payment link | | | token in link (later) | |

Customers never get user accounts; they act through capability tokens in payment links (later).
The web app only renders manager pages for `role == manager`; a painter sees a "not for
painters" page.

## 8. Authentication (Phase 1)

Seeded users with argon2id hashes. `POST /api/v1/auth/login` returns an HS256 JWT
(`sub`, `role`, `iat`, `exp`, `iss=jobproof`, `aud=jobproof-api`), TTL 30 min, no refresh token.
The backend reloads the user on each request (honours `is_active`, role from DB). Web keeps the
token in `sessionStorage`; on 401 it clears it and redirects to `/login`. Later: refresh tokens
and possibly Cognito; the bearer contract stays the same.

## 9. AWS deployment layout (planned, later phase)

Terraform in `infra/terraform/`: `modules/{network, ecr, rds, secrets, alb, ecs_service,
web_static, photos_bucket, ci_roles}` and `envs/{staging,prod}`; state in S3 with native lockfile.

- VPC across 2 AZs: public subnets (ALB, NAT), private app subnets (Fargate tasks), private DB
  subnets (RDS Postgres 16, Multi-AZ in prod).
- ECS Fargate service running the backend image behind an ALB (HTTPS, ACM cert, health check
  `/health`). Task role reads Secrets Manager (`DATABASE_URL`, `JWT_SECRET`, `PHOTO_URL_SECRET`).
- Deploy: CI builds image, pushes to ECR, runs a one-off ECS task `alembic upgrade head`, then
  updates the service (rolling). Logs to CloudWatch (JSON from stdout).
- Web: `vite build` output to a private S3 bucket behind CloudFront (OAC); SPA fallback to
  `index.html`; per-environment `config.js` uploaded with `Cache-Control: no-cache`.
- Photos (later): private S3 bucket, presigned URLs via `S3PhotoStore`.
- CI/CD: GitHub OIDC roles for plan, apply, backend deploy, web deploy.

## 10. Local run

- Docker (user's machine): `make up` runs `docker compose up -d --build --wait` (db, migrate,
  seed, backend, web). Web http://localhost:8080, API http://localhost:8000 (no Swagger UI:
  it needs a CDN; the contract file is the docs). `make down`, `make logs`, `make seed`.
- No Docker (orchestrator workspace, dev): `scripts/dev.sh up` starts local Postgres 16 on
  127.0.0.1:5544 (data in `.pgdata/`, run as the `postgres` user when invoked as root), migrates,
  seeds, runs uvicorn on 8000 and Vite on 8080. `scripts/dev.sh down|status|test|e2e`.
- Same URLs in both paths. Demo credentials are shown on the login page.
- First `docker compose build` / `npm ci` / `uv sync` needs network; running afterwards needs none.
- Details: [specs/T-000-bootstrap.md](specs/T-000-bootstrap.md) section 4.

## 11. Key decisions

| Decision | Reason |
|---|---|
| Terraform over CDK | Declarative HCL with reviewable `plan` diffs (human and code-review agent); no synth step or extra language runtime; mature AWS provider; S3 native state locking. CDK's higher-level constructs and shared TypeScript were attractive, but CloudFormation drift handling, stack limits and synthesised diffs are harder to review. |
| Contract-first, hand-written OpenAPI 3.1 | One source of truth for web and mobile; backend is tested against it rather than generating it. |
| @hey-api/openapi-ts with bundled fetch client | Generates types and SDK in one tool, no runtime dependency beyond the bundled client; openapi-typescript 7 still peers on TypeScript 5. |
| Sync SQLAlchemy + psycopg 3 | Read-only, low traffic; sync is simpler to test and FastAPI runs sync endpoints in its threadpool. |
| Generated SVG placeholder photos | Zero image dependencies, deterministic, offline, tiny. Served via signed URLs to match the later S3 presigned-URL shape. |
| Stdlib `logging` JSON formatter | Avoids structlog for a small surface. |
| Plain CSS (CSS modules) and system fonts | No UI kit, no font downloads, offline. |
| TanStack Query in shared hooks | Loading/error/retry semantics once, reused by mobile. |
| CORS with explicit allowlist instead of same-origin proxy | Mirrors production (CloudFront domain to ALB API domain); mobile unaffected. |
| Overdue/part-paid are derived, not stored | Always consistent with payments and today's date. |
| Injectable clock (`FIXED_NOW`, non-production only) | Deterministic tests of "this month" figures. |

## 12. Deliberate dependency deferrals

| Package | Held at | Reason | Revisit |
|---|---|---|---|
| typescript 7.x | 6.0.3 | typescript-eslint 8.72.1 peers `<6.1.0` and TS 7 exposes no compiler API yet (typescript-eslint issue #12518) | 2027-02-01 or when typescript-eslint supports TS 7 |
| @types/node 26 | 22.x | Match Node 22 runtime | with Node runtime upgrade |
| structlog, UI kits, axios | not used | Lean phase 1 | when a need appears |
