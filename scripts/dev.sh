#!/usr/bin/env bash
# No-Docker dev path: local Postgres 16, migrate, seed, backend and web.
# See specs/T-000-bootstrap.md section 4.2.
#
#   scripts/dev.sh up [--static]   start everything (idempotent); --static serves a production build
#   scripts/dev.sh down            stop web, backend and the local Postgres
#   scripts/dev.sh status          show processes and /health
#   scripts/dev.sh seed            re-run the seed
#   scripts/dev.sh test            run make test against the local Postgres
#   scripts/dev.sh e2e             ensure the stack is up (static), run make e2e
#   scripts/dev.sh psql [args]     open psql on the dev database
#
# Environment: PG_BIN (Postgres binaries), SKIP_WEB=1 (backend and database only).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="$ROOT/.dev"
PG_ROOT="$ROOT/.pgdata"
PG_DATA="$PG_ROOT/data"
PG_RUN="$PG_ROOT/run"
PG_PORT=5544
BACKEND_PORT="${BACKEND_PORT:-8000}"
WEB_PORT="${WEB_PORT:-8080}"
PG_PASSWORD=jobproof
export DEV_DATABASE_URL="postgresql+psycopg://jobproof:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/jobproof"
export DEV_TEST_DATABASE_URL="postgresql+psycopg://jobproof:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/jobproof_test"

log() { printf '[dev] %s\n' "$*"; }
die() { printf '[dev] error: %s\n' "$*" >&2; exit 1; }

# ---- Postgres helpers -------------------------------------------------------

find_pg_bin() {
  if [[ -n "${PG_BIN:-}" ]]; then echo "$PG_BIN"; return; fi
  if [[ -x /usr/lib/postgresql/16/bin/pg_ctl ]]; then echo /usr/lib/postgresql/16/bin; return; fi
  if command -v pg_config >/dev/null 2>&1; then pg_config --bindir; return; fi
  die "Postgres 16 binaries not found; set PG_BIN"
}

