#!/bin/sh
# Runs at container start (nginx image runs /docker-entrypoint.d/*.sh as the nginx user).
# Writes the runtime config.js and the security-header include from API_BASE_URL.
set -eu

API_BASE_URL="${API_BASE_URL-http://localhost:8000}"  # unset -> default; empty is rejected below
DIST_DIR="${DIST_DIR:-/usr/share/nginx/html}"
HEADERS_FILE="${HEADERS_FILE:-/tmp/jobproof-headers.conf}"

# The API origin goes into a CSP header and a JS string, so accept only a plain
# scheme://host[:port] origin. Reject control characters (newline, CR, tab, ...) first: grep and
# case would otherwise match a multi-line value line by line.
if [ -n "$(printf '%s' "$API_BASE_URL" | LC_ALL=C tr -d '[:print:]')" ]; then
  echo "jobproof-config: API_BASE_URL must not contain control characters" >&2
  exit 1
fi
ORIGIN="${API_BASE_URL%/}"
# Anchored over the whole string; the character classes exclude quotes, backslash, semicolon,
# whitespace, path, query and fragment characters.
case "$ORIGIN" in
  http://*|https://*) ;;
  *) echo "jobproof-config: API_BASE_URL must start with http:// or https://" >&2; exit 1 ;;
esac
case "${ORIGIN#*://}" in
  ""|*[!A-Za-z0-9.:-]*)
    echo "jobproof-config: API_BASE_URL must be an origin like https://api.example.com (no path)" >&2
    exit 1 ;;
esac
if ! printf '%s' "$ORIGIN" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'; then
  echo "jobproof-config: API_BASE_URL must be an origin like https://api.example.com (no path)" >&2
  exit 1
fi

# JSON-escape backslashes and double quotes (the validation above already excludes both).
ESCAPED=$(printf '%s' "$ORIGIN" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

printf 'window.__JOBPROOF_CONFIG__ = {"apiBaseUrl": "%s"};\n' "$ESCAPED" > "$DIST_DIR/config.js"

cat > "$HEADERS_FILE" <<HEADERS
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: $ORIGIN; connect-src 'self' $ORIGIN; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
HEADERS

echo "jobproof-config: wrote config.js and security headers for API origin $ORIGIN"
