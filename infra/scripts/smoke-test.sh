#!/usr/bin/env bash
# Smoke test of a deployed environment through its public address (INFRA spec 5.5, 4.3).
#
#   infra/scripts/smoke-test.sh https://<distribution domain>
#
# Environment
#   SMOKE_WAIT_SECONDS   how long to wait for /health/live to answer first (default 120)
#   SMOKE_EMAIL, SMOKE_PASSWORD   optional: also sign in and read /auth/me
#   CSP_FILE             the expected policy (default: the committed csp.txt)
#
# Checks the things only the real edge can break: same-origin routing of /api and /health, SPA
# deep links, problem+json (not HTML) for API errors, the response headers, and config.js.
# Exits non-zero on the first failure, naming it. Never prints credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE="${1:-}"
CSP_FILE="${CSP_FILE:-$ROOT/infra/terraform/modules/web_static/csp.txt}"
WAIT="${SMOKE_WAIT_SECONDS:-120}"

fail() { printf 'smoke-test: FAIL: %s\n' "$*" >&2; exit 1; }
ok() { printf 'smoke-test: ok: %s\n' "$*"; }

[ -n "$SITE" ] || fail "usage: smoke-test.sh https://<site>"
SITE="${SITE%/}"
case "$SITE" in http://*|https://*) ;; *) fail "the address must start with http:// or https://" ;; esac
[ -f "$CSP_FILE" ] || fail "$CSP_FILE not found"

TMP="$(mktemp -d)"
cleanup() { if [ -n "${TMP:-}" ] && [ -d "$TMP" ]; then rm -rf -- "$TMP"; fi; }
trap cleanup EXIT

# get PATH [curl options...]: writes headers to $TMP/h and the body to $TMP/b, sets STATUS.
get() {
  local path="$1"; shift
  STATUS="$(curl -sS --max-time 20 -o "$TMP/b" -D "$TMP/h" -w '%{http_code}' "$@" "$SITE$path")" \
    || fail "$path: the request failed"
}
header() { # header NAME: value of a response header, lower-cased name, trimmed
  awk -v n="$(printf '%s' "$1" | tr 'A-Z' 'a-z')" 'BEGIN{FS=":"} {k=tolower($1)} k==n {sub(/^[^:]*:[ \t]*/, ""); sub(/\r$/, ""); print; exit}' "$TMP/h"
}
body_has() { grep -q -- "$1" "$TMP/b"; }

# ---- wait for the service ----------------------------------------------------------------
deadline=$((SECONDS + WAIT))
while :; do
  STATUS="$(curl -sS --max-time 10 -o "$TMP/b" -w '%{http_code}' "$SITE/health/live" 2>/dev/null || echo 000)"
  [ "$STATUS" = "200" ] && break
  [ "$SECONDS" -ge "$deadline" ] && fail "/health/live did not return 200 within ${WAIT}s (last: $STATUS)"
  sleep 5
done
body_has '"status"[[:space:]]*:[[:space:]]*"ok"' || fail "/health/live body is not {status: ok}"
ok "/health/live"

get /health
[ "$STATUS" = "200" ] || fail "/health returned $STATUS (database not ready?)"
body_has '"database"[[:space:]]*:[[:space:]]*"ok"' || fail "/health does not report database ok"
ok "/health (database ok)"

# ---- the single-page app --------------------------------------------------------------------
get /
[ "$STATUS" = "200" ] || fail "/ returned $STATUS"
case "$(header content-type)" in text/html*) ;; *) fail "/ is not text/html" ;; esac
body_has 'id="root"' || fail "/ does not look like the app shell"
ok "/ serves the app shell"

EXPECTED_CSP="$(cat "$CSP_FILE")"
[ "$(header content-security-policy)" = "$EXPECTED_CSP" ] \
  || fail "Content-Security-Policy differs from csp.txt"
[ "$(header x-content-type-options)" = "nosniff" ] || fail "X-Content-Type-Options is not nosniff"
[ "$(header referrer-policy)" = "no-referrer" ] || fail "Referrer-Policy is not no-referrer"
[ "$(header x-frame-options)" = "DENY" ] || fail "X-Frame-Options is not DENY"
case "$SITE" in
  https://*) case "$(header strict-transport-security)" in max-age=*) ;; *) fail "Strict-Transport-Security is missing" ;; esac ;;
esac
ok "security headers (CSP identical to csp.txt)"

get /reports
[ "$STATUS" = "200" ] && body_has 'id="root"' || fail "/reports (a deep link) is not served the app shell"
ok "SPA deep link"

get /config.js
[ "$STATUS" = "200" ] || fail "/config.js returned $STATUS"
body_has "\"apiBaseUrl\": \"$SITE\"" || fail "/config.js apiBaseUrl is not $SITE"
ok "/config.js points at this site"

# The first script the page loads must exist (catches a half-uploaded bundle).
get /
ASSET="$(grep -Eo '/assets/[A-Za-z0-9._-]+\.js' "$TMP/b" | head -n 1 || true)"
[ -n "$ASSET" ] || fail "index.html references no /assets/*.js"
get "$ASSET"
[ "$STATUS" = "200" ] || fail "$ASSET returned $STATUS"
ok "$ASSET"

# ---- the API through the same origin --------------------------------------------------------
get /api/v1/branding
[ "$STATUS" = "200" ] || fail "/api/v1/branding returned $STATUS"
case "$(header content-type)" in application/json*) ;; *) fail "/api/v1/branding is not JSON" ;; esac
body_has '"company_name"' || fail "/api/v1/branding has no company_name"
ok "/api/v1/branding"

get /api/v1/does-not-exist
[ "$STATUS" = "404" ] || fail "an unknown API path returned $STATUS, expected 404"
case "$(header content-type)" in application/problem+json*) ;; *) fail "an unknown API path did not return problem+json (the SPA fallback is leaking into /api)" ;; esac
ok "unknown API path is problem+json 404"

get /api/v1/manager/dashboard
[ "$STATUS" = "401" ] || fail "/api/v1/manager/dashboard without a token returned $STATUS, expected 401"
case "$(header content-type)" in application/problem+json*) ;; *) fail "the 401 is not problem+json" ;; esac
ok "protected route refuses anonymous callers"

# ---- optional sign-in -----------------------------------------------------------------------
if [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  printf '{"email": "%s", "password": "%s"}' "$SMOKE_EMAIL" "$SMOKE_PASSWORD" > "$TMP/login.json"
  get /api/v1/auth/login -X POST -H 'Content-Type: application/json' --data-binary "@$TMP/login.json"
  [ "$STATUS" = "200" ] || fail "sign-in returned $STATUS"
  TOKEN="$(sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP/b")"
  [ -n "$TOKEN" ] || fail "sign-in returned no access_token"
  get /api/v1/auth/me -H "Authorization: Bearer $TOKEN"
  [ "$STATUS" = "200" ] || fail "/api/v1/auth/me returned $STATUS"
  ok "sign-in and /auth/me"
fi

echo "smoke-test: all checks passed for $SITE"