as_postgres() {
  if [[ $EUID -eq 0 ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

pg_accepting() {
  "$(find_pg_bin)/pg_isready" -q -h 127.0.0.1 -p "$PG_PORT"
}

psql_dev() {
  PGPASSWORD="$PG_PASSWORD" "$(find_pg_bin)/psql" -h 127.0.0.1 -p "$PG_PORT" -U jobproof "$@"
}

cluster_is_ours() { [[ -f "$PG_DATA/PG_VERSION" ]]; }

start_postgres() {
  local bin
  bin="$(find_pg_bin)"
  mkdir -p "$DEV_DIR" "$PG_RUN"
  if pg_accepting; then
    log "Postgres already accepting connections on 127.0.0.1:$PG_PORT"
  else
    if ! cluster_is_ours; then
      log "initialising Postgres cluster in $PG_DATA"
      local pwfile="$PG_ROOT/pwfile"
      mkdir -p "$PG_ROOT"
      printf '%s\n' "$PG_PASSWORD" > "$pwfile"
      if [[ $EUID -eq 0 ]]; then chown -R postgres: "$PG_ROOT"; fi
      as_postgres "$bin/initdb" -D "$PG_DATA" --username=jobproof --auth=scram-sha-256 \
        --pwfile="$pwfile" --encoding=UTF8 >"$DEV_DIR/initdb.log" 2>&1 \
        || { cat "$DEV_DIR/initdb.log" >&2; die "initdb failed"; }
      rm -f "$pwfile"
    fi
    if [[ $EUID -eq 0 ]]; then
      chown -R postgres: "$PG_ROOT"
      : >> "$DEV_DIR/postgres.log"
      chown postgres: "$DEV_DIR/postgres.log"
    fi
    log "starting Postgres on 127.0.0.1:$PG_PORT"
    as_postgres "$bin/pg_ctl" -D "$PG_DATA" \
      -o "-p $PG_PORT -k $PG_RUN -c listen_addresses=127.0.0.1" \
      -l "$DEV_DIR/postgres.log" start -w >/dev/null \
      || { tail -n 20 "$DEV_DIR/postgres.log" >&2; die "Postgres failed to start"; }
  fi
  local name
  for name in jobproof jobproof_test; do
    if [[ -z "$(psql_dev -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$name'")" ]]; then
      log "creating database $name"
      psql_dev -d postgres -qc "CREATE DATABASE $name" >/dev/null
    fi
  done
}

stop_postgres() {
  if cluster_is_ours && [[ -f "$PG_DATA/postmaster.pid" ]]; then
    log "stopping Postgres"
    as_postgres "$(find_pg_bin)/pg_ctl" -D "$PG_DATA" stop -m fast >/dev/null
  elif pg_accepting; then
    log "Postgres on port $PG_PORT is not managed by this script (compose db?); leaving it running"
  fi
}

# ---- process helpers --------------------------------------------------------

pid_alive() {
  local file="$1"
  [[ -f "$file" ]] && kill -0 "$(cat "$file")" 2>/dev/null
}

# Start "$@" in its own session so the whole process group can be stopped later.
start_process() {
  local name="$1"; shift
  mkdir -p "$DEV_DIR"
  setsid nohup "$@" >> "$DEV_DIR/$name.log" 2>&1 < /dev/null &
  echo $! > "$DEV_DIR/$name.pid"
}

stop_process() {
  local name="$1" file="$DEV_DIR/$1.pid"
  if ! pid_alive "$file"; then rm -f "$file"; log "$name is not running"; return; fi
  local pid i
  pid="$(cat "$file")"
  log "stopping $name (pid $pid)"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for i in $(seq 1 100); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    log "$name did not exit after 10s; killing"
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

wait_for_url() {
  local url="$1" name="$2" logfile="$3" i
  for i in $(seq 1 60); do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then return 0; fi
    sleep 1
  done
  printf '[dev] %s did not become ready at %s; last log lines:\n' "$name" "$url" >&2
  tail -n 30 "$logfile" >&2 || true
  exit 1
}

# ---- environment ------------------------------------------------------------

load_env() {
  if [[ ! -f "$ROOT/.env" ]]; then
    log "creating .env from .env.example"
    cp "$ROOT/.env.example" "$ROOT/.env"
  fi
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
  export DATABASE_URL="$DEV_DATABASE_URL"
  export TEST_DATABASE_URL="$DEV_TEST_DATABASE_URL"
}

prepare_backend() {
  (cd "$ROOT/backend" && uv sync --frozen)
}

prepare_web() {
  if [[ -n "${SKIP_WEB:-}" ]]; then return; fi
  [[ -f "$ROOT/package.json" ]] || die "package.json not found (frontend half missing); use SKIP_WEB=1 for backend only"
  if [[ ! -d "$ROOT/node_modules" ]]; then
    log "installing npm dependencies"
    (cd "$ROOT" && npm ci)
  fi
}

backend_running() { pid_alive "$DEV_DIR/backend.pid"; }
web_running() { pid_alive "$DEV_DIR/web.pid"; }

# ---- commands ---------------------------------------------------------------

cmd_up() {
  local static=0 arg
  for arg in "$@"; do
    case "$arg" in
      --static) static=1 ;;
      *) die "unknown option: $arg" ;;
    esac
  done
  mkdir -p "$DEV_DIR"

  if pg_accepting && backend_running && { [[ -n "${SKIP_WEB:-}" ]] || web_running; }; then
    log "stack is already running"
    print_urls
    return 0
  fi

  start_postgres
  prepare_backend
  prepare_web
  load_env

  if ! backend_running; then
    log "applying migrations and seed"
    (cd "$ROOT/backend" && .venv/bin/alembic upgrade head && .venv/bin/python -m app.seed) >> "$DEV_DIR/backend.log" 2>&1 \
      || { tail -n 30 "$DEV_DIR/backend.log" >&2; die "migrate or seed failed"; }
    log "starting backend on 127.0.0.1:$BACKEND_PORT"
    cd "$ROOT/backend"
    start_process backend .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" \
      --proxy-headers --timeout-graceful-shutdown 20
    cd "$ROOT"
  fi

  if [[ -z "${SKIP_WEB:-}" ]] && ! web_running; then
    cd "$ROOT"
    if [[ $static -eq 1 ]]; then
      log "building web"
      npm run build -w @jobproof/web >> "$DEV_DIR/web.log" 2>&1 \
        || { tail -n 30 "$DEV_DIR/web.log" >&2; die "web build failed"; }
      log "starting web preview on 127.0.0.1:$WEB_PORT"
      start_process web npm run preview -w @jobproof/web -- --host 127.0.0.1 --port "$WEB_PORT" --strictPort
    else
      log "starting web dev server on 127.0.0.1:$WEB_PORT"
      start_process web npm run dev -w @jobproof/web -- --host 127.0.0.1 --port "$WEB_PORT" --strictPort
    fi
  fi

  wait_for_url "http://127.0.0.1:$BACKEND_PORT/health" backend "$DEV_DIR/backend.log"
  if [[ -z "${SKIP_WEB:-}" ]]; then
    wait_for_url "http://127.0.0.1:$WEB_PORT/" web "$DEV_DIR/web.log"
  fi
  print_urls
}

print_urls() {
  echo ""
  if [[ -z "${SKIP_WEB:-}" ]]; then echo "Web:    http://localhost:$WEB_PORT"; fi
  echo "API:    http://localhost:$BACKEND_PORT"
  echo "Health: http://localhost:$BACKEND_PORT/health"
}

cmd_down() {
  stop_process web
  stop_process backend
  stop_postgres
}

cmd_status() {
  if pg_accepting; then echo "postgres: up (127.0.0.1:$PG_PORT)"; else echo "postgres: down"; fi
  if backend_running; then echo "backend:  up (pid $(cat "$DEV_DIR/backend.pid"))"; else echo "backend:  down"; fi
  if web_running; then echo "web:      up (pid $(cat "$DEV_DIR/web.pid"))"; else echo "web:      down"; fi
  if backend_running; then
    printf 'health:   '
    curl -sS --max-time 3 "http://127.0.0.1:$BACKEND_PORT/health" || echo "unreachable"
    echo ""
  fi
}

cmd_seed() {
  load_env
  (cd "$ROOT/backend" && .venv/bin/python -m app.seed)
}

cmd_test() {
  start_postgres
  prepare_backend
  load_env
  cd "$ROOT"
  make test
}

cmd_e2e() {
  cmd_up --static
  load_env
  if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ]] && command -v google-chrome >/dev/null 2>&1; then
    PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(command -v google-chrome)"
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE
  fi
  cd "$ROOT"
  make e2e
}

cmd_psql() {
  psql_dev -d jobproof "$@"
}

main() {
  local command="${1:-}"
  [[ $# -gt 0 ]] && shift
  case "$command" in
    up) cmd_up "$@" ;;
    down) cmd_down ;;
    status) cmd_status ;;
    seed) cmd_seed ;;
    test) cmd_test ;;
    e2e) cmd_e2e ;;
    psql) cmd_psql "$@" ;;
    *) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; [[ -z "$command" || "$command" == help ]] || exit 1 ;;
  esac
}

main "$@"
