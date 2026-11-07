# Developer entry points. See specs/T-000-bootstrap.md section 3.
# lint and test run on the host toolchain (uv, Node); the stack runs in Docker or via scripts/dev.sh.

.DEFAULT_GOAL := help
WEB_URL ?= http://localhost:8080
export TEST_DATABASE_URL ?= postgresql+psycopg://jobproof:jobproof@127.0.0.1:5544/jobproof_test

.PHONY: help up down logs seed lint test e2e gen dev dev-down

help:
	@echo "make up | down | logs | seed | lint | test | e2e | gen | dev | dev-down"

.env:
	cp .env.example .env

up: .env
	docker compose up -d --build --wait backend web
	@echo ""
	@echo "Web:    http://localhost:8080"
	@echo "API:    http://localhost:8000"
	@echo "Health: http://localhost:8000/health"

down:
	docker compose down $(if $(V),-v,)

logs:
	docker compose logs -f --tail=200

seed: .env
	docker compose run --rm seed

lint:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
	npm run lint
	npx --no-install redocly lint api/openapi.yaml --config api/redocly.yaml
	npm run gen:check

test:
	cd backend && uv run pytest
	npm test

e2e:
	WEB_URL=$(WEB_URL) npm run e2e

gen:
	npm run gen

dev:
	scripts/dev.sh up

dev-down:
	scripts/dev.sh down
