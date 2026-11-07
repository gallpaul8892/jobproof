# T-000: Bootstrap architecture and repo foundation

**Persona:** Developer (internal)
**Owner:** architect (spec and docs only; implementers build from the resulting specs)

## Context
New product: FastAPI backend, React web app, React Native (Expo) mobile app, Postgres on RDS,
ECS Fargate + S3/CloudFront on AWS. About 10 tables eventually, 3 personas (Manager, Painter,
Customer). Nothing exists yet except CLAUDE.md, agent definitions and tickets. Read
/tickets/T-001-manager-view.md, because the foundation must support it as the first feature.

## Scenarios

### 1. Architecture document exists
Given an empty repository with CLAUDE.md
When the architect completes this ticket
Then ARCHITECTURE.md exists with: system overview, components, verified stack versions, AWS
deployment layout, local run instructions, patterns in use, personas and permissions, and key
decisions with reasons

### 2. Repo layout is defined
Given the stack decisions in the architect's definition
When the architect specifies the layout
Then /specs/T-000-bootstrap.md describes a monorepo with backend, web, mobile, shared
(generated API client and types), e2e, infra, api, specs and tickets directories, plus a root
Makefile with up, down, logs, seed, lint, test and e2e targets

### 3. Infrastructure tooling is chosen
Given Terraform and CDK are both viable
When the architect makes the choice
Then the decision and trade-offs are in ARCHITECTURE.md, and the spec lists the IaC modules
needed (network, RDS, ECS service, ALB, S3/CloudFront, secrets, CI/CD roles). Writing the IaC
itself is out of scope for this phase

### 4. Local environment is specified
Given a developer with Docker installed
When they follow the local run instructions
Then docker compose starts db, migrate, seed, backend and web with one command, and the health
endpoint responds. The spec also says how to run each service without Docker for development

### 5. API contract workflow is specified
Given /api/openapi.yaml is the source of truth
When the spec describes how clients are produced
Then it defines how the TypeScript client and types are generated and shared by web and mobile,
and how contract drift is detected

### 6. Cross-cutting concerns are decided
Given every feature depends on them
When the architect writes the spec
Then it defines authentication (for Phase 1: seeded mock users and short-lived JWT), the
three-persona authorisation model, error response format, pagination and filtering conventions,
the Alembic workflow, config and secrets handling, logging format, and mock-data and
placeholder-image strategy (no external network)

### 7. Work is broken down
Given T-001 is the first feature
Then the spec ends with an ordered list of at most four implementation tickets (for example:
scaffold and compose stack with health endpoint; data model, migrations and seed data; manager
auth and read APIs; manager web UI), each with Given/When/Then scenarios, written as files
/tickets/T-001a-*.md, T-001b-*.md and so on, so the orchestrator can delegate them one by one.
Each must be independently verifiable

### 8. T-001 is specified at feature level
Then /specs/T-001-manager-view.md contains the data model, the OpenAPI contract for all manager
read endpoints (written to /api/openapi.yaml), the UI screens and states, and the mock data
volume and distribution

## Out of scope
Application code, IaC code, the mobile app, Stripe, Play Store listing, CI pipeline files.

## Open questions
Architect lists anything it cannot decide without the product owner and states the default it
assumed.
