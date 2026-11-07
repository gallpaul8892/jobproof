# JobProof (working name)

## Product
Painters and decorators finish a job, photograph the work in a mobile app and submit a
completion report. Head-office managers review those reports in a web app; the reports and
photos are evidence used to bill customers. Customers later pay by secure Stripe link. Quotes
work the same way, with a deposit taken before work starts.

Personas: **Manager** (head office), **Painter** (field), **Customer** (pays via link), **Admin**
(company settings: name, colour scheme).

## Current phase
Phase 2a (ticket epic [T-002](tickets/T-002-admin-branding-review-workflow.md)): **Manager and
Admin personas, mock data, web app only.** **This ends Phase 1's read-only constraint.** Write
endpoints now exist for: Admin settings (company name, colour scheme), marking reports reviewed,
and manager edits to report notes and checklist (audited, optimistic concurrency). Report photos
stay read-only. Deployment model: one deployment per company, configured by a settings record;
true multi-tenancy is deliberately deferred (decision D1 in T-002). Still out of scope: painter
capture (Expo), customer payment (Stripe), quotes and deposits, AWS deployment. The mock data is
still painting and decorating; UI wording is industry-neutral (T-002l).

## Stack (fixed)
- Backend: FastAPI (Python 3.13), SQLAlchemy 2.x, Alembic, Pydantic v2, PostgreSQL
- Web: React + TypeScript + Vite; API client generated from /api/openapi.yaml
- Mobile (later): React Native + Expo, sharing the generated client with web
- AWS target: ECS Fargate (backend), RDS Postgres, S3 + CloudFront (web), IaC in /infra
- Local: docker compose runs db, migrate, seed, backend and web with one command
- Use the latest stable versions; record the versions in ARCHITECTURE.md

## Layout
backend/ web/ mobile/ shared/ infra/ api/ (OpenAPI) specs/ tickets/ reports/ scripts/

## Commands (the scaffold ticket creates the Makefile)
- `make up` / `make down` / `make logs` : run the full stack locally
- `make seed` : (re)load mock data
- `make lint` / `make test` / `make e2e`
- `python3 scripts/progress.py ...` : update progress.json and progress.html (see ORCHESTRATOR.md)

## Conventions
- Contract first: /api/openapi.yaml is the source of truth between backend and clients.
- Config via environment variables only. No secrets in git. `.env.example` is committed.
- Services are stateless and log structured JSON to stdout.
- Server-side authorisation on every endpoint, by persona.
- Money is stored as integer pence with currency GBP. Dates are UTC in the API.
- Mock data is realistic UK painting and decorating data. No external network is needed to run
  the app, including images (photos are generated placeholders).
- Tickets are Given/When/Then in /tickets; specs live in /specs/<ticket-id>.md.

## Definition of done (per ticket)
Spec implemented, lint and type-check clean, unit/API tests and e2e tests pass, code review
APPROVE, ARCHITECTURE.md updated by the architect, progress page updated, work committed.
